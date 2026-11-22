// RAG path: explains and answers from session uploads ONLY
// (constitution principle II). This module MUST NOT import anything from
// app/lib/extraction/* — separate prompts, separate schemas, separate calls.

import { documentHeader, frameSources } from "@/app/lib/llm/safe-prompt";
import { completeJson } from "@/app/lib/llm/client";
import {
  stripNullProperties,
  type NamedJsonSchema,
} from "@/app/lib/llm/json-schema";
import { chunkDocument, type ChunkableDocument } from "@/app/lib/rag/chunks";
import { embedTexts, isEmbeddingConfigured } from "@/app/lib/rag/embeddings";
import { InMemoryCosineIndex } from "@/app/lib/rag/cosine-index";
import {
  CANDIDATES_PER_LEG,
  fuseRRF,
  fuseSingleLeg,
  retrieveFused,
  type FusedPassage,
} from "@/app/lib/rag/fusion";
import { retrievePersistentSemantic } from "@/app/lib/rag/persist-session";
import type { RankedPassage } from "@/app/lib/rag/embeddings";
import {
  verifyAnswerClaims,
  classifyGrounding,
} from "@/app/lib/evidence-verification";

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

export type AnswerGrounding = "explicit" | "related" | "needs-external";

export type ChatResponse =
  | {
      schemaVersion: "v1";
      kind: "answer";
      answerText: string;
      citations: ChatCitation[];
      grounding?: AnswerGrounding;
    }
  | {
      schemaVersion: "v1";
      kind: "refusal";
      refusalText: string;
      /** P0-02 (additive): passages that may be relevant when no answer could
       *  be confirmed. Never an answer; shown as sources to check. */
      citations?: ChatCitation[];
    };

/** Presentation-time citation: core citation plus its session-bound opaque
 *  evidence ID (`ev-...`), assigned at the chat API boundary (never by the
 *  RAG engine or the model) so citation URLs resolve to the exact passage. */
export type RegisteredChatCitation = ChatCitation & {
  evidenceId: string;
};

export type RegisteredChatResponse =
  | {
      schemaVersion: "v1";
      kind: "answer";
      answerText: string;
      citations: RegisteredChatCitation[];
      grounding?: AnswerGrounding;
    }
  | {
      schemaVersion: "v1";
      kind: "refusal";
      refusalText: string;
      citations?: RegisteredChatCitation[];
    };

export const REFUSAL_TEXT =
  "The uploaded documents contain no supporting evidence for this question.";

/** P0-02: relevant passages exist but no answer could be confirmed from them
 *  (no generation model, or the generated answer failed verification). */
export const UNCERTAIN_TEXT =
  "This cannot be confirmed from your documents. The passages below may be relevant: check them on the original pages.";

/** Question words that carry no topic ("What should I verify about …"). */
const QUESTION_FILLER = new Set(
  "should,verify,about,know,tell,need,please,there,any,will,would,can,could,get,have,has,explain,mean,means,apply,applie,applies,check,does,much,really".split(","),
);
/** A line that qualifies the line before it; narrowing never cuts it off. */
const CONTINUES_QUALIFICATION = /^\s*(?:except|unless|excluding|other than|however|but|provided|only if|not\b|no\b)/i;
const MAX_QUALIFICATION_LINES = 3;
/** A contents/index line: a title with no figure, dot leaders, and at most a
 *  bare page number ("ELIGIBILITY ........ 3"). A fee schedule line
 *  ("Annual Deductible ........ $500") is evidence, never navigation. */
const LEADER_LINE = /^(.*?)\.{5,}\s*(?:\d{1,3})?\s*$/;
const CONTENTS_HEADING = /^\s*(?:table of )?contents\s*$/i;
const MIN_CONTENTS_LINES = 3;

function isLeaderLine(line: string): boolean {
  const m = LEADER_LINE.exec(line);
  return !!m && !/[\d$%]/.test(m[1]);
}

/** A passage reads as navigation when it has a contents heading or at least
 *  three leader lines; only then are its leader lines navigation. */
function isContentsPassage(lines: readonly string[]): boolean {
  return lines.some((line) => CONTENTS_HEADING.test(line)) ||
    lines.filter(isLeaderLine).length >= MIN_CONTENTS_LINES;
}
const MAX_UNCERTAIN_PASSAGES = 3;

function conceptStems(question: string): string[] {
  return [...tokens(question)].filter((w) => !QUESTION_FILLER.has(w)).map((w) => w.slice(0, 5));
}

/** A word states a concept when it shares the 5-letter stem ("excluded" /
 *  "Exclusions"), or is a shorter form of it ("wait" / "waiting"). */
function wordMatches(word: string, stem: string): boolean {
  return word.startsWith(stem) || (word.length >= 4 && stem.startsWith(word));
}

function lineHasConcept(line: string, stems: readonly string[], contents = false): boolean {
  if (CONTENTS_HEADING.test(line) || (contents && isLeaderLine(line))) return false;
  const words = line.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  return stems.some((stem) => words.some((word) => wordMatches(word, stem)));
}

function stemsIn(line: string, stems: readonly string[], contents: boolean): string[] {
  return stems.filter((stem) => lineHasConcept(line, [stem], contents));
}

/** Short passages (a lexical ±3-line window) are shown whole. */
const MAX_WHOLE_PASSAGE = 600;

