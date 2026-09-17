// RAG path: explains and answers from session uploads ONLY
// (constitution principle II). This module MUST NOT import anything from
// app/lib/extraction/* — separate prompts, separate schemas, separate calls.

import { wrapDocuments } from "@/app/lib/llm/safe-prompt";
import { completeJson } from "@/app/lib/llm/client";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

export interface RagDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
}

export interface ChatCitation {
  documentId: string;
  page: number;
  quote: string;
  /** Opaque session-bound evidence ID (ev-...), resolving server-side to
   *  this exact passage for citation URLs. Assigned by the answer path;
   *  never model-generated. */
  evidenceId: string;
}

export type ChatResponse =
  | { schemaVersion: "v1"; kind: "answer"; answerText: string; citations: ChatCitation[] }
  | { schemaVersion: "v1"; kind: "refusal"; refusalText: string };

export const REFUSAL_TEXT =
  "The uploaded documents contain no supporting evidence for this question.";

const STOPWORDS = new Set(
  "a,an,the,of,in,on,for,to,is,are,was,were,be,been,do,does,did,what,which,who,how,much,many,my,our,your,this,that,these,those,and,or,with,by,at,from,as,it,its,plan,coverage,cover,covered".split(",")
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export interface RetrievedPassage {
  documentId: string;
  page: number;
  quote: string;
  score: number;
}

/** Keyword-overlap retrieval over document lines. Zero overlap → no evidence. */
export function retrieve(
  documents: RagDocument[],
  question: string,
  maxPassages = 3
): RetrievedPassage[] {
  const q = tokens(question);
  if (q.size === 0) return [];
  const scored: RetrievedPassage[] = [];
  for (const doc of documents) {
    doc.pages.forEach((pageText, i) => {
      for (const line of pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
        const lt = tokens(line);
        let overlap = 0;
        for (const w of q) if (lt.has(w)) overlap++;
        if (overlap > 0) {
          scored.push({ documentId: doc.documentId, page: i + 1, quote: line, score: overlap });
        }
      }
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, maxPassages);
}

/** Deterministic fallback answer: grounded strictly in retrieved passages. */
export function answerQuestion(documents: RagDocument[], question: string): ChatResponse {
  const passages = retrieve(documents, question);
  if (passages.length === 0) {
    return { schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT };
  }
  const citations: ChatCitation[] = passages.map(({ documentId, page, quote }) => ({
    documentId,
    page,
    quote,
    evidenceId: evidenceIdFor(documentId, page, quote),
  }));
  const answerText = passages.map((p) => `(${p.documentId}, page ${p.page}) ${p.quote}`).join(" ");
  return { schemaVersion: "v1", kind: "answer", answerText, citations };
}

const CHAT_INSTRUCTIONS = [
  "You answer questions about insurance documents.",
  "Use ONLY the DOCUMENT blocks below. Every substantive claim MUST be backed by a cited passage.",
  'If nothing is relevant, return ONLY {"cantAnswer": true} with no other text.',
  "Otherwise return ONLY a JSON object: {\"answerText\": string, \"citations\": [{documentId, page, quote}]}.",
].join("\n");

export async function answerViaLlm(
  documents: RagDocument[],
  question: string
): Promise<ChatResponse> {
  const prompt = wrapDocuments(
    `${CHAT_INSTRUCTIONS}\nQuestion: ${question}`,
    documents.map(({ documentId, pages }) => ({ documentId, pages }))
  );
  const raw = (await completeJson([{ role: "user", content: prompt }])) as Record<string, unknown>;
  if (raw.cantAnswer === true) {
    return { schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT };
  }
  const payload = { schemaVersion: "v1", kind: "answer", ...(raw as object) } as Record<string, unknown>;
  // Evidence IDs are always server-assigned, never model-generated.
  if (Array.isArray(payload.citations)) {
    payload.citations = payload.citations.map((c) => {
      if (typeof c !== "object" || c === null) return c;
      const citation = { ...(c as Record<string, unknown>) };
      if (
        typeof citation.documentId === "string" &&
        typeof citation.page === "number" &&
        typeof citation.quote === "string"
      ) {
        citation.evidenceId = evidenceIdFor(citation.documentId, citation.page, citation.quote);
      }
      return citation;
    });
  }
  return validateChatResponse(payload);
}

/** Validate a payload against chat-api v1. Throws on violation. */
export function validateChatResponse(payload: unknown): ChatResponse {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid chat response: not an object");
  }
  const r = payload as Record<string, unknown>;
  if (r.schemaVersion !== "v1") throw new Error("Invalid chat response: schemaVersion must be 'v1'");
  if (r.kind === "refusal") {
    if (typeof r.refusalText !== "string" || !r.refusalText.trim()) {
      throw new Error("Invalid chat response: refusalText required");
    }
    return payload as ChatResponse;
  }
  if (r.kind === "answer") {
    if (typeof r.answerText !== "string" || !r.answerText.trim()) {
      throw new Error("Invalid chat response: answerText required");
    }
    if (!Array.isArray(r.citations) || r.citations.length === 0) {
      throw new Error("Invalid chat response: answers require >=1 citation (FR-012)");
    }
    for (const c of r.citations as Record<string, unknown>[]) {
      if (typeof c.documentId !== "string" || typeof c.page !== "number" || c.page < 1 || typeof c.quote !== "string" || !c.quote.trim()) {
        throw new Error("Invalid chat response: malformed citation");
      }
      if (typeof c.evidenceId !== "string" || !c.evidenceId.trim()) {
        throw new Error("Invalid chat response: citation must carry a session-bound evidenceId");
      }
    }
    return payload as ChatResponse;
  }
  throw new Error("Invalid chat response: kind must be 'answer' or 'refusal'");
}
