// RAG path: explains and answers from session uploads ONLY
// (constitution principle II). This module MUST NOT import anything from
// app/lib/extraction/* — separate prompts, separate schemas, separate calls.

import { wrapDocuments } from "@/app/lib/llm/safe-prompt";
import { completeJson } from "@/app/lib/llm/client";
import { chunkDocument } from "@/app/lib/rag/chunks";

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
}

export type ChatResponse =
  | { schemaVersion: "v1"; kind: "answer"; answerText: string; citations: ChatCitation[] }
  | { schemaVersion: "v1"; kind: "refusal"; refusalText: string };

/** Presentation-time citation: core citation plus its session-bound opaque
 *  evidence ID (`ev-...`), assigned at the chat API boundary (never by the
 *  RAG engine or the model) so citation URLs resolve to the exact passage. */
export type RegisteredChatCitation = ChatCitation & {
  evidenceId: string;
};

export type RegisteredChatResponse =
  | { schemaVersion: "v1"; kind: "answer"; answerText: string; citations: RegisteredChatCitation[] }
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

function termFreqs(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const w of text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))) {
    tf.set(w, (tf.get(w) ?? 0) + 1);
  }
  return tf;
}

export interface RetrievedPassage {
  documentId: string;
  page: number;
  quote: string;
  score: number;
  chunkId: string;
  order: number;
}

/** BM25 (k1=1.2, b=0.75) over R1 page-preserving chunks. Zero overlap → []. */
export function retrieve(
  documents: RagDocument[],
  question: string,
  maxPassages = 3
): RetrievedPassage[] {
  const K1 = 1.2;
  const B = 0.75;
  const q = tokens(question);
  if (q.size === 0) return [];
  const chunks = documents.flatMap((d) => chunkDocument(d.documentId, d.pages));
  if (chunks.length === 0) return [];
  const tfs = chunks.map((c) => termFreqs(c.text));
  const dls = tfs.map((tf) => [...tf.values()].reduce((n, v) => n + v, 0));
  const avgdl = dls.reduce((n, v) => n + v, 0) / dls.length;
  if (avgdl === 0) return [];
  const df = new Map<string, number>();
  for (const term of q) {
    let n = 0;
    for (const tf of tfs) if (tf.has(term)) n++;
    df.set(term, n);
  }
  const scored: RetrievedPassage[] = [];
  chunks.forEach((c, i) => {
    let score = 0;
    for (const term of q) {
      const tf = tfs[i].get(term) ?? 0;
      if (tf === 0) continue;
      const idf = Math.max(0, Math.log(1 + (chunks.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5)));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dls[i]) / avgdl));
    }
    if (score > 0) {
      scored.push({ documentId: c.documentId, page: c.page, quote: c.text, score, chunkId: c.chunkId, order: c.order });
    }
  });
  return scored
    .sort((a, b) =>
      b.score - a.score ||
      (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0) ||
      a.page - b.page ||
      a.order - b.order ||
      (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0)
    )
    .slice(0, maxPassages);
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
  return validateChatResponse({ schemaVersion: "v1", kind: "answer", ...(raw as object) });
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
    }
    return payload as ChatResponse;
  }
  throw new Error("Invalid chat response: kind must be 'answer' or 'refusal'");
}