/** Narrow a long passage to the verbatim lines around its most specific
 *  concept line: a concept repeated on many lines (a product name) weighs
 *  less than one stated once (the row the question is about). */
function focus(quote: string, lines: readonly string[], hits: readonly string[][]): string {
  const frequency = new Map<string, number>();
  for (const found of hits) for (const stem of found) frequency.set(stem, (frequency.get(stem) ?? 0) + 1);
  let best = -1;
  let bestScore = 0;
  hits.forEach((found, index) => {
    const score = found.reduce((sum, stem) => sum + 1 / (frequency.get(stem) ?? 1), 0);
    if (score > bestScore) { best = index; bestScore = score; }
  });
  let end = best + 3;
  while (end < lines.length && end < best + 3 + MAX_QUALIFICATION_LINES && CONTINUES_QUALIFICATION.test(lines[end])) end++;
  const window = lines.slice(Math.max(0, best - 1), end).join("\n").trim();
  return window && quote.includes(window) ? window : lines[best].trim();
}

/** Retrieval hygiene for passages shown to the user (P0-02): keep only
 *  passages with a line that states a concept of the question (contents
 *  lines and cover/title pages without the concept never qualify); long
 *  passages are narrowed to the verbatim lines around their most specific
 *  concept line; duplicates dropped, at most three, in the given (ranked) order. Quotes stay exact page substrings. */
export function relevantPassages(
  passages: readonly { documentId: string; page: number; quote: string }[],
  question: string,
): ChatCitation[] {
  const stems = conceptStems(question);
  if (stems.length === 0) return [];
  const out: ChatCitation[] = [];
  for (const { documentId, page, quote } of passages) {
    const lines = quote.split("\n");
    const contents = isContentsPassage(lines);
    const hits = lines.map((line) => stemsIn(line, stems, contents));
    if (!hits.some((found) => found.length > 0)) continue;
    const shown = quote.length <= MAX_WHOLE_PASSAGE ? quote : focus(quote, lines, hits);
    // The same text twice (or a window inside another) is one passage.
    if (out.some((c) => c.documentId === documentId && c.page === page && (c.quote.includes(shown) || shown.includes(c.quote)))) continue;
    out.push({ documentId, page, quote: shown });
    if (out.length === MAX_UNCERTAIN_PASSAGES) break;
  }
  return out;
}

/** The outcome when no answer is confirmed: "cannot be confirmed" with the
 *  relevant passages, or the plain refusal when none is relevant. Never an
 *  answer built from passages. */
export function uncertainOutcome(
  passages: readonly { documentId: string; page: number; quote: string }[],
  question: string,
): ChatResponse {
  const citations = relevantPassages(passages, question);
  return citations.length > 0
    ? { schemaVersion: "v1", kind: "refusal", refusalText: UNCERTAIN_TEXT, citations }
    : { schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT };
}

/** General insurance vocabulary: a question topic and the words documents
 *  use for it (owner decision 2026-11-22: a subject in other words is
 *  relevant). Used only to choose which retrieved passages to show. */
const TOPIC_WORDS: readonly [RegExp, string][] = [
  // Third review: no bare "outside"/"area" (they matched hospitals and networks).
  [/\b(?:geographic\w*|territor\w*|area of coverage|coverage area|service area)\b/i, "country countries residence territory worldwide abroad"],
  [/\b(?:maternity|pregnan\w*)\b/i, "maternity pregnancy childbirth prenatal newborn"],
];

/** Owner decision 2026-11-22 (blocker 2): once the model has been consulted
 *  on useful passages, the outcome is never "not in your documents". The
 *  passages shown are those the model cited (verbatim, by reference), then
 *  those stating a concept of the question (topic vocabulary included).
 *  Review: no unrelated top-N passages; with none relevant the outcome is
 *  "cannot be confirmed" without passages. */
export function uncertainAfterModel(
  cited: readonly ChatCitation[],
  passages: readonly { documentId: string; page: number; quote: string }[],
  question: string,
): ChatResponse {
  const out: ChatCitation[] = [];
  const add = (c: ChatCitation) => {
    if (out.length >= MAX_UNCERTAIN_PASSAGES) return;
    if (out.some((x) => x.documentId === c.documentId && x.page === c.page && (x.quote.includes(c.quote) || c.quote.includes(x.quote)))) return;
    out.push(c);
  };
  cited.forEach(add);
  const expanded = TOPIC_WORDS.reduce((q, [re, words]) => (re.test(question) ? `${q} ${words}` : q), question);
  relevantPassages(passages, expanded).forEach(add);
  return out.length > 0
    ? { schemaVersion: "v1", kind: "refusal", refusalText: UNCERTAIN_TEXT, citations: out }
    : { schemaVersion: "v1", kind: "refusal", refusalText: UNCERTAIN_TEXT };
}

const STOPWORDS = new Set(
  "a,an,the,of,in,on,for,to,is,are,was,were,be,been,do,does,did,what,which,who,how,much,many,my,our,your,this,that,these,those,and,or,with,by,at,from,as,it,its,plan,coverage,cover,covered,four,between,compare".split(
    ",",
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w)),
  );
}

export interface RetrievedPassage {
  documentId: string;
  page: number;
  quote: string;
  score: number;
}

