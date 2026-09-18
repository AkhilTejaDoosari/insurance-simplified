// RAG endpoint: session-scoped Q&A with citations or fixed refusal
// (contracts/chat-api.md). Corpus is the session uploads only — never any
// other source (FR-017). Picks the best available engine: the LLM whenever
// LLM_BASE_URL and LLM_API_KEY are set, else the deterministic fallback.
// `engine` in the body ("llm" | "fallback") is an explicit override for testing.
//
// R3 DEGRADATION (graceful, hybrid -> lexical-only -> refusal):
// - Embeddings are a separate concern with SEPARATE keys: EMBEDDING_BASE_URL
//   + EMBEDDING_API_KEY (+ optional EMBEDDING_MODEL). They are NEVER read from
//   LLM_* — a chat/generation endpoint is not an embedding endpoint, and the
//   generation model is never a valid embedding model. See
//   app/lib/rag/embeddings.ts resolveEmbeddingConfig() for the clean-skip
//   signal (null when unconfigured). While embeddings are absent the
//   deterministic line-overlap lexical path serves every request with the
//   IDENTICAL ChatResponse contract and refusal semantics.
// - An unhealthy generation provider (bad key, 401/5xx, timeout) degrades to
//   the same lexical path instead of surfacing a 500. There is deliberately
//   NO whole-document LLM fallback: runtime degradation is hybrid ->
//   lexical-only -> fixed refusal, nothing else.

import { NextRequest, NextResponse } from "next/server";
import { getSession, registerEvidence } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { REFUSAL_TEXT } from "@/app/lib/rag/answer";
import {
  answerQuestion,
  answerViaLlm,
  validateChatResponse,
} from "@/app/lib/rag/answer";
import { isLlmConfigured } from "@/app/lib/llm/client";

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

  try {
    let response;
    if (useLlm) {
      try {
        response = await answerViaLlm(session.documents, body.question);
      } catch (err) {
        console.warn(
          `[chat] llm engine failed; degrading to lexical: ${err instanceof Error ? err.message : "unknown"}`
        );
        response = answerQuestion(session.documents, body.question);
      }
    } else {
      response = answerQuestion(session.documents, body.question);
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
        return NextResponse.json({
          schemaVersion: "v1",
          kind: "refusal",
          refusalText: REFUSAL_TEXT,
        });
      }
      registerEvidence(session.sessionId, canonical);
      return NextResponse.json({
        ...validated,
        citations: canonical.map(withEvidenceId),
      });
    }
    return NextResponse.json(validated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 }
    );
  }
}
