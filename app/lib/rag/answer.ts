// RAG path: explains and answers from session uploads ONLY
// (constitution principle II). This module MUST NOT import anything from
// app/lib/extraction/* — separate prompts, separate schemas, separate calls.

import { wrapDocuments } from "@/app/lib/llm/safe-prompt";
import { completeJson } from "@/app/lib/llm/client";
import { chunkDocument, type ChunkableDocument } from "@/app/lib/rag/chunks";
import { embedTexts, isEmbeddingConfigured } from "@/app/lib/rag/embeddings";
import { InMemoryCosineIndex } from "@/app/lib/rag/cosine-index";
import { fuseRRF, fuseSingleLeg, retrieveFused, type FusedPassage } from "@/app/lib/rag/fusion";
import type { RankedPassage } from "@/app/lib/rag/embeddings";

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

/** Convert line-overlap RetrievedPassage to RankedPassage for fusion. */
function toRankedPassage(p: RetrievedPassage): RankedPassage {
  return { ...p, chunkId: `${p.documentId}:${p.page}:${p.quote}` };
}

/** Lexical retriever leg: line-overlap, returns top-10 RankedPassage. */
async function retrieveLexical(documents: RagDocument[], question: string): Promise<RankedPassage[]> {
  const passages = retrieve(documents, question, 10);
  return passages.map(toRankedPassage);
}

/** Semantic retriever leg: chunk + embed + cosine, returns top-10 RankedPassage. */
async function retrieveSemantic(documents: RagDocument[], question: string): Promise<RankedPassage[]> {
  if (!isEmbeddingConfigured()) return [];
  const chunkable: ChunkableDocument[] = documents.map((d) => ({
    documentId: d.documentId,
    pages: d.pages,
  }));
  const chunks = chunkable.flatMap((d) => chunkDocument(d.documentId, d.pages));
  if (chunks.length === 0) return [];
  const texts = chunks.map((c) => c.text);
  const vectors = await embedTexts(texts);
  const index = new InMemoryCosineIndex();
  for (let i = 0; i < chunks.length; i++) {
    index.add({
      chunkId: chunks[i].chunkId,
      documentId: chunks[i].documentId,
      page: chunks[i].page,
      quote: chunks[i].text,
      vector: vectors[i],
    });
  }
  const qVecs = await embedTexts([question]);
  const results = index.search(qVecs[0], 10);
  return results;
}

/** Hybrid retrieval: RRF fusion of lexical + semantic, with single-leg degradation. */
export async function retrieveHybrid(
  documents: RagDocument[],
  question: string,
  maxPassages = 5
): Promise<FusedPassage[]> {
  return retrieveFused(
    () => retrieveLexical(documents, question),
    () => retrieveSemantic(documents, question),
    maxPassages
  );
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

/** Hybrid answer: uses RRF-fused retrieval when embeddings are configured,
 *  degrades to lexical-only when they are not. Same refusal semantics. */
export async function answerQuestionHybrid(
  documents: RagDocument[],
  question: string
): Promise<ChatResponse> {
  const passages = await retrieveHybrid(documents, question, 5);
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

/** Semantic-selected answer: uses semantic retrieval when embeddings are configured
 *  and healthy, degrades to lexical-only on any error/unconfigured. Same refusal semantics.
 *  This is the SELECTED retriever per R4 VALIDATION (semantic MRR@10=0.8438 > RRF MRR@10=0.6875). */
export async function answerQuestionSemantic(
  documents: RagDocument[],
  question: string
): Promise<ChatResponse> {
  if (!isEmbeddingConfigured()) {
    return answerQuestion(documents, question);
  }
  try {
    const passages = await retrieveSemantic(documents, question);
    if (passages.length === 0) {
      return { schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT };
    }
    const citations: ChatCitation[] = passages.slice(0, 5).map(({ documentId, page, quote }) => ({
      documentId,
      page,
      quote,
    }));
    const answerText = passages.slice(0, 5).map((p) => `(${p.documentId}, page ${p.page}) ${p.quote}`).join(" ");
    return { schemaVersion: "v1", kind: "answer", answerText, citations };
  } catch {
    // Any semantic error (Ollama down, bad key, timeout, dimension mismatch) -> degrade to lexical
    return answerQuestion(documents, question);
  }
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
