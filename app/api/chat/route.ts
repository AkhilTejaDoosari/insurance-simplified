// RAG endpoint: session-scoped Q&A with citations or fixed refusal
// (contracts/chat-api.md). Corpus is the session uploads only — never any
// other source (FR-017). Picks the best available engine: the LLM whenever
// LLM_BASE_URL and LLM_API_KEY are set, else the deterministic fallback.
// `engine` in the body ("llm" | "fallback") is an explicit override for testing.
//
// Requires valid session capability (cookie / Authorization: Bearer / x-session-capability).
// Session ID alone is insufficient for authorization.
//
// R4 DEGRADATION (semantic-selected per VALIDATION):
// - Semantic retriever is the selected path (semantic MRR@10=0.8438 > RRF MRR@10=0.6875).
// - Embeddings are separate keys: EMBEDDING_BASE_URL + EMBEDDING_API_KEY.
// - Semantic configured + healthy -> semantic retriever (top-5 cosine).
// - Semantic unavailable/error/unconfigured -> lexical line-overlap fallback.
// - Both empty -> fixed refusal. NO whole-document LLM fallback.

import { loadSession } from "@/app/lib/session-store";
import { NextRequest, NextResponse } from "next/server";
import { registerEvidence } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { REFUSAL_TEXT, type ChatCitation } from "@/app/lib/rag/answer";
import {
  answerQuestion,
  answerQuestionSemantic,
  answerViaLlm,
  validateChatResponse,
} from "@/app/lib/rag/answer";
import { isLlmConfigured } from "@/app/lib/llm/client";
import { buildTraceEvent, emitTrace } from "@/app/lib/observability/trace";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { requireSessionCapability } from "@/app/lib/session-auth";
import {
  recordTiming,
  timeAsync,
  timeSync,
} from "@/app/lib/observability/timing";
import {
  comparisonTableFromPayload,
  documentFingerprint,
  loadComparisonResult,
  type ComparisonResultRecord,
} from "@/app/lib/comparison-result-db";
import { exclusionOutcomeViews, resolveExclusionOutcomes } from "@/app/lib/evidence/exclusion-outcomes";
import {
  confirmStoredResult,
  resolutionsForCitations,
  type ConfirmedResult,
} from "@/app/lib/evidence/read-back";
import {
  parseSelectionRequest,
  selectionMatchesResultFingerprint,
  validateSelectionScope,
  activeViewFromSelection,
} from "@/app/lib/extraction/selection-request";
import { scopeDocumentsForChat } from "@/app/lib/rag/selection-scope";
import { surfacesForReadBack } from "@/app/lib/evidence/surfaces-consumer/read-back";
import { exclusionCoverageNotes } from "@/app/lib/presentation/adaptive";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    question?: string;
    engine?: string;
    selection?: unknown;
  } | null;
  if (
    !body?.sessionId ||
    typeof body.question !== "string" ||
    !body.question.trim()
  ) {
    return errorResponse("BAD_INPUT", 400, { requestId });
  }

  // Verify capability before accessing session data
  const auth = await requireSessionCapability(request, body.sessionId);
  if (!auth.ok) {
    return auth.errorResponse!;
  }

  const session = await loadSession(body.sessionId);
  if (!session) {
    return errorResponse("NOT_FOUND", 404, {
      requestId,
      message: "Unknown session",
    });
  }

  // M5 task 17: when a selection payload is present it is validated against
  // the server-side stored result BEFORE any retrieval happens. The client
  // names a scope (opaque fingerprint + plan IDs + tiers); it never supplies
  // facts. Absent selection keeps the previous whole-document behaviour.
  let scopedDocuments = session.documents;
  // AT-PERSIST: a stored result is used only after re-derivation from the
  // session's stored page text under this request's authority (read-back.ts).
  let storedRecord: ComparisonResultRecord | null | undefined;
  const loadStored = async () => {
    if (storedRecord === undefined) {
      storedRecord = await loadComparisonResult(session.sessionId).catch(() => null);
    }
    return storedRecord;
  };
  let confirmed: ConfirmedResult | null = null;
  const confirmStored = (record: ComparisonResultRecord) =>
    (confirmed ??= confirmStoredResult({
      sessionId: session.sessionId,
      documents: session.documents,
      record,
    }));
  if (body.selection !== undefined) {
    const parsed = parseSelectionRequest(body.selection);
    if (!parsed) {
      return errorResponse("BAD_INPUT", 400, {
        requestId,
        message: "Malformed selection payload",
      });
    }
    const record = await loadStored();
    if (!record) {
      return errorResponse("STATE_CONFLICT", 409, {
        requestId,
        message:
          "Selected result is no longer available. Re-run the comparison.",
      });
    }
    if (record.documentFingerprint !== documentFingerprint(session.documents)) {
      return errorResponse("STATE_CONFLICT", 409, {
        requestId,
        message: "Selected result does not match the current documents.",
      });
    }
    if (
      !selectionMatchesResultFingerprint(
        parsed,
        record.payload.resultFingerprint,
      )
    ) {
      return errorResponse("STATE_CONFLICT", 409, {
        requestId,
        message: "Selection is stale: a newer comparison result exists.",
      });
    }
    // Scope only narrows retrieval to the user's own session documents; it
    // renders no conclusion. Any comparison result shown with the answer is
    // re-derived first (see `resolutionsForCitations` below).
    const table = comparisonTableFromPayload(record);
    const scopeError = validateSelectionScope(parsed, table);
    if (scopeError) {
      return errorResponse("BAD_INPUT", 400, {
        requestId,
        message:
          scopeError === "foreign-plan"
            ? "Selection names a plan outside the verified result."
            : scopeError === "unsupported-tier"
              ? "Selection names a tier without verified evidence."
              : scopeError === "too-many-plans"
                ? "At most three plans can be selected at once."
                : "Invalid selection payload.",
      });
    }
    // Scope BEFORE retrieval: only selected-scope and evidenced shared
    // passages are eligible; eligible lines stay verbatim so citation
    // verification below keeps failing closed against session documents.
    const scoped = scopeDocumentsForChat(
      session.documents.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        pageCount: d.pageCount,
        pages: d.pages,
      })),
      table,
      parsed.planIds,
      body.question, // validated non-empty string above
      activeViewFromSelection(parsed),
    );
    scopedDocuments = scoped.documents;
  }

  const useLlm =
    body.engine === "llm" || (body.engine !== "fallback" && isLlmConfigured());
  const startedAt = Date.now();
  const sessionId = body.sessionId!; // validated above
  const question = body.question; // validated non-empty string above

  // Sanitized trace helper: metadata only (ids/pages/counts/latencies).
  // Never includes user text, prompts, document text, or keys.
  const trace = (init: {
    candidateCount: number;
    topK: { documentId: string; page: number }[];
    citationCount: number;
    verification?: "pass" | "fail";
    refusalReason?: string;
    fallbackReason?: string;
    errorCategory?: string;
  }) => {
    try {
      emitTrace(
        buildTraceEvent({
          scopeId: sessionId,
          strategy: useLlm ? "llm" : "semantic",
          candidateCount: init.candidateCount,
          topK: init.topK.map((c, i) => ({ ...c, rank: i + 1 })),
          llmModel: useLlm ? (process.env.LLM_MODEL ?? "default") : undefined,
          verification: init.verification,
          refusalReason: init.refusalReason,
          fallbackReason: init.fallbackReason,
          errorCategory: init.errorCategory,
          citationCount: init.citationCount,
          totalLatencyMs: Date.now() - startedAt,
        }),
      );
    } catch {
      // tracing never breaks the response
    }
  };

  // Verified evidence attached to chat outcomes that cite passages (answers
  // and "cannot be confirmed" passages): the citations' evidence ids,
  // comparison results they relate to, and exclusion outcomes for services
  // the question names — every one re-derived, never read as stored.
  const attachVerified = async (canonical: ChatCitation[]) => {
    registerEvidence(session.sessionId, canonical);
    // Comparison results this answer's citations relate to, each re-derived
    // first; an altered one is labelled "cannot be confirmed" (TB-3).
    const stored = await loadStored();
    const current =
      stored && stored.documentFingerprint === documentFingerprint(session.documents)
        ? confirmStored(stored)
        : null;
    const related = current ? resolutionsForCitations(current, canonical) : [];
    // Exclusion/applicability outcomes for services the question names,
    // resolved over the re-derived store and shown only through
    // displayIssuedResolution (exclusion-outcomes.ts).
    const exclusionOutcomes = current?.evidence
      ? exclusionOutcomeViews(
          current.evidence.authority,
          session.sessionId,
          resolveExclusionOutcomes(current.evidence.store, current.evidence.authority, question, {
            documentIds: scopedDocuments.map((d) => d.documentId),
          }),
        )
      : [];
    // When the answer touches a service, link each named plan's exclusion
    // inventory state if it may be incomplete (partial / unknown / cannot
    // be confirmed). Surfaces are re-derived, never read from storage.
    const exclusionCoverage =
      current && stored && exclusionOutcomes.length
        ? exclusionCoverageNotes(
            current.table,
            surfacesForReadBack({ sessionId: session.sessionId, documents: session.documents, record: stored, confirmed: current }),
            exclusionOutcomes.some((o) => !o.documentId)
              ? scopedDocuments.map((d) => d.documentId)
              : [...new Set(exclusionOutcomes.flatMap((o) => (o.documentId ? [o.documentId] : [])))],
          )
        : [];
    return {
      ...(related.length ? { resolutions: related } : {}),
      ...(exclusionOutcomes.length ? { exclusionOutcomes } : {}),
      ...(exclusionCoverage.length ? { exclusionCoverage } : {}),
    };
  };

  try {
    let response;
    if (useLlm) {
      // A-026 (owner decision 2026-11-21): a model/provider failure (timeout,
      // HTTP error, unparseable or off-schema output) throws out of
      // answerViaLlm and becomes the retryable CHAT_FAILED error below — it
      // never degrades to the retrieval engine, whose "cannot be confirmed"
      // would read as a statement about the documents. A model answer that
      // verifyAnswerClaims rejects is NOT a failure: answerViaLlm returns
      // "cannot be confirmed" with the cited passages.
      response = await timeAsync("chat.answerViaLlm", () =>
        answerViaLlm(scopedDocuments, question, {
          sessionId,
        }),
      );
    } else {
      response = await timeAsync("chat.answerQuestionSemantic", () =>
        answerQuestionSemantic(scopedDocuments, question, {
          sessionId,
        }),
      );
    }
    const validated = validateChatResponse(response);
    if (validated.kind === "answer") {
      // Server/session boundary: verify every citation against the session
      // documents and canonicalize to verbatim source spans. The answer text
      // may depend on every citation, so ANY unverifiable citation fails the
      // whole answer closed — return the existing refusal shape rather than
      // a partially unsupported answer. No new response states.
      //
      // P3-E ACCESS INVARIANT: access/scope decisions live ONLY in this route
      // (loadSession above) and ownership/session code — NEVER in model output.
      // Model-supplied documentIds/quotes grant nothing; citations below are
      // re-verified against session.documents, and evidenceIds are minted here
      // via withEvidenceId, never accepted from the model.
      const canonical = [];
      let allVerified = true;
      for (const citation of validated.citations) {
        const verified = timeSync("chat.verifyEvidenceCitation", () =>
          verifyEvidenceCitation(session.documents, citation),
        );
        const inScope = verifyEvidenceCitation(scopedDocuments, citation);
        if (!verified.ok || !inScope.ok) {
          console.warn(
            `[chat-refusal] stage=verifyEvidenceCitation page=${citation.page} citationCount=${validated.citations.length}`,
          );
          allVerified = false;
          break;
        }
        canonical.push({ ...citation, quote: verified.quote });
      }
      if (!allVerified) {
        trace({
          candidateCount: validated.citations.length,
          topK: validated.citations.map((c) => ({
            documentId: c.documentId,
            page: c.page,
          })),
          citationCount: 0,
          verification: "fail",
          refusalReason: "verification-failed",
        });
        return NextResponse.json({
          schemaVersion: "v1",
          kind: "refusal",
          refusalText: REFUSAL_TEXT,
        });
      }
      trace({
        candidateCount: canonical.length,
        topK: canonical.map((c) => ({
          documentId: c.documentId,
          page: c.page,
        })),
        citationCount: canonical.length,
        verification: "pass",
      });
      return NextResponse.json({
        ...validated,
        citations: canonical.map(withEvidenceId),
        ...(await attachVerified(canonical)),
      });
    }
    if (validated.citations?.length) {
      // P0-02 "cannot be confirmed": the passages are sources to check, not an
      // answer. Each one is verified on its page and in the chat scope on its
      // own; an unverifiable passage is dropped, and with none left the
      // plain refusal is returned.
      const canonical = validated.citations.flatMap((citation) => {
        const verified = verifyEvidenceCitation(session.documents, citation);
        const inScope = verifyEvidenceCitation(scopedDocuments, citation);
        return verified.ok && inScope.ok ? [{ ...citation, quote: verified.quote }] : [];
      });
      trace({
        candidateCount: validated.citations.length,
        topK: canonical.map((c) => ({ documentId: c.documentId, page: c.page })),
        citationCount: canonical.length,
        refusalReason: "cannot-be-confirmed",
      });
      if (canonical.length === 0) {
        return NextResponse.json({ schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT });
      }
      return NextResponse.json({
        ...validated,
        citations: canonical.map(withEvidenceId),
        ...(await attachVerified(canonical)),
      });
    }
    trace({
      candidateCount: 0,
      topK: [],
      citationCount: 0,
      refusalReason: "no-evidence",
    });
    return NextResponse.json(validated);
  } catch (err) {
    // Raw error text is logged server-side only; the client gets the fixed
    // CHAT_FAILED message (no secret/structure leakage).
    logFailure(requestId, "chat", err);
    try {
      emitTrace(
        buildTraceEvent({
          scopeId: sessionId ?? "unknown",
          strategy: useLlm ? "llm" : "semantic",
          candidateCount: 0,
          topK: [],
          citationCount: 0,
          totalLatencyMs: Date.now() - startedAt,
          errorCategory:
            err instanceof Error ? err.message.slice(0, 120) : "chat-failed",
        }),
      );
    } catch {
      // tracing never breaks the response
    }
    return errorResponse("CHAT_FAILED", 500, { retryable: true, requestId });
  }
}
