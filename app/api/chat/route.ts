// RAG endpoint: session-scoped Q&A with citations or fixed refusal
// (contracts/chat-api.md). Corpus is the session uploads only — never any
// other source (FR-017). Picks the best available engine: the LLM whenever
// LLM_BASE_URL and LLM_API_KEY are set, else the deterministic fallback.
// `engine` in the body ("llm" | "fallback") is an explicit override for testing.
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

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    question?: string;
    engine?: string;
  } | null;
  if (!body?.sessionId || typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "sessionId and question required" }, { status: 400 });
  }
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  }

  const useLlm =
    body.engine === "llm" || (body.engine !== "fallback" && isLlmConfigured());
  const startedAt = Date.now();

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
          scopeId: body.sessionId as string,
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
        })
      );
    } catch {
      // tracing never breaks the response
    }
  };

  try {
    let response;
    if (useLlm) {
      try {
        response = await answerViaLlm(session.documents, body.question);
      } catch (err) {
        console.warn(
          `[chat] llm engine failed; degrading to semantic: ${err instanceof Error ? err.message : "unknown"}`
        );
        response = await answerQuestionSemantic(session.documents, body.question);
      }
    } else {
      response = await answerQuestionSemantic(session.documents, body.question);
    }
    const validated = validateChatResponse(response);
    if (validated.kind === "answer") {
      // Server/session boundary: verify every citation against the session
      // documents and canonicalize to verbatim source spans. The answer text
      // may depend on every citation, so ANY unverifiable citation fails the
      // whole answer closed — return the existing refusal shape rather than
      // a partially unsupported answer. No new response states.
      const canonical = [];
      let allVerified = true;
      for (const citation of validated.citations) {
        const verified = verifyEvidenceCitation(session.documents, citation);
        if (!verified.ok) {
          allVerified = false;
          break;
        }
        canonical.push({ ...citation, quote: verified.quote });
      }
      if (!allVerified) {
        trace({
          candidateCount: validated.citations.length,
          topK: validated.citations.map((c) => ({ documentId: c.documentId, page: c.page })),
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
        topK: canonical.map((c) => ({ documentId: c.documentId, page: c.page })),
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
          scopeId: typeof body?.sessionId === "string" ? body.sessionId : "unknown",
          strategy: useLlm ? "llm" : "semantic",
          candidateCount: 0,
          topK: [],
          citationCount: 0,
          totalLatencyMs: Date.now() - startedAt,
          errorCategory: err instanceof Error ? err.message.slice(0, 120) : "chat-failed",
        })
      );
    } catch {
      // tracing never breaks the response
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 }
    );
  }
}