/** Keyword-overlap retrieval over document lines. Zero overlap → no evidence.
 *  Matched lines expand to a ±3-line window so adjacent context (table
 *  headers, tier rows) travels with the hit; a document named by the
 *  question keeps one identity passage containing its name. Windows are
 *  contiguous in the source page, so quotes stay verbatim substrings. */
export function retrieve(
  documents: RagDocument[],
  question: string,
  maxPassages = 3,
): RetrievedPassage[] {
  const q = tokens(question);
  if (q.size === 0) return [];
  const namedTerms = documents.map((doc) => ({
    doc,
    terms: new Set([
      ...tokens(doc.filename),
      ...tokens(doc.filename.replace(/([a-z])([A-Z])/g, "$1 $2")),
    ]),
  }));
  const namedDocuments = namedTerms
    .filter(({ terms }) =>
      [...terms].some((word) => word !== "pdf" && q.has(word)),
    )
    .map(({ doc }) => doc);
  const searchDocuments =
    namedDocuments.length === 1 ? namedDocuments : documents;
  const documentNames = new Set(namedTerms.flatMap(({ terms }) => [...terms]));
  const topical = new Set([...q].filter((word) => !documentNames.has(word)));
  const queryTerms = topical.size > 0 ? topical : q;
  const candidates: {
    documentId: string;
    page: number;
    quote: string;
    terms: Set<string>;
  }[] = [];
  const pageLines = new Map<string, Map<number, string[]>>();
  const frequency = new Map<string, number>();
  for (const doc of searchDocuments) {
    doc.pages.forEach((pageText, i) => {
      const lines = pageText
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!pageLines.has(doc.documentId))
        pageLines.set(doc.documentId, new Map());
      pageLines.get(doc.documentId)!.set(i + 1, lines);
      for (const line of lines) {
        const lt = tokens(line);
        candidates.push({
          documentId: doc.documentId,
          page: i + 1,
          quote: line,
          terms: lt,
        });
        for (const word of queryTerms)
          if (lt.has(word)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
      }
    });
  }
  const scored: RetrievedPassage[] = candidates.flatMap(
    ({ documentId, page, quote, terms }) => {
      let score = 0;
      for (const word of queryTerms)
        if (terms.has(word)) score += 1 / (frequency.get(word) ?? 1);
      return score > 0 ? [{ documentId, page, quote, score }] : [];
    },
  );
  const top = scored.sort((a, b) => b.score - a.score).slice(0, maxPassages);
  const WINDOW = 3;
  const result = top.map((p) => {
    const lines = pageLines.get(p.documentId)?.get(p.page) ?? [];
    const idx = lines.indexOf(p.quote);
    if (idx < 0) return p;
    const start = Math.max(0, idx - WINDOW);
    const end = Math.min(lines.length, idx + WINDOW + 1);
    const quote = lines.slice(start, end).join("\n");
    return quote.length > p.quote.length ? { ...p, quote } : p;
  });
  // Identity guarantee: a document named by the question contributes one
  // passage containing its name so answers can name the plan they compare.
  // Supplements real retrieval only (scored.length > 0); it never rescues an
  // empty result, so zero-overlap questions still refuse.
  if (scored.length > 0) {
    for (const { doc, terms } of namedTerms) {
      const nameWords = [...terms].filter((w) => w !== "pdf");
      if (!nameWords.some((w) => q.has(w))) continue;
      let best: { page: number; line: string; count: number } | null = null;
      for (const [page, lines] of pageLines.get(doc.documentId) ?? []) {
        for (const line of lines) {
          const lt = tokens(line);
          const count = nameWords.filter((w) => lt.has(w)).length;
          if (count > 0 && (!best || count > best.count))
            best = { page, line, count };
        }
      }
      if (
        best &&
        !result.some(
          (p) =>
            p.documentId === doc.documentId && p.quote.includes(best!.line),
        )
      ) {
        result.push({
          documentId: doc.documentId,
          page: best.page,
          quote: best.line,
          score: 0,
        });
      }
    }
  }
  return result;
}

/** Convert line-overlap RetrievedPassage to RankedPassage for fusion. */
function toRankedPassage(p: RetrievedPassage): RankedPassage {
  return { ...p, chunkId: `${p.documentId}:${p.page}:${p.quote}` };
}

/** Passages the semantic leg hands to the chat prompt (see retrieval-prompt
 *  budget notes below; raised 10 -> 16 in todo 6). */
const SEMANTIC_TOP_K = 16;

/** Lexical retriever leg: line-overlap, returns up to CANDIDATES_PER_LEG
 *  RankedPassage candidates for fusion. */
async function retrieveLexical(
  documents: RagDocument[],
  question: string,
): Promise<RankedPassage[]> {
  const passages = retrieve(documents, question, CANDIDATES_PER_LEG);
  return passages.map(toRankedPassage);
}

/** Semantic retriever leg: chunk + embed + cosine, returns the top `limit`
 *  RankedPassage (chat: SEMANTIC_TOP_K). M5 over-fetching: both the pgvector
 *  and the in-memory index are asked for CANDIDATES_PER_LEG candidates; the
 *  page-provenance filter runs on that pool and only then is the list cut to
 *  `limit`, so dropped candidates never shrink the final top-k.
 *  Persistent-first cutover: when a session scope is provided and the durable
 *  stack is configured, pgvector serves the query; persistent errors fall
 *  back to the in-memory leg, and only persistent unavailability (null)
 *  skips straight to it. Empty persistent results flow to the caller's
 *  lexical degradation exactly like empty in-memory results. */
