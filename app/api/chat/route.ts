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

import { NextRequest, NextResponse } from "next/server";
import { getSession, registerEvidence } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { REFUSAL_TEXT } from "@/app/lib/rag/answer";
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
  documentFingerprint,
  comparisonTableFromPayload,
  loadComparisonResult,
} from "@/app/lib/comparison-result-db";
import {
  parseSelectionRequest,
  selectionMatchesResultFingerprint,
  validateSelectionScope,
  activeViewFromSelection,
} from "@/app/lib/extraction/selection-request";
import { scopeDocumentsForChat } from "@/app/lib/rag/selection-scope";

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

  const session = getSession(body.sessionId);
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
  if (body.selection !== undefined) {
    const parsed = parseSelectionRequest(body.selection);
    if (!parsed) {
      return errorResponse("BAD_INPUT", 400, {
        requestId,
        message: "Malformed selection payload",
      });
    }
    const record = await loadComparisonResult(session.sessionId).catch(
      () => null,
    );
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

  try {
    let response;
    if (useLlm) {
      try {
        response = await timeAsync("chat.answerViaLlm", () =>
          answerViaLlm(scopedDocuments, question, {
            sessionId,
          }),
        );
      } catch (err) {
        // Contract: degraded successes above stay 200; only a total failure lands
        // here. Raw error text is logged server-side only — the client gets the
        // fixed CHAT_FAILED message (no secret/structure leakage).
        logFailure(requestId, "chat", err);
        console.warn(
          `[chat] llm engine failed; degrading to semantic: ${err instanceof Error ? err.message : "unknown"}`,
        );
        response = await timeAsync("chat.answerQuestionSemantic", () =>
          answerQuestionSemantic(scopedDocuments, question, {
            sessionId,
          }),
        );
      }
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
      // (getSession above) and ownership/session code — NEVER in model output.
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
      registerEvidence(session.sessionId, canonical);
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
