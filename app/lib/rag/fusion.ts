// R4 RRF fusion (todo 27): Reciprocal Rank Fusion 1/(k+rank) over
// lexical + semantic legs. k=60 FIXED. Per-leg top-10 -> fused top-5
// with branch provenance {chunkId,finalRank,rrfScore,bm25Rank?,cosineRank?,docId,page}.
// No score-sum mixing. Single-leg degradation: if one leg empty, other leg alone
// still returns ranked results (rrfScore = 1/(k+rank) from that leg).
//
// This module is the ONLY place RRF logic lives. Consumers call fuseRRF()
// with two pre-ranked arrays; they do not mix scores themselves.

import type { RankedPassage } from "@/app/lib/rag/embeddings";

export const RRF_K = 60;

/** Provenance record for a fused result, carrying branch ranks. */
export interface FusedPassage extends RankedPassage {
  /** Final 0-based position in the fused output. */
  rank: number;
  /** RRF score = sum(1/(k+rank+1)) over contributing legs. */
  rrfScore: number;
  /** 0-based rank in the lexical leg, if present. */
  bm25Rank?: number;
  /** 0-based rank in the semantic leg, if present. */
  cosineRank?: number;
  /** Source documentId (alias for documentId for clarity). */
  docId: string;
  /** Chunk order within page (from semantic leg; 0 for lexical-only). */
  order: number;
}

/**
 * Reciprocal Rank Fusion over two pre-ranked passage arrays.
 *
 * - k=60 FIXED (no weights exist in RRF).
 * - Each leg contributes top-10 passages (caller MUST pre-slice).
 * - Fused output is top-5 passages.
 * - Single-leg degradation: if one leg is empty, the other leg's passages
 *   are ranked by their own 1/(k+rank) and returned as top-5.
 * - Deterministic tie-break: higher rrfScore -> lower rank; then chunkId,
 *   then documentId, then page.
 */
export function fuseRRF(
  lexicalTop10: RankedPassage[],
  semanticTop10: RankedPassage[],
  maxFused = 5
): FusedPassage[] {
  const k = RRF_K;

  // Map: chunkId -> { passage, bm25Rank?, cosineRank? }
  const fusedMap = new Map<string, { passage: RankedPassage; bm25Rank?: number; cosineRank?: number }>();

  // Process lexical leg
  for (let i = 0; i < lexicalTop10.length; i++) {
    const p = lexicalTop10[i];
    const key = p.chunkId;
    const existing = fusedMap.get(key);
    if (existing) {
      existing.bm25Rank = i;
    } else {
      fusedMap.set(key, { passage: p, bm25Rank: i });
    }
  }

  // Process semantic leg
  for (let i = 0; i < semanticTop10.length; i++) {
    const p = semanticTop10[i];
    const key = p.chunkId;
    const existing = fusedMap.get(key);
    if (existing) {
      existing.cosineRank = i;
    } else {
      fusedMap.set(key, { passage: p, cosineRank: i });
    }
  }

  // Compute RRF score for each unique passage
  const scored: FusedPassage[] = [];
  for (const { passage, bm25Rank, cosineRank } of fusedMap.values()) {
    let rrfScore = 0;
    if (bm25Rank !== undefined) {
      rrfScore += 1 / (k + bm25Rank + 1); // rank is 0-based, RRF uses 1-based
    }
    if (cosineRank !== undefined) {
      rrfScore += 1 / (k + cosineRank + 1);
    }
    // Get order from semantic leg if available (CosineRankedPassage has order), else 0
    const order = "order" in passage ? (passage as any).order : 0;
    scored.push({
      ...passage,
      docId: passage.documentId,
      rank: -1, // will be set after sort
      rrfScore,
      bm25Rank,
      cosineRank,
      order,
    });
  }

  // Deterministic sort: rrfScore desc, then chunkId, then documentId, then page
  scored.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    if (a.chunkId !== b.chunkId) return a.chunkId < b.chunkId ? -1 : 1;
    if (a.documentId !== b.documentId) return a.documentId < b.documentId ? -1 : 1;
    return a.page - b.page;
  });

  // Assign final ranks and slice to maxFused
  const kOut = Math.max(0, Math.min(maxFused, scored.length));
  return scored.slice(0, kOut).map((p, rank) => ({ ...p, rank }));
}

/**
 * RRF over a single leg (degradation path). Returns top-maxFused ranked by
 * 1/(k+rank). Preserves the same FusedPassage shape with empty branch ranks.
 */
export function fuseSingleLeg(
  passages: RankedPassage[],
  maxFused = 5
): FusedPassage[] {
  const k = RRF_K;
  const scored: FusedPassage[] = passages.slice(0, 10).map((p, i) => {
    const order = "order" in p ? (p as any).order : 0;
    return {
      ...p,
      docId: p.documentId,
      rank: i,
      rrfScore: 1 / (k + i + 1),
      bm25Rank: undefined,
      cosineRank: undefined,
      order,
    };
  });

  // Already in rank order from the caller; just assign final ranks and slice
  const kOut = Math.max(0, Math.min(maxFused, scored.length));
  return scored.slice(0, kOut).map((p, rank) => ({ ...p, rank }));
}

/**
 * High-level fusion dispatcher. Given two retriever legs (which may be
 * missing/empty), returns the fused top-5.
 *
 * - If both legs have results: full RRF.
 * - If only one leg has results: single-leg degradation.
 * - If both legs empty: returns [] (refusal gating handles this).
 */
export async function retrieveFused(
  lexicalRetriever: () => Promise<RankedPassage[]>,
  semanticRetriever: () => Promise<RankedPassage[]>,
  maxFused = 5
): Promise<FusedPassage[]> {
  const [lexicalResults, semanticResults] = await Promise.all([
    lexicalRetriever().catch(() => []),
    semanticRetriever().catch(() => []),
  ]);

  // Ensure both are arrays (defensive)
  const lex = Array.isArray(lexicalResults) ? lexicalResults : [];
  const sem = Array.isArray(semanticResults) ? semanticResults : [];

  if (lex.length > 0 && sem.length > 0) {
    return fuseRRF(lex.slice(0, 10), sem.slice(0, 10), maxFused);
  }
  if (lex.length > 0) {
    return fuseSingleLeg(lex, maxFused);
  }
  if (sem.length > 0) {
    return fuseSingleLeg(sem, maxFused);
  }
  return [];
}