async function retrieveSemantic(
  documents: RagDocument[],
  question: string,
  sessionId?: string,
  limit: number = SEMANTIC_TOP_K,
): Promise<RankedPassage[]> {
  if (!isEmbeddingConfigured()) return [];
  const pool = Math.max(limit, CANDIDATES_PER_LEG);
  if (sessionId !== undefined) {
    try {
      const persistent = await retrievePersistentSemantic(
        question,
        sessionId,
        pool,
        documents.map((d) => d.documentId),
      );
      if (persistent !== null)
        return persistent
          .filter((p) => {
            const page = documents.find((d) => d.documentId === p.documentId)
              ?.pages[p.page - 1];
            const normalized = (text: string) =>
              text.replace(/\s+/g, " ").trim();
            return (
              page !== undefined &&
              p.quote.trim().length > 0 &&
              normalized(page).includes(normalized(p.quote))
            );
          })
          .slice(0, limit);
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        const cls = e instanceof Error ? e.constructor.name : typeof e;
        console.warn(`[chat-retrieval] persistent-error class=${cls}`);
      }
      // Persistent error -> existing in-memory leg below, then lexical.
    }
  }
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
  return index.search(qVecs[0], pool).slice(0, limit);
}

/** Hybrid retrieval: RRF fusion of lexical + semantic, with single-leg degradation. */
export async function retrieveHybrid(
  documents: RagDocument[],
  question: string,
  maxPassages = 5,
): Promise<FusedPassage[]> {
  return retrieveFused(
    () => retrieveLexical(documents, question),
    () => retrieveSemantic(documents, question, undefined, CANDIDATES_PER_LEG),
    maxPassages,
  );
}

/** Deterministic fallback answer: grounded strictly in retrieved passages. */
export function answerQuestion(
  documents: RagDocument[],
  question: string,
): ChatResponse {
  // P0-02: retrieval alone never answers; it can only point to passages.
  return uncertainOutcome(retrieve(documents, question), question);
}

/** Hybrid answer: uses RRF-fused retrieval when embeddings are configured,
 *  degrades to lexical-only when they are not. Same refusal semantics. */
export async function answerQuestionHybrid(
  documents: RagDocument[],
  question: string,
): Promise<ChatResponse> {
  return uncertainOutcome(await retrieveHybrid(documents, question, 5), question);
}

/** Semantic-USEFULNESS floor (top-1 cosine similarity) applied AFTER semantic
 *  retrieval has been attempted and scored — never a precheck that prevents
 *  the semantic call. Calibrated DEV-ONLY on qwen3-embedding:0.6b against the
 *  4 fixture chunks (1 chunk/page), top-1 cosine per question:
 *    genuine paraphrase (V2 DEV): deductible 0.6721, oop 0.5377, emergency
 *      0.5441, meds 0.4869, preexisting 0.6261, network 0.4478 (min), visa
 *      0.5795; direct "What is the emergency copay?" 0.5801
 *    nonsense / must-refuse (V2 DEV + E2E Flow 3): "Does this cover space
 *      tourism?" 0.4137, maternity 0.4144, dental 0.4040, counsel 0.4224
 *      (lens 0.4944 and opt 0.5355 score higher but carry lexical overlap or
 *      go to the LLM cantAnswer path, so the floor does not need to catch them)
 *  Floor 0.43 = midpoint of the DEV gap (nonsense max 0.4224 < 0.43 <
 *  genuine min 0.4478). Zero-overlap + below-floor similarity -> not useful ->
 *  degrade to lexical (which refuses on empty). Strong similarity -> useful
 *  even with zero lexical overlap (lexically disjoint paraphrase still succeeds). */
export const SEMANTIC_USEFULNESS_FLOOR = 0.43;

/** Top-1 cosine score over semantic passages (-Infinity when empty). */
function topSemanticScore(passages: RankedPassage[]): number {
  let top = -Infinity;
  for (const p of passages) if (p.score > top) top = p.score;
  return top;
}

/** Semantic-usefulness gate. Semantic retrieval is ALWAYS attempted first by
 *  the caller; this decides from SEMANTIC evidence itself whether the ranked
 *  passages are worth answering from. The lexical signal is ONLY a secondary
 *  corroborating input computed here, after semantic scoring — never a
 *  precheck. Returns false only when top-1 similarity is below
 *  SEMANTIC_USEFULNESS_FLOOR AND lexical line-overlap is empty. */
function isSemanticUseful(
  documents: RagDocument[],
  question: string,
  passages: RankedPassage[],
): boolean {
  if (passages.length === 0) return false;
  if (topSemanticScore(passages) >= SEMANTIC_USEFULNESS_FLOOR) return true;
  return retrieve(documents, question, 1).length > 0;
}

/** Semantic-selected answer: uses semantic retrieval when embeddings are configured
 *  and healthy, degrades to lexical-only on any error/unconfigured. Same refusal semantics.
 *  This is the SELECTED retriever per R4 VALIDATION (semantic MRR@10=0.8438 > RRF MRR@10=0.6875). */
