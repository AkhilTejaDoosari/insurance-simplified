// P2 Postgres/pgvector adapter (todo 57): persistent VectorStore behind the
// seam from app/lib/rag/embeddings.ts (todo 21). ADDITIVE ONLY —
// InMemoryCosineIndex (app/lib/rag/cosine-index.ts) is untouched and remains
// the default runtime; nothing in app/lib/rag/answer.ts routes here.
//
// TRANSPORT: package.json has no `pg` (and no Supabase SDK) on purpose, so
// this adapter talks to Supabase over plain fetch (PostgREST + the
// match_chunks RPC from db/schema.sql). No heavy dependency was added.
//
// LAZINESS: importing this module never touches the network or the
// environment. Credentials resolve at call time; without SUPABASE_URL /
// SUPABASE_SERVICE_KEY the async persistence methods throw
// PostgresUnconfiguredError (callers/tests treat that as SKIP, never as
// fake success).
//
// INVARIANTS (mirror the in-memory leg):
//   * Embedding model qwen3-embedding:0.6b, 1024 dims (evals/BASELINE.md).
//     Dimension mismatches throw DimensionError — never coerced/truncated.
//   * Deterministic tie-break: score DESC, chunkId ASC (then documentId ASC,
//     page ASC as final stabilizers; the first two keys are the contract).
//   * Provenance: every RankedPassage carries documentId/page/chunkId/quote
//     resolving chunk -> document -> page -> source evidence.
//   * Hash-based skip: upsertChunks re-embeds/persists a chunk only when its
//     text hash differs from the stored row (sha16 of normalized text, the
//     same hash chunkIdFor() binds into the chunk ID).

import {
  DimensionError,
  type RankedPassage,
  type VectorStore,
} from "@/app/lib/rag/embeddings";
import {
  countTokens,
  normalizeChunkText,
  sha16,
  type TextChunk,
} from "@/app/lib/rag/chunks";

/** Embedding model + width backing the `chunks.embedding vector(1024)` column. */
export const EMBEDDING_MODEL = "qwen3-embedding:0.6b";
export const EMBEDDING_DIMENSION = 1024;

/** Thrown when Postgres persistence is invoked without credentials. */
export class PostgresUnconfiguredError extends Error {
  constructor() {
    super(
      "PostgresVectorStore: SUPABASE_URL and SUPABASE_SERVICE_KEY are unset — " +
        "skipping persistence (in-memory index remains the default)",
    );
    this.name = "PostgresUnconfiguredError";
  }
}

export interface PostgresConfig {
  url: string;
  serviceKey: string;
}

/** Null when unconfigured — the honest-skip signal. Lazy: call, don't cache at import. */
export function resolvePostgresConfig(): PostgresConfig | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

export function isPostgresConfigured(): boolean {
  return resolvePostgresConfig() !== null;
}

/** Throw DimensionError unless the vector has exactly the expected width. Never coerces. */
export function validateDimension(vector: number[], expected: number = EMBEDDING_DIMENSION): void {
  if (vector.length !== expected) {
    throw new DimensionError(expected, vector.length);
  }
}

/** Text hash used for the upsert skip check (same normalization as chunk IDs). */
export function textHashForSkip(text: string): string {
  return sha16(normalizeChunkText(text));
}

// ------------------------------------------------------------------ client
// Minimal seam over Supabase so unit tests can inject a mock and integration
// tests can hit the real REST surface. The default fetch implementation is
// created lazily inside PostgresVectorStore — never at import time.

export interface StoredChunkHash {
  chunk_id: string;
  text_hash: string;
}

export interface ChunkRow {
  chunk_id: string;
  document_id: string;
  page_number: number;
  chunk_order: number;
  text: string;
  token_count: number;
  char_start: number;
  char_end: number;
  section: string | null;
  text_hash: string;
  embedding: number[];
}

export interface MatchRow {
  chunk_id: string;
  document_id: string;
  page_number: number;
  quote: string;
  score: number;
}

export interface VectorQueryFilters {
  documentId?: string;
  sessionId?: string;
}

export interface PostgresVectorClient {
  fetchHashes(documentId: string): Promise<StoredChunkHash[]>;
  upsertRows(rows: ChunkRow[]): Promise<void>;
  matchChunks(
    query: number[],
    topK: number,
    filters?: VectorQueryFilters,
  ): Promise<MatchRow[]>;
  deleteByDocument(documentId: string): Promise<void>;
  deleteBySession(sessionId: string): Promise<void>;
}

function restHeaders(config: PostgresConfig): Record<string, string> {
  return {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
    "content-type": "application/json",
  };
}

