import { describe, expect, it } from "vitest";
import { DimensionError } from "@/app/lib/rag/embeddings";
import {
  InMemoryCosineIndex,
  type CosineRankedPassage,
} from "@/app/lib/rag/cosine-index";

const rec = (chunkId: string, vector: number[], page = 1) => ({
  chunkId,
  documentId: "doc-a",
  page,
  quote: `quote-${chunkId}`,
  vector,
});

function ranked(index: InMemoryCosineIndex, query: number[], topK: number): CosineRankedPassage[] {
  return index.searchWithRanks(query, topK);
}

describe("in-memory cosine index", () => {
  it("ranks synthetic vectors in the known order", () => {
    const index = new InMemoryCosineIndex();
    index.add(rec("c-ortho", [0, 1]));
    index.add(rec("c-best", [1, 0]));
    index.add(rec("c-mid", [1, 1]));
    const out = ranked(index, [1, 0], 3);
    expect(out.map((p) => p.chunkId)).toEqual(["c-best", "c-mid", "c-ortho"]);
    expect(out[0].score).toBeCloseTo(1, 10);
    expect(out[2].score).toBeCloseTo(0, 10);
  });

  it("returns the identical order on repeated queries (deterministic)", () => {
    const index = new InMemoryCosineIndex();
    index.add(rec("c-a", [1, 0]));
    index.add(rec("c-b", [0, 1]));
    index.add(rec("c-c", [1, 1]));
    const first = ranked(index, [1, 1], 3).map((p) => p.chunkId);
    const second = ranked(index, [1, 1], 3).map((p) => p.chunkId);
    expect(second).toEqual(first);
  });

  it("breaks exact ties deterministically by chunkId", () => {
    const index = new InMemoryCosineIndex();
    index.add(rec("c-zed", [1, 0]));
    index.add(rec("c-aye", [1, 0]));
    const out = ranked(index, [1, 0], 2);
    expect(out.map((p) => p.chunkId)).toEqual(["c-aye", "c-zed"]);
    expect(ranked(index, [1, 0], 2).map((p) => p.chunkId)).toEqual(["c-aye", "c-zed"]);
  });

  it("normalizes vectors: identical direction scores 1 regardless of magnitude", () => {
    const index = new InMemoryCosineIndex();
    index.add(rec("c-scaled", [3, 4]));
    const out = ranked(index, [6, 8], 1);
    expect(out[0].score).toBeCloseTo(1, 10);
  });

  it("carries provenance chunkId/documentId/page/order/rank/score", () => {
    const index = new InMemoryCosineIndex();
    index.add(rec("c-one", [1, 0], 5));
    const out = ranked(index, [1, 0], 1);
    expect(out[0]).toMatchObject({
      chunkId: "c-one",
      documentId: "doc-a",
      page: 5,
      order: 0,
      rank: 0,
    });
    expect(typeof out[0].score).toBe("number");
    expect(typeof out[0].quote).toBe("string");
  });

  it("throws DimensionError naming expected vs received dims before any ranking", () => {
    const index = new InMemoryCosineIndex();
    index.add(rec("c-ok", [1, 0, 0]));
    expect(() => index.add(rec("c-bad", [1, 0]))).toThrowError(DimensionError);
    expect(() => index.add(rec("c-bad", [1, 0]))).toThrowError(/expected 3.*received 2/s);
    expect(() => index.search([1, 0], 5)).toThrowError(DimensionError);
    expect(() => index.search([1, 0], 5)).toThrowError(/expected 3.*received 2/s);
    expect(index.size).toBe(1);
  });

  it("returns [] on an empty index and clears vectors on clear()", () => {
    const index = new InMemoryCosineIndex();
    expect(index.search([1, 0], 5)).toEqual([]);
    expect(index.dimension).toBeNull();
    index.add(rec("c-one", [1, 0]));
    expect(index.size).toBe(1);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.dimension).toBeNull();
    expect(index.search([1, 0], 5)).toEqual([]);
  });
});
