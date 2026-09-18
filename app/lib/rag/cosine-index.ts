// R3 in-memory cosine index (todo 22): per-session brute-force ranker behind
// the VectorIndex/VectorStore seam from app/lib/rag/embeddings.ts (todo 21).
//
// Design: normalized-matrix exhaustive cosine. Each added vector is L2-
// normalized once at insert; search normalizes the query and scores via dot
// product, sorting score-desc with an explicit chunkId/documentId/page
// tie-break so repeated queries return byte-identical order. No ANN, no
// persistent DB, no pgvector runtime: vectors live in process memory only and
// clear() drops them (callers invoke clear() on session close alongside
// deleteSession(), which removes the session tmpdir — FR-019).
//
// Provenance note: the shared RankedPassage contract carries
// documentId/page/chunkId/quote/score with rank as array position, and neither
// VectorRecord nor RankedPassage has an order/rank field — so this module adds
// CosineRankedPassage (order = insertion sequence, rank = 0-based output
// position) WITHOUT touching embeddings.ts. Chunk page-order stays recoverable
// via chunkId lookup in app/lib/rag/chunks.ts. This module MUST NOT import
// anything from app/lib/extraction/* (separate paths).

import {
  DimensionError,
  type RankedPassage,
  type VectorRecord,
  type VectorStore,
} from "@/app/lib/rag/embeddings";

/** RankedPassage plus explicit insertion order and output rank. */
export interface CosineRankedPassage extends RankedPassage {
  /** 0-based sequence in which the record was added to this index. */
  order: number;
  /** 0-based position in the ranked output (0 = best). */
  rank: number;
}

interface Entry {
  record: VectorRecord;
  /** L2-normalized copy of record.vector (unit length, unless zero norm). */
  norm: number[];
  order: number;
}

function normOf(vector: number[]): number {
  let sum = 0;
  for (const n of vector) sum += n * n;
  return Math.sqrt(sum);
}

function normalize(vector: number[]): number[] {
  const norm = normOf(vector);
  if (norm === 0) return vector.slice();
  return vector.map((n) => n / norm);
}

/**
 * Per-session exhaustive cosine index. Not thread-shared by design: one
 * instance per session, dropped (clear()) when the session closes.
 */
export class InMemoryCosineIndex implements VectorStore {
  private entries: Entry[] = [];
  private dims: number | null = null;

  /** Embedding dimension once known, null while the index is empty. */
  get dimension(): number | null {
    return this.dims;
  }

  get size(): number {
    return this.entries.length;
  }

  private checkVector(vector: number[]): void {
    if (this.dims === null) return;
    if (vector.length !== this.dims) {
      throw new DimensionError(this.dims, vector.length);
    }
  }

  add(record: VectorRecord): void {
    if (!Array.isArray(record.vector) || record.vector.length === 0) {
      throw new Error("InMemoryCosineIndex.add: vector must be a non-empty number[]");
    }
    if (this.dims === null) {
      this.dims = record.vector.length;
    } else {
      this.checkVector(record.vector);
    }
    this.entries.push({
      record,
      norm: normalize(record.vector),
      order: this.entries.length,
    });
  }

  /**
   * Rank all stored vectors against the query. Dimension mismatches throw
   * DimensionError BEFORE any scoring. Empty index returns [] (never null,
   * never a throw) so refusal gating keeps working.
   */
  search(query: number[], topK: number): RankedPassage[] {
    return this.searchWithRanks(query, topK);
  }

  /** Same as search(), with explicit order/rank provenance attached. */
  searchWithRanks(query: number[], topK: number): CosineRankedPassage[] {
    if (this.entries.length === 0) return [];
    this.checkVector(query);
    const qn = normalize(query);
    const scored = this.entries.map((entry) => {
      let dot = 0;
      for (let i = 0; i < qn.length; i++) dot += qn[i] * entry.norm[i];
      return { entry, score: dot };
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.entry.record.chunkId !== b.entry.record.chunkId) {
        return a.entry.record.chunkId < b.entry.record.chunkId ? -1 : 1;
      }
      if (a.entry.record.documentId !== b.entry.record.documentId) {
        return a.entry.record.documentId < b.entry.record.documentId ? -1 : 1;
      }
      return a.entry.record.page - b.entry.record.page;
    });
    const k = Math.max(0, Math.min(topK, scored.length));
    return scored.slice(0, k).map(({ entry, score }, rank) => ({
      documentId: entry.record.documentId,
      page: entry.record.page,
      chunkId: entry.record.chunkId,
      quote: entry.record.quote,
      score,
      order: entry.order,
      rank,
    }));
  }

  /** Drop all vectors (session close). Resets the known dimension. */
  clear(): void {
    this.entries = [];
    this.dims = null;
  }
}