export async function answerQuestionSemantic(
  documents: RagDocument[],
  question: string,
  opts: { sessionId?: string } = {},
): Promise<ChatResponse> {
  if (!isEmbeddingConfigured()) {
    return answerQuestion(documents, question);
  }
  try {
    const passages = await retrieveSemantic(
      documents,
      question,
      opts.sessionId,
    );
    if (
      passages.length > 0 &&
      isSemanticUseful(documents, question, passages)
    ) {
      return uncertainOutcome(passages, question);
    }
    // Semantic healthy but empty, or ranked but not useful (below-floor
    // similarity with zero lexical overlap, e.g. nonsense queries that pure
    // cosine always ranks) -> degrade to lexical, which itself refuses when
    // lexical evidence is empty.
    return answerQuestion(documents, question);
  } catch (e) {
    // Any semantic error (provider down, bad key, timeout, dimension
    // mismatch) -> keyword search, logged (owner decision 2026-11-21): error
    // class only, never the question or document text.
    console.warn(`[chat-retrieval] fallback=lexical reason=semantic-error class=${e instanceof Error ? e.constructor.name : typeof e}`);
    return answerQuestion(documents, question);
  }
}

/** Strict structured output for the chat call (EC-9). One object shape for
 *  both outcomes: strict mode cannot express optional fields, so answerText
 *  and citations are required-nullable and nulls are stripped before
 *  validateChatResponse (which stays the contract check). */
