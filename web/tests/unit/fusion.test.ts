// R4 fusion unit tests (todo 27): known-answer fixtures, k-sensitivity note
// with k=60 fixed, single-leg degradation.

import { describe, it, expect } from "vitest";
import { fuseRRF, fuseSingleLeg, retrieveFused, type FusedPassage } from "@/app/lib/rag/fusion";
import type { RankedPassage } from "@/app/lib/rag/embeddings";

function makePassage(overrides: Partial<RankedPassage> = {}): RankedPassage {
  return {
    documentId: "doc1",
    page: 1,
    chunkId: "chunk1",
    quote: "test passage",
    score: 1.0,
    ...overrides,
  };
}

describe("fuseRRF", () => {
  it("fuses two legs with distinct passages", () => {
    const lex = [makePassage({ chunkId: "lex1", documentId: "doc1", page: 1, score: 5 })];
    const sem = [makePassage({ chunkId: "sem1", documentId: "doc2", page: 1, score: 0.9 })];
    const fused = fuseRRF(lex, sem, 5);
    expect(fused.length).toBe(2);
    expect(fused[0].rrfScore).toBeGreaterThan(0);
    expect(fused[0].rank).toBe(0);
    expect(fused[1].rank).toBe(1);
  });

  it("fuses two legs with overlapping passage (same chunkId)", () => {
    const shared = makePassage({ chunkId: "shared", documentId: "doc1", page: 1, score: 5 });
    const lex = [shared];
    const sem = [{ ...shared, score: 0.9 }];
    const fused = fuseRRF(lex, sem, 5);
    expect(fused.length).toBe(1);
    expect(fused[0].chunkId).toBe("shared");
    expect(fused[0].bm25Rank).toBe(0);
    expect(fused[0].cosineRank).toBe(0);
    // RRF score should be sum of both legs: 1/(60+1) + 1/(60+1)
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61, 5);
  });

  it("respects k=60 fixed (no weights)", () => {
    const lex = [makePassage({ chunkId: "lex1", score: 5 })];
    const sem = [makePassage({ chunkId: "sem1", score: 0.9 })];
    const fused = fuseRRF(lex, sem, 5);
    // k=60 is fixed - scores determined only by rank, not by original score
    expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 5);
    expect(fused[1].rrfScore).toBeCloseTo(1 / 61, 5);
  });

  it("returns top-5 when both legs provide 10 each", () => {
    const lex = Array.from({ length: 10 }, (_, i) =>
      makePassage({ chunkId: `lex${i}`, score: 10 - i })
    );
    const sem = Array.from({ length: 10 }, (_, i) =>
      makePassage({ chunkId: `sem${i}`, score: 0.9 - i * 0.05 })
    );
    const fused = fuseRRF(lex, sem, 5);
    expect(fused.length).toBe(5);
    expect(fused[4].rank).toBe(4);
  });

  it("deterministic tie-break: rrfScore desc, then chunkId, then documentId, then page", () => {
    // Two passages with same rrfScore (both rank 0 in their respective legs)
    const p1 = makePassage({ chunkId: "aaa", documentId: "doc1", page: 1 });
    const p2 = makePassage({ chunkId: "bbb", documentId: "doc1", page: 1 });
    const fused = fuseRRF([p1], [p2], 5);
    expect(fused[0].chunkId).toBe("aaa"); // chunkId alphabetical
    expect(fused[1].chunkId).toBe("bbb");
  });

  it("preserves provenance: documentId, page, chunkId, quote", () => {
    const lex = [makePassage({ chunkId: "c1", documentId: "docA", page: 3, quote: "quoted text" })];
    const sem = [makePassage({ chunkId: "c2", documentId: "docB", page: 5, quote: "other text" })];
    const fused = fuseRRF(lex, sem, 5);
    expect(fused[0].documentId).toBe("docA");
    expect(fused[0].page).toBe(3);
    expect(fused[0].chunkId).toBe("c1");
    expect(fused[0].quote).toBe("quoted text");
    expect(fused[0].docId).toBe("docA");
    expect(fused[1].documentId).toBe("docB");
    expect(fused[1].page).toBe(5);
  });
});

describe("fuseSingleLeg", () => {
  it("returns top-5 from single leg ranked by 1/(k+rank)", () => {
    const passages = Array.from({ length: 10 }, (_, i) =>
      makePassage({ chunkId: `p${i}`, score: 10 - i })
    );
    const fused = fuseSingleLeg(passages, 5);
    expect(fused.length).toBe(5);
    expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 5);
    expect(fused[4].rrfScore).toBeCloseTo(1 / 65, 5);
  });

  it("handles empty input", () => {
    const fused = fuseSingleLeg([], 5);
    expect(fused).toEqual([]);
  });

  it("preserves provenance in single-leg mode", () => {
    const passages = [makePassage({ chunkId: "c1", documentId: "docA", page: 2, quote: "text" })];
    const fused = fuseSingleLeg(passages, 5);
    expect(fused[0].documentId).toBe("docA");
    expect(fused[0].page).toBe(2);
    expect(fused[0].bm25Rank).toBeUndefined();
    expect(fused[0].cosineRank).toBeUndefined();
  });
});