/** Fetch-based Supabase REST client (PostgREST + RPC). No `pg` dependency. */
export class SupabaseRestVectorClient implements PostgresVectorClient {
  constructor(private readonly config: PostgresConfig) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.config.url}${path}`, {
      ...init,
      headers: { ...restHeaders(this.config), ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(
        `Supabase REST ${init?.method ?? "GET"} ${path} failed with status ${res.status}`,
      );
    }
    return res;
  }

  async fetchHashes(documentId: string): Promise<StoredChunkHash[]> {
    const res = await this.request(
      `/rest/v1/chunks?document_id=eq.${encodeURIComponent(documentId)}&select=chunk_id,text_hash`,
    );
    return (await res.json()) as StoredChunkHash[];
  }

  async upsertRows(rows: ChunkRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.request("/rest/v1/chunks", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
  }

  async matchChunks(
    query: number[],
    topK: number,
    filters?: VectorQueryFilters,
  ): Promise<MatchRow[]> {
    const res = await this.request("/rest/v1/rpc/match_chunks", {
      method: "POST",
      body: JSON.stringify({
        query_embedding: query,
        match_count: topK,
        filter_document_id: filters?.documentId ?? null,
        filter_session: filters?.sessionId ?? null,
      }),
    });
    return (await res.json()) as MatchRow[];
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.request(
      `/rest/v1/chunks?document_id=eq.${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
  }

  async deleteBySession(sessionId: string): Promise<void> {
    // Cascades to pages/chunks via ON DELETE CASCADE (db/schema.sql).
    await this.request(
      `/rest/v1/documents?owner_session=eq.${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
  }
}

// ------------------------------------------------------------ pure ranking
// Same math as InMemoryCosineIndex (normalize once, dot product) with the
// P2 tie-break contract (score DESC, chunkId ASC). Used by the sync
// VectorStore seam below and exported for unit tests.

export interface RankableRecord {
  chunkId: string;
  documentId: string;
  page: number;
  quote: string;
  vector: number[];
}

function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const n of vector) sum += n * n;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector.slice();
  return vector.map((n) => n / norm);
}

/** Cosine rank with deterministic tie-break (score DESC, chunkId ASC). */
export function rankByCosine(
  records: RankableRecord[],
  query: number[],
  topK: number,
): RankedPassage[] {
  if (records.length === 0) return [];
  const qn = normalize(query);
  const scored = records.map((record) => {
    const rn = normalize(record.vector);
    let dot = 0;
    for (let i = 0; i < qn.length; i++) dot += qn[i] * rn[i];
    return { record, score: dot };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.record.chunkId !== b.record.chunkId) {
      return a.record.chunkId < b.record.chunkId ? -1 : 1;
    }
    if (a.record.documentId !== b.record.documentId) {
      return a.record.documentId < b.record.documentId ? -1 : 1;
    }
    return a.record.page - b.record.page;
  });
  const k = Math.max(0, Math.min(topK, scored.length));
  return scored.slice(0, k).map(({ record, score }) => ({
    documentId: record.documentId,
    page: record.page,
    chunkId: record.chunkId,
    quote: record.quote,
    score,
  }));
}

// ------------------------------------------------------------------ store

export interface UpsertResult {
  inserted: number;
  skipped: number;
}

export interface PostgresVectorStoreOptions {
  /** Injected client (unit tests). When omitted, a REST client is created lazily at call time. */
  client?: PostgresVectorClient;
  expectedDimension?: number;
}

/**
 * Persistent VectorStore. The sync VectorIndex seam (add/search/clear)
 * stages records in memory with identical ranking math; the async methods
 * persist to / read from Postgres. Session scoping rides the
 * documents.owner_session column (app/lib/session.ts sessionId).
 */
export class PostgresVectorStore implements VectorStore {
  private readonly injectedClient?: PostgresVectorClient;
  private readonly expectedDimension: number;
  private lazyClient?: PostgresVectorClient;
  private staged: RankableRecord[] = [];
  private stagedDims: number | null = null;

  constructor(opts: PostgresVectorStoreOptions = {}) {
    this.injectedClient = opts.client;
    this.expectedDimension = opts.expectedDimension ?? EMBEDDING_DIMENSION;
  }

  /** Embedding dimension once known, null while nothing is staged. */
  get dimension(): number | null {
    return this.stagedDims;
  }

  get size(): number {
    return this.staged.length;
  }

  private client(): PostgresVectorClient {
    if (this.injectedClient) return this.injectedClient;
    if (!this.lazyClient) {
      const config = resolvePostgresConfig();
      if (!config) throw new PostgresUnconfiguredError();
      this.lazyClient = new SupabaseRestVectorClient(config);
    }
    return this.lazyClient;
  }

  add(record: RankableRecord): void {
    if (!Array.isArray(record.vector) || record.vector.length === 0) {
      throw new Error("PostgresVectorStore.add: vector must be a non-empty number[]");
    }
    validateDimension(record.vector, this.expectedDimension);
    if (this.stagedDims === null) this.stagedDims = record.vector.length;
    this.staged.push(record);
  }

  /**
   * Rank staged vectors. Dimension mismatches throw DimensionError BEFORE
   * any scoring; an empty stage returns [] (refusal gating keeps working).
   */
  search(query: number[], topK: number): RankedPassage[] {
    if (this.staged.length === 0) return [];
    validateDimension(query, this.expectedDimension);
    return rankByCosine(this.staged, query, topK);
  }

  /** Drop staged vectors (mirrors session-close retention). */
  clear(): void {
    this.staged = [];
    this.stagedDims = null;
  }

  /**
   * Persist chunks, re-embedding only when the chunk text hash differs from
   * the stored row. `embeddings` maps chunkId -> freshly computed vector for
   * chunks that need it; chunks whose hash matches the stored row are
   * skipped without consulting `embeddings` (pass a throwing lookup in
   * tests to prove no re-embed happens). Returns inserted/skipped counts.
   */
  async upsertChunks(
    chunks: TextChunk[],
    embeddings: Map<string, number[]> | ((chunk: TextChunk) => number[] | undefined),
    opts: { documentId?: string } = {},
  ): Promise<UpsertResult> {
    const client = this.client();
    const lookup =
      typeof embeddings === "function"
        ? embeddings
        : (chunk: TextChunk) => embeddings.get(chunk.chunkId);
    const documentId = opts.documentId ?? chunks[0]?.documentId;
    const stored = new Map<string, string>();
    if (documentId !== undefined) {
      for (const row of await client.fetchHashes(documentId)) {
        stored.set(row.chunk_id, row.text_hash);
      }
    }
    const rows: ChunkRow[] = [];
    let skipped = 0;
    for (const chunk of chunks) {
      const textHash = textHashForSkip(chunk.text);
      if (stored.get(chunk.chunkId) === textHash) {
        skipped++;
        continue;
      }
      const vector = lookup(chunk);
      if (!vector) {
        throw new Error(
          `PostgresVectorStore.upsertChunks: no embedding for changed chunk ${chunk.chunkId}`,
        );
      }
      validateDimension(vector, this.expectedDimension);
      rows.push({
        chunk_id: chunk.chunkId,
        document_id: chunk.documentId,
        page_number: chunk.page,
        chunk_order: chunk.order,
        text: chunk.text,
        token_count: countTokens(chunk.text),
        char_start: chunk.charOffsets.start,
        char_end: chunk.charOffsets.end,
        section: chunk.section ?? null,
        text_hash: textHash,
        embedding: vector,
      });
    }
    await client.upsertRows(rows);
    return { inserted: rows.length, skipped };
  }

  /**
   * Cosine top-K from Postgres (match_chunks RPC) with optional
   * document/session scoping. Dimension check runs BEFORE any network call.
   * Results are re-sorted client-side (score DESC, chunkId ASC) and sliced
   * so the DB leg and the in-memory leg agree byte-for-byte on ties.
   */
  async queryTopK(
    query: number[],
    topK: number,
    filters: VectorQueryFilters = {},
  ): Promise<RankedPassage[]> {
    validateDimension(query, this.expectedDimension);
    const rows = await this.client().matchChunks(query, topK, filters);
    const mapped: RankedPassage[] = rows.map((row) => ({
      documentId: row.document_id,
      page: row.page_number,
      chunkId: row.chunk_id,
      quote: row.quote,
      score: row.score,
    }));
    mapped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.chunkId !== b.chunkId) return a.chunkId < b.chunkId ? -1 : 1;
      if (a.documentId !== b.documentId) {
        return a.documentId < b.documentId ? -1 : 1;
      }
      return a.page - b.page;
    });
    const k = Math.max(0, Math.min(topK, mapped.length));
    return mapped.slice(0, k);
  }

  /** Delete every chunk row for one document (pages/documents cascade separately). */
  async deleteDocument(documentId: string): Promise<void> {
    await this.client().deleteByDocument(documentId);
  }

  /** Delete a whole session scope (documents cascade to pages/chunks). */
  async deleteSession(sessionId: string): Promise<void> {
    await this.client().deleteBySession(sessionId);
  }
}