export const CHAT_ANSWER_SCHEMA: NamedJsonSchema = {
  name: "chat_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["cantAnswer", "answerText", "citations"],
    properties: {
      cantAnswer: { type: "boolean" },
      answerText: { type: ["string", "null"] },
      citations: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: false,
          // Owner decision 2026-11-22: citation by reference. The model names
          // a retrieved passage and a line range; it never types a quote.
          required: ["passageId", "fromLine", "toLine"],
          properties: {
            passageId: { type: "string", minLength: 1 },
            fromLine: { type: "integer", minimum: 1 },
            toLine: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  },
};

const CHAT_INSTRUCTIONS = [
  "You answer questions about insurance documents.",
  "Use ONLY the DOCUMENT blocks below. Every substantive claim MUST be backed by a cited passage.",
  'If nothing is relevant, return ONLY {"cantAnswer": true, "answerText": null, "citations": null} with no other text.',
  'Otherwise return ONLY a JSON object: {"cantAnswer": false, "answerText": string, "citations": [{"passageId": string, "fromLine": integer, "toLine": integer}]}.',
  "Each passage below starts with a tag like \"[Page N] passage P#\" and its lines are numbered (\"1| …\"). Cite a passage by its id and the first and last line numbers that support your answer; never copy quotes into citations — the server reads the cited lines from the page.",
  "ANSWER FORMATTING (required for verification):",
  "- Each sentence of answerText MUST be composed ONLY of words that appear in the passages you cite for it. Copy the source wording near-verbatim; do not paraphrase or add connective words that are not in the source.",
  '- Do not add meta commentary (e.g. "According to the documents", "Based on the provided passages").',
  "- The wording of answerText MUST be copied exactly (character-for-character) from the cited lines, without the line numbers; keep every punctuation mark, dollar sign and digit grouping as written.",
  "- Each DOCUMENT block has a name attribute (the uploaded filename). When the question names or compares plans or insurers and there is more than one DOCUMENT block, answerText MUST include a short label line for each plan discussed: copy name wording from a passage you cite (and cite its lines) alone on its own line as a 2-3 word label, before any sentence about that plan's values; never combine a plan name with values in one sentence unless every word of that sentence appears in a single cited passage. With one DOCUMENT block, write no plan or document name line.",
  "- Set cantAnswer ONLY when no DOCUMENT block contains any information relevant to the question. If any relevant passage exists, answer from it.",
  "- A passage is relevant when it states the subject of the question in different words (for example, a question about geographic restrictions is answered by passages about the home country, travel outside a country or an area of coverage). Answer from such passages in their own words; do not restate them in the question's words.",
].join("\n");

/** Max characters for retrieved context in LLM prompt (budget enforcement).
 *  Sized for retrieval topK=16 x 512-token semantic chunks of realistic dense
 *  insurance text (~2400-2600 chars each, ~5 chars/token observed in real
 *  SBCs), plus ~2k of prompt instructions. Budget, topK and
 *  CHUNK_TARGET_TOKENS are coupled — see the guard test in
 *  tests/unit/retrieval-prompt.test.ts; changing one requires re-checking the
 *  others. Pathological ~4100-char chunks at topK=16 (~66k) exceed this
 *  budget and would drop the whole lowest-ranked document block — that risk
 *  is accepted for V1 (raised topK fixed missing rank-12 deductible-range
 *  evidence); chunk-granular truncation is the future fix if it ever fires.
 *  Under-budgeting still drops a whole document block (missing plan tiers) or
 *  cuts a page tail (missing eligibility evidence). */
export const MAX_CONTEXT_CHARS = 48000;
/** Per-request output cap for chat (owner decision 2026-11-21). A reply cut
 *  at the cap fails closed (finish_reason=length → CHAT_FAILED). */
export const CHAT_MAX_OUTPUT_TOKENS = 1024;

/** One referenceable passage of the prompt: its lines are exact slices of
 *  the page text (retrieved chunk text is a raw page slice). */
export interface PassageRef {
  documentId: string;
  page: number;
  lines: string[];
}

/** Build LLM prompt from top-K retrieved chunks with budget enforcement.
 *  Truncates lowest-rank chunks first while keeping page tags intact. */
export function buildRetrievalPrompt(
  documents: RagDocument[],
  passages: RankedPassage[],
  question: string,
): string {
  return buildRetrievalContext(documents, passages, question).prompt;
}

/** The prompt plus the passage references it defines (owner decision
 *  2026-11-22: citation by reference). Each passage is tagged
 *  "[Page N] passage P#" with numbered lines; documents are grouped, pages
 *  ascending within a document, lowest-ranked documents dropped first. */
export function buildRetrievalContext(
  documents: RagDocument[],
  passages: RankedPassage[],
  question: string,
): { prompt: string; refs: Map<string, PassageRef> } {
  const byDoc = new Map<string, { documentId: string; filename: string; passages: RankedPassage[] }>();
  for (const p of passages) {
    if (!documents.some((d) => d.documentId === p.documentId && p.page >= 1 && p.page <= d.pageCount)) continue;
    if (!byDoc.has(p.documentId)) {
      const doc = documents.find((d) => d.documentId === p.documentId);
      byDoc.set(p.documentId, { documentId: p.documentId, filename: doc?.filename ?? p.documentId, passages: [] });
    }
    byDoc.get(p.documentId)!.passages.push(p);
  }
  const blockText = (id: string, page: number, lines: string[]) =>
    `[Page ${page}] passage ${id}\n${lines.map((l, i) => `${i + 1}| ${l}`).join("\n")}`;

  const docBlocks: Array<{ documentId: string; filename: string; items: Array<{ page: number; quote: string }> }> = [];
  let totalChars = 0;
  for (const { documentId, filename, passages: docPassages } of byDoc.values()) {
    const items = [...docPassages].sort((x, y) => x.page - y.page).map((p) => ({ page: p.page, quote: p.quote }));
    const size = `${documentHeader({ id: documentId, name: filename })}\n`.length +
      items.reduce((n, it) => n + it.quote.length + it.quote.split("\n").length * 6 + 32, 0);
    if (totalChars + size > MAX_CONTEXT_CHARS && docBlocks.length > 0) break; // budget: lowest rank first
    totalChars += size;
    docBlocks.push({ documentId, filename, items });
  }
  // If even the first document exceeds budget, truncate its passages (each
  // truncated quote is still a prefix — an exact slice — of the page text).
  if (docBlocks.length === 1 && totalChars > MAX_CONTEXT_CHARS) {
    const limit = Math.max(1, Math.floor(MAX_CONTEXT_CHARS / docBlocks[0].items.length));
    // Review: cut on line boundaries — a half line could drop its "except".
    docBlocks[0].items = docBlocks[0].items.map((it) => {
      const lines = it.quote.split("\n");
      let quote = lines[0];
      for (const line of lines.slice(1)) {
        if (quote.length + 1 + line.length > limit) break;
        quote += `\n${line}`;
      }
      return { ...it, quote };
    });
  }

  const refs = new Map<string, PassageRef>();
  const payloads = docBlocks.map(({ documentId, filename, items }) => {
    const blocks = items.map((it) => {
      const id = `P${refs.size + 1}`;
      const lines = it.quote.split("\n");
      refs.set(id, { documentId, page: it.page, lines });
      return blockText(id, it.page, lines);
    });
    return `${documentHeader({ id: documentId, name: filename })}\n${blocks.join("\n\n")}`;
  });

  // EVIDENCE-vs-INSTRUCTION SEPARATOR (P3-E prompt-injection boundary):
  // trusted task instructions come first; retrieved passages are UNTRUSTED
  // uploaded-PDF data inside the same collision-checked per-call frames as
  // extraction (llm/safe-prompt.ts). No code path reads frame contents as
  // instructions; the model output is validated + verified below.
  return { prompt: frameSources(`${CHAT_INSTRUCTIONS}\nQuestion: ${question}`, payloads), refs };
}

/** Resolve the model's passage references to verbatim citations. Returns
 *  null when any reference is unknown or out of range (the answer is then
 *  treated as rejected — never repaired). Any typed text is ignored. */
export function resolveCitationRefs(raw: unknown, refs: Map<string, PassageRef>): ChatCitation[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatCitation[] = [];
  for (const c of raw as Array<Record<string, unknown>>) {
    const ref = refs.get(String(c?.passageId ?? ""));
    // Strict numbers (review: defence in depth behind the schema check).
    const from = typeof c?.fromLine === "number" ? c.fromLine : NaN;
    const to = typeof c?.toLine === "number" ? c.toLine : NaN;
    if (!ref || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > ref.lines.length) return null;
    const quote = ref.lines.slice(from - 1, to).join("\n");
    if (!quote.trim()) return null;
    if (!out.some((x) => x.documentId === ref.documentId && x.page === ref.page && x.quote === quote)) {
      out.push({ documentId: ref.documentId, page: ref.page, quote });
    }
  }
  return out;
}

/** Owner decision 2026-11-22: strip plan-name header lines server-side.
 *  Review B3: a line is a header only when it is exactly a verified plan
 *  name — an optional leading "The", parenthetical codes and trailing
 *  punctuation aside. Anything else on the line keeps it (and the
 *  unverifiable line then rejects the answer); lines are removed, never
 *  rewritten. */
export function stripPlanHeaders(answerText: string, planNames: readonly string[]): string {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const names = new Set(planNames.map(norm).filter((n) => n.length >= 3));
  if (names.size === 0) return answerText;
  return answerText
    .split("\n")
    // Third review (N2): only code-like brackets ("(PATAP)", "(GP-2)") are
    // decoration; any other bracketed text keeps the line.
    // Fourth review: a code is one token without spaces and never a
    // qualifier word ("(NOT IN NY)", "(EXCL. NY)", "(ONLY)" keep the line).
    .filter((line) => {
      const decoded = line.replace(/\(\s*([A-Z0-9][A-Z0-9.\-\/]{0,11})\s*\)/g, (m, code: string) =>
        /^(?:NOT?|NON|EXCL|EXCEPT|ONLY|WITHOUT|NONE)/.test(code) ? m : " ");
      return !names.has(norm(decoded).replace(/^the /, ""));
    })
    .join("\n")
    .trim();
}

/** LLM answer using retrieval-fed context (selected retriever: semantic-only).
 *  Empty retrieval -> refusal WITHOUT LLM call (short-circuit).
 *  Budget enforced: lowest-rank chunks dropped first, page tags intact.
 *  Post-generation: claim-to-citation verification (refusal on any failure, no repair). */
export async function answerViaLlm(
  documents: RagDocument[],
  question: string,
  opts: { sessionId?: string; planNames?: readonly string[] } = {},
): Promise<ChatResponse> {
  // Semantic-first (P2): try healthy semantic retrieval when embeddings are
  // configured; lexical line-overlap is ONLY a fallback on semantic
  // unavailable/error/empty-config/empty/not-useful (below-floor similarity
  // with zero lexical overlap). Final empty -> refusal WITHOUT LLM call.
  let passages: RankedPassage[];
  let leg = "lexical";
  let legReason = "";
  if (!isEmbeddingConfigured()) {
    const lexical = retrieve(documents, question, 10).map(toRankedPassage);
    if (lexical.length === 0) {
      console.warn(`[chat-refusal] stage=retrieval-empty reason=no-embeddings`);
      return {
        schemaVersion: "v1",
        kind: "refusal",
        refusalText: REFUSAL_TEXT,
      };
    }
    legReason = "no-embeddings";
    passages = lexical;
  } else {
    try {
      const semantic = await retrieveSemantic(
        documents,
        question,
        opts.sessionId,
      );
      if (
        semantic.length > 0 &&
        isSemanticUseful(documents, question, semantic)
      ) {
        leg = "semantic";
        passages = semantic;
      } else {
        const lexical = retrieve(documents, question, 10).map(toRankedPassage);
        if (lexical.length === 0) {
          console.warn(
            `[chat-refusal] stage=retrieval-empty reason=semantic-not-useful+lexical-empty`,
          );
          return {
            schemaVersion: "v1",
            kind: "refusal",
            refusalText: REFUSAL_TEXT,
          };
        }
        legReason = "semantic-not-useful";
        passages = lexical;
      }
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        const cls = e instanceof Error ? e.constructor.name : typeof e;
        const cause =
          e instanceof Error && e.cause
            ? (e.cause as { code?: unknown })
            : undefined;
        const rawCode = cause?.code ?? (e as { code?: unknown }).code;
        const code = typeof rawCode === "string" ? ` code=${rawCode}` : "";
        console.warn(`[chat-retrieval] semantic-error class=${cls}${code}`);
      }
      const lexical = retrieve(documents, question, 10).map(toRankedPassage);
      if (lexical.length === 0) {
        console.warn(
          `[chat-refusal] stage=retrieval-empty reason=semantic-error+lexical-empty`,
        );
        return {
          schemaVersion: "v1",
          kind: "refusal",
          refusalText: REFUSAL_TEXT,
        };
      }
      legReason = "semantic-error";
      passages = lexical;
    }
  }

  // Empty retrieval -> immediate refusal, NO LLM call
  if (passages.length === 0) {
    return { schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT };
  }

  if (process.env.NODE_ENV !== "test") {
    const pages = [...new Set(passages.map((p) => p.page))].sort(
      (a, b) => a - b,
    );
    // Counts and page numbers only: document text never reaches the log.
    console.warn(
      `[chat-retrieval] leg=${leg}${legReason ? ` reason=${legReason}` : ""} passages=${passages.length} pages=${pages.join(",")}`,
    );
  }
  // Contents/index passages are navigation, not evidence (P0-02).
  const evidencePassages = passages.filter((p) => !isContentsPassage(p.quote.split("\n")));
  if (evidencePassages.length === 0) return uncertainOutcome(passages, question);
  passages = evidencePassages;
  // Build prompt from top-K retrieved chunks with budget enforcement
  const { prompt, refs } = buildRetrievalContext(documents, passages, question);
  const raw = stripNullProperties(
    await completeJson([{ role: "user", content: prompt }], undefined, {
      schema: CHAT_ANSWER_SCHEMA,
      maxTokens: CHAT_MAX_OUTPUT_TOKENS,
    }),
  ) as Record<string, unknown>;

  if (raw.cantAnswer === true) {
    console.warn(`[chat-refusal] stage=llm-cantAnswer`);
    return uncertainAfterModel([], passages, question);
  }

  // Citation by reference: the server fills every quote from the cited
  // passage lines. A bad reference is a rejected answer (no repair).
  // Off-schema output (no answer text, no citation array) is a model failure
  // (A-026 → CHAT_FAILED), exactly as before; a bad reference is not.
  if (typeof raw.answerText !== "string" || !Array.isArray(raw.citations) || raw.citations.length === 0) {
    throw new Error("Invalid chat response: answerText and citations are required");
  }
  const citations = resolveCitationRefs(raw.citations, refs);
  // Headers are stripped only in a one-document answer; in a comparison the
  // plan line keeps attribution (and must verify like any other line).
  const oneDocument = !!citations && new Set(citations.map((c) => c.documentId)).size === 1;
  const answerText = oneDocument ? stripPlanHeaders(raw.answerText, opts.planNames ?? []) : raw.answerText.trim();
  if (!citations || !answerText) {
    console.warn(`[chat-refusal] stage=citation-ref category=${citations ? "empty-after-header-strip" : "bad-reference"}`);
    return uncertainAfterModel(citations ?? [], passages, question);
  }
  const response = validateChatResponse({
    schemaVersion: "v1",
    kind: "answer",
    answerText,
    citations,
  });

  // validateChatResponse guarantees kind === "answer" here (cantAnswer handled above)
  const answerResponse = response as {
    schemaVersion: "v1";
    kind: "answer";
    answerText: string;
    citations: ChatCitation[];
  };

  // Convert passages to supplied chunks format for verification
  const suppliedChunks = passages.map((p) => ({
    documentId: p.documentId,
    page: p.page,
    quote: p.quote,
  }));

  // Verify claims: (a) substantive sentences covered, (b) citations in supplied context, (c) citations verify vs source
  const verification = verifyAnswerClaims(
    answerResponse.answerText,
    answerResponse.citations,
    suppliedChunks,
    documents,
  );

  if (!verification.ok) {
    const failedCitation = /p(\d+)/.exec(verification.rationale ?? "");
    console.warn(
      `[chat-refusal] stage=verifyAnswerClaims category=${verification.rationale?.split(":")[0] ?? "unknown"} failedPage=${failedCitation?.[1] ?? "n/a"} citationCount=${answerResponse.citations.length}`,
    );
    // ANY failure -> no answer (NO repair): "cannot be confirmed" with the
    // passages the model cited (verbatim), never the unverified text.
    return uncertainAfterModel(answerResponse.citations, passages, question);
  }

  return {
    ...answerResponse,
    grounding: classifyGrounding(
      answerResponse.answerText,
      answerResponse.citations.map((c) => c.quote),
    ),
  };
}