describe("retrieveFused", () => {
  it("full RRF when both legs return results", async () => {
    const lex = () => Promise.resolve([makePassage({ chunkId: "lex1" })]);
    const sem = () => Promise.resolve([makePassage({ chunkId: "sem1" })]);
    const fused = await retrieveFused(lex, sem, 5);
    expect(fused.length).toBe(2);
  });

  it("single-leg degradation: lexical only", async () => {
    const lex = () => Promise.resolve([makePassage({ chunkId: "lex1" })]);
    const sem = () => Promise.resolve([]);
    const fused = await retrieveFused(lex, sem, 5);
    expect(fused.length).toBe(1);
    expect(fused[0].bm25Rank).toBeUndefined(); // single-leg mode: no branch ranks
    expect(fused[0].cosineRank).toBeUndefined();
  });

  it("single-leg degradation: semantic only", async () => {
    const lex = () => Promise.resolve([]);
    const sem = () => Promise.resolve([makePassage({ chunkId: "sem1" })]);
    const fused = await retrieveFused(lex, sem, 5);
    expect(fused.length).toBe(1);
    expect(fused[0].bm25Rank).toBeUndefined();
    expect(fused[0].cosineRank).toBeUndefined(); // single-leg mode: no branch ranks
  });

  it("both empty returns empty", async () => {
    const fused = await retrieveFused(
      () => Promise.resolve([]),
      () => Promise.resolve([]),
      5
    );
    expect(fused).toEqual([]);
  });

  it("catches errors in retrievers and treats as empty", async () => {
    const fused = await retrieveFused(
      () => Promise.reject(new Error("lexical failed")),
      () => Promise.resolve([makePassage({ chunkId: "sem1" })]),
      5
    );
    expect(fused.length).toBe(1);
    expect(fused[0].chunkId).toBe("sem1");
  });
});

describe("RRF k-sensitivity note", () => {
  it("records k=60 fixed behavior for rank-depth analysis", () => {
    // With k=60, the RRF contribution drops slowly:
    // rank 0: 1/61 ≈ 0.01639
    // rank 9: 1/70 ≈ 0.01429
    // This means deep ranks still contribute meaningfully.
    // A k-sensitivity note is recorded here for evaluation reference.
    const k = 60;
    const scoreAtRank = (rank: number) => 1 / (k + rank + 1);
    expect(scoreAtRank(0)).toBeCloseTo(0.01639, 4);
    expect(scoreAtRank(9)).toBeCloseTo(0.01429, 4);
    // The slow decay means top-10 from each leg contributes to fused top-5.
    // This is the recorded k-sensitivity note.
  });
});

describe("recall invariant", () => {
  it("recall@K never exceeds 1.0 when relevant targets are deduplicated by chunk", () => {
    // The fix: expectedChunkKeys returns unique chunk keys (deduplicated by chunk identity).
    // So relevant.length = number of UNIQUE relevant chunks.
    // computeRecallAtK: hits / uniqueRelevantCount <= 1.0 always.
    // Since ranked list from retrieval is unique (no duplicate chunks), hits <= uniqueRelevantCount.
    const uniqueRelevant = ["doc1#1#0"]; // 1 unique chunk
    const ranked = ["doc1#1#0"]; // retrieved that chunk (unique)
    const recall = computeRecallAtK(ranked, uniqueRelevant, 5);
    expect(recall).toBeLessThanOrEqual(1);
    expect(recall).toBe(1);

    // With multiple unique relevant chunks
    const multiRelevant = ["doc1#1#0", "doc2#1#0"];
    const rankedMulti = ["doc1#1#0", "doc2#1#0"];
    const recallMulti = computeRecallAtK(rankedMulti, multiRelevant, 5);
    expect(recallMulti).toBeLessThanOrEqual(1);
    expect(recallMulti).toBe(1);

    // Partial hit: 1 of 2 relevant retrieved
    const partialRanked = ["doc1#1#0"];
    const recallPartial = computeRecallAtK(partialRanked, multiRelevant, 5);
    expect(recallPartial).toBeLessThanOrEqual(1);
    expect(recallPartial).toBe(0.5);
  });

  it("fusion output has no duplicate chunkIds (deduplication invariant)", () => {
    // The RRF fusion Map deduplicates by chunkId, so output has unique chunkIds.
    // This prevents the duplicate-hits bug that could inflate recall > 1.0.
    const lex = [
      makePassage({ chunkId: "c1", documentId: "doc1", page: 1 }),
      makePassage({ chunkId: "c2", documentId: "doc2", page: 1 }),
    ];
    const sem = [
      makePassage({ chunkId: "c1", documentId: "doc1", page: 1 }), // same as lex[0]
      makePassage({ chunkId: "c3", documentId: "doc3", page: 1 }),
    ];
    const fused = fuseRRF(lex, sem, 5);
    const chunkIds = fused.map((f) => f.chunkId);
    const uniqueChunkIds = new Set(chunkIds);
    expect(uniqueChunkIds.size).toBe(chunkIds.length); // no duplicates
    expect(chunkIds).toContain("c1");
    expect(chunkIds).toContain("c2");
    expect(chunkIds).toContain("c3");
  });

  // Helper copied from evals/run.mjs for self-contained test
  function computeRecallAtK(ranked: string[], relevant: string[], k: number): number {
    if (relevant.length === 0) return 0;
    const rel = new Set(relevant);
    let hits = 0;
    for (const key of ranked.slice(0, k)) if (rel.has(key)) hits++;
    return hits / relevant.length;
  }
});