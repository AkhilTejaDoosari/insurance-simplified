// M5 over-fetch (roadmap M5, quality.md §4): every retriever leg supplies
// 30–50 candidates before the page-provenance filter, fusion and the final
// top-k cut. No provider is called: embeddings and the persistent leg are
// mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedPassage } from "@/app/lib/rag/embeddings";

const persistent = vi.hoisted(() => ({ rows: [] as RankedPassage[] }));

vi.mock("@/app/lib/rag/embeddings", () => ({
  isEmbeddingConfigured: () => true,
  embedTexts: vi.fn(),
}));
vi.mock("@/app/lib/rag/persist-session", () => ({
  // Behaves like the DB: returns at most topK rows, best first.
  retrievePersistentSemantic: vi.fn(
    async (_q: string, _s: string, topK: number) =>
      persistent.rows.slice(0, topK),
  ),
}));

import { answerQuestionSemantic } from "@/app/lib/rag/answer";
import { CANDIDATES_PER_LEG, retrieveFused } from "@/app/lib/rag/fusion";
import { retrievePersistentSemantic } from "@/app/lib/rag/persist-session";

const docs = [
  {
    documentId: "a",
    filename: "a.pdf",
    pageCount: 1,
    pages: ["Selected deductible 250"],
  },
];

function passage(chunkId: string, quote: string, score: number): RankedPassage {
  return { documentId: "a", page: 1, chunkId, quote, score };
}

describe("M5 over-fetch per leg", () => {
  beforeEach(() => {
    vi.mocked(retrievePersistentSemantic).mockClear();
  });

  it("over-fetch depth is within the 30–50 band", () => {
    expect(CANDIDATES_PER_LEG).toBeGreaterThanOrEqual(30);
    expect(CANDIDATES_PER_LEG).toBeLessThanOrEqual(50);
  });

  it("asks the persistent semantic leg for CANDIDATES_PER_LEG candidates, session-scoped", async () => {
    persistent.rows = [passage("own", "Selected deductible 250", 0.9)];
    await answerQuestionSemantic(docs, "deductible", {
      sessionId: "session-x",
    });
    expect(retrievePersistentSemantic).toHaveBeenCalledTimes(1);
    const [, sessionId, topK, documentIds] = vi.mocked(
      retrievePersistentSemantic,
    ).mock.calls[0];
    expect(sessionId).toBe("session-x");
    expect(topK).toBe(CANDIDATES_PER_LEG);
    expect(documentIds).toEqual(["a"]);
  });

  it("a verified candidate below rank 16 still answers when higher candidates fail page provenance", async () => {
    // 20 candidates whose quotes are not on the session page (stale or
    // foreign text) outrank the one verifiable chunk. With a 16-deep fetch
    // the verifiable chunk was never seen; the over-fetched pool finds it.
    persistent.rows = [
      ...Array.from({ length: 20 }, (_, i) =>
        passage(`stale-${i}`, `stale text ${i}`, 0.99 - i * 0.001),
      ),
      passage("own", "Selected deductible 250", 0.9),
    ];
    // Only the semantic leg is consulted (it is useful); the passage shown
    // must name the question's topic (P0-02), so the question says
    // "deductible". With a 16-deep fetch only stale chunks are seen and the
    // outcome is a plain refusal without passages.
    const result = await answerQuestionSemantic(
      docs,
      "which deductible applies before coverage starts",
      {
        sessionId: "session-x",
      },
    );
    expect(result.kind).toBe("refusal");
    expect(result.kind === "refusal" && result.citations?.length).toBeGreaterThan(0);
    const text = JSON.stringify(result);
    expect(text).toContain("Selected deductible 250");
    expect(text).not.toContain("stale text");
  });
});

describe("M5 over-fetch before fusion", () => {
  it("fusion sees candidates beyond rank 10 of each leg", async () => {
    // "both" sits at rank 15 in BOTH legs: RRF 2/(60+16) beats any single-leg
    // rank-0 item (1/61). A 10-deep cut would never let it reach fusion.
    const lex = Array.from({ length: CANDIDATES_PER_LEG }, (_, i) =>
      passage(i === 15 ? "both" : `lex-${i}`, `lex ${i}`, 100 - i),
    );
    const sem = Array.from({ length: CANDIDATES_PER_LEG }, (_, i) =>
      passage(i === 15 ? "both" : `sem-${i}`, `sem ${i}`, 1 - i / 100),
    );
    const fused = await retrieveFused(
      () => Promise.resolve(lex),
      () => Promise.resolve(sem),
      5,
    );
    expect(fused[0].chunkId).toBe("both");
    expect(fused[0].bm25Rank).toBe(15);
    expect(fused[0].cosineRank).toBe(15);
  });
});