/** One chat citation (answers and refusal passages): document id, a page
 *  number (numeric strings coerced) and a non-empty quote. Throws otherwise. */
function validateCitation(c: Record<string, unknown>): void {
  if (typeof c !== "object" || c === null) {
    throw new Error(
      `Invalid chat response: malformed citation entry type=${typeof c}`,
    );
  }
  if (typeof c.documentId !== "string") {
    throw new Error(
      `Invalid chat response: malformed citation field=documentId type=${typeof c.documentId}`,
    );
  }
  // Coerce LLM numeric-string pages ("3") to integers; non-numeric strings still fail below.
  if (typeof c.page === "string" && /^\d+$/.test(c.page.trim())) {
    c.page = Number(c.page.trim());
  }
  if (typeof c.page !== "number" || c.page < 1) {
    throw new Error(
      `Invalid chat response: malformed citation field=page type=${typeof c.page}`,
    );
  }
  if (typeof c.quote !== "string" || !c.quote.trim()) {
    throw new Error(
      `Invalid chat response: malformed citation field=quote type=${typeof c.quote}`,
    );
  }
}

/** Validate a payload against chat-api v1. Throws on violation. */
export function validateChatResponse(payload: unknown): ChatResponse {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid chat response: not an object");
  }
  const r = payload as Record<string, unknown>;
  if (r.schemaVersion !== "v1")
    throw new Error("Invalid chat response: schemaVersion must be 'v1'");
  if (r.kind === "refusal") {
    if (typeof r.refusalText !== "string" || !r.refusalText.trim()) {
      throw new Error("Invalid chat response: refusalText required");
    }
    if (r.citations !== undefined) {
      if (!Array.isArray(r.citations)) throw new Error("Invalid chat response: refusal citations must be an array");
      for (const c of r.citations as Record<string, unknown>[]) validateCitation(c);
    }
    return payload as ChatResponse;
  }
  if (r.kind === "answer") {
    if (typeof r.answerText !== "string" || !r.answerText.trim()) {
      throw new Error(
        `Invalid chat response: answerText required type=${typeof r.answerText}`,
      );
    }
    if (!Array.isArray(r.citations) || r.citations.length === 0) {
      throw new Error(
        "Invalid chat response: answers require >=1 citation (FR-012)",
      );
    }
    for (const c of r.citations as Record<string, unknown>[]) {
      validateCitation(c);
    }
    if (
      r.grounding !== undefined &&
      r.grounding !== "explicit" &&
      r.grounding !== "related" &&
      r.grounding !== "needs-external"
    ) {
      throw new Error(
        "Invalid chat response: grounding must be explicit, related, or needs-external",
      );
    }
    return payload as ChatResponse;
  }
  throw new Error("Invalid chat response: kind must be 'answer' or 'refusal'");
}
