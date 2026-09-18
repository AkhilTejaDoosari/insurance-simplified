// R3 embeddings provider abstraction (todo 21).
// Provider-neutral OpenAI-compatible HTTP client (POST /embeddings) + the
// Retriever / VectorIndex / VectorStore interfaces behind which the in-memory
// cosine ranker (todo 22) and any future pgvector adapter (todo 25) plug in.
//
// ENV CONTRACT — EMBEDDING_* ONLY, never LLM_*:
//   EMBEDDING_BASE_URL + EMBEDDING_API_KEY (+ optional EMBEDDING_MODEL).
// These are SEPARATE from LLM_BASE_URL / LLM_API_KEY / LLM_MODEL on purpose:
// a chat/generation endpoint is not an embedding endpoint, and the configured
// generation model (e.g. gpt-oss-120b) is NEVER a valid embedding model.
// When EMBEDDING_* is absent the client reports unconfigured and callers must
// degrade to the lexical path (todo 23) — never fall back to LLM_* values.
//
// This module MUST NOT import anything from app/lib/extraction/* (separate
// paths). Retry/backoff mirrors app/lib/llm/client.ts (pattern only — that
// file is untouched). No vendor SDK: plain fetch only.

import type { ChunkableDocument } from "@/app/lib/rag/chunks";

/** Ranked passage returned by every retriever leg (lexical or semantic). */
export interface RankedPassage {
  documentId: string;
  page: number;
  /** Chunk that produced the passage (line-overlap leg leaves this empty). */
  chunkId: string;
  quote: string;
  score: number;
}

/**
 * Retriever seam: lexical, semantic, and fused legs all answer behind this
 * shape so consumers never care which leg served the query. Zero evidence
 * must surface as an empty array (refusal gating in answerQuestion() depends
 * on it) — never null, never a throw for "no hits".
 */
export interface Retriever {
  retrieve(
    documents: ChunkableDocument[],
    question: string,
    maxPassages?: number,
  ): Promise<RankedPassage[]>;
}

/** One stored vector with its provenance back to a chunk. */
export interface VectorRecord {
  chunkId: string;
  documentId: string;
  page: number;
  quote: string;
  vector: number[];
}

/**
 * Minimal searchable-index seam. The V1 implementation is the in-memory
 * brute-force cosine matrix (todo 22); a future pgvector adapter implements
 * this same interface so retrieval consumers stay unchanged (todo 25).
 */
export interface VectorIndex {
  /** Embedding dimension once known, null while the index is empty. */
  readonly dimension: number | null;
  readonly size: number;
  add(record: VectorRecord): void;
  search(query: number[], topK: number): RankedPassage[];
}

/**
 * Persistent-capable extension of VectorIndex. Today only clear() matters
 * (vectors live per session and are dropped on close); a pgvector adapter
 * would back these same methods with a table instead of memory.
 */
export interface VectorStore extends VectorIndex {
  clear(): void;
}

/** Thrown when embedding vectors disagree on dimensionality. */
export class DimensionError extends Error {
  readonly expected: number;
  readonly received: number;
  constructor(expected: number, received: number) {
    super(`Embedding dimension mismatch: expected ${expected}, received ${received}`);
    this.name = "DimensionError";
    this.expected = expected;
    this.received = received;
  }
}

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Null when unconfigured — the clean-skip signal for the lexical fallback. */
export function resolveEmbeddingConfig(): EmbeddingConfig | null {
  const baseUrl = process.env.EMBEDDING_BASE_URL;
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model: process.env.EMBEDDING_MODEL ?? "default" };
}

export function isEmbeddingConfigured(): boolean {
  return resolveEmbeddingConfig() !== null;
}

/** Rate limits and provider hiccups are retried; other failures are not. */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 32;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface EmbeddingsResponse {
  data?: { embedding?: unknown }[];
}

function parseBatchVectors(payload: unknown): number[][] {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Embedding response malformed: not an object");
  }
  const data = (payload as EmbeddingsResponse).data;
  if (!Array.isArray(data)) {
    throw new Error("Embedding response malformed: data[] missing");
  }
  return data.map((item, i) => {
    const vec = item?.embedding;
    if (!Array.isArray(vec) || vec.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(`Embedding response malformed: data[${i}].embedding must be number[]`);
    }
    return vec as number[];
  });
}

async function postBatch(
  config: EmbeddingConfig,
  input: string[],
  opts: { baseDelayMs?: number },
): Promise<number[][]> {
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const url = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;
  let res: Response | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input }),
    });
    if (res.ok || !RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : baseDelayMs * 2 ** (attempt - 1);
    console.warn(
      `[embeddings] status ${res.status}; retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS})`,
    );
    await sleep(delay);
  }
  if (!res || !res.ok) {
    throw new Error(`Embedding request failed with status ${res?.status ?? "unknown"}`);
  }
  return parseBatchVectors((await res.json()) as unknown);
}

/**
 * Embed texts via the configured OpenAI-compatible endpoint, in batches.
 * Throws when EMBEDDING_* is unconfigured (callers treat this as the
 * skip-to-lexical signal), on DimensionError when the provider returns
 * ragged vectors, or with the HTTP status on auth/persistent failures
 * (401 surfaces immediately; 5xx only after the retry budget is spent).
 */
export async function embedTexts(
  texts: string[],
  opts: { batchSize?: number; baseDelayMs?: number } = {},
): Promise<number[][]> {
  const config = resolveEmbeddingConfig();
  if (!config) {
    throw new Error("Embeddings not configured (set EMBEDDING_BASE_URL and EMBEDDING_API_KEY)");
  }
  if (texts.length === 0) return [];
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`embedTexts: batchSize must be a positive integer, got ${batchSize}`);
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = await postBatch(config, texts.slice(i, i + batchSize), opts);
    out.push(...batch);
  }
  const expected = out[0].length;
  for (const vec of out) {
    if (vec.length !== expected) throw new DimensionError(expected, vec.length);
  }
  return out;
}
