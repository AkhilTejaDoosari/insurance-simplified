// P3-D ingestion idempotency: retries / duplicate uploads create no
// duplicate derived state.
//
// Content addressing (additive; the upload route keeps its positional
// doc-N ids for session responses, and uses these helpers to detect
// identical bytes):
//   * documentKeyForBytes() — sha256 hex of the raw upload bytes. Re-upload
//     of identical bytes yields the same key, so the second upload can reuse
//     (or reference) the first document instead of re-deriving state.
//   * stableDocumentIdForKey() — deterministic session-independent document
//     id derived from the content key (`doc-<12 hex>`). Same bytes → same id.
//   * dedupeByChunkId() — collapse retry-produced duplicate chunk rows to a
//     single set keyed by chunkId (chunkIds are already content-stable via
//     chunkIdFor(doc, page, order, sha16(text)) in app/lib/rag/chunks.ts, so
//     identical text re-chunks identically).
//   * Provenance stability rides evidenceIdFor() (app/lib/evidence-ids.ts):
//     deterministic over (documentId, page, quote), so identical reprocessing
//     resolves the same evidenceIds — covered by the idempotency tests.
//   * Embedding-level dedupe rides PostgresVectorStore.upsertChunks hash-skip
//     (app/lib/rag/postgres-vector.ts): chunks whose text_hash matches the
//     stored row are skipped without re-embed. The tests below prove the
//     second identical pass inserts 0 rows with a throwing embed lookup.
//
// Retry contract (also documented in db/README.md):
//   * upload-by-content-hash: IDEMPOTENT (same bytes → same key/id, no new
//     chunks/embeddings).
//   * upsertChunks with unchanged text: IDEMPOTENT (hash-skip, 0 inserts).
//   * chat / answer paths: NOT idempotent (each call re-reasons; use the
//     session evidence registry for stable citation ids).

import { createHash } from "node:crypto";
import type { TextChunk } from "@/app/lib/rag/chunks";

/** sha256 hex of raw bytes (accepts Buffer/Uint8Array for route/test use). */
export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Content key for an upload: identical bytes → identical key. */
export function documentKeyForBytes(bytes: Uint8Array | Buffer): string {
  return sha256Hex(bytes);
}

/**
 * Deterministic document id for a content key. Same bytes → same id, so a
 * retried/duplicate upload resolves to the same document instead of
 * allocating a second one.
 */
export function stableDocumentIdForKey(key: string): string {
  const hex = key.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("stableDocumentIdForKey: expected a 64-char sha256 hex key");
  }
  return `doc-${hex.slice(0, 12)}`;
}

export interface DedupeResult {
  chunks: TextChunk[];
  duplicateCount: number;
}

/**
 * Collapse chunks to a single set keyed by chunkId, preserving first-seen
 * order. Retries that re-chunk identical pages produce identical chunkIds,
 * so the second pass contributes only duplicates (duplicateCount > 0) and
 * the returned set stays single-copy.
 */
export function dedupeByChunkId(chunks: TextChunk[]): DedupeResult {
  const seen = new Map<string, TextChunk>();
  let duplicateCount = 0;
  for (const chunk of chunks) {
    if (seen.has(chunk.chunkId)) {
      duplicateCount++;
      continue;
    }
    seen.set(chunk.chunkId, chunk);
  }
  return { chunks: [...seen.values()], duplicateCount };
}
