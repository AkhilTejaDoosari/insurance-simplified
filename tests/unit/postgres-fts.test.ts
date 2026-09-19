// Todo 58 unit tests: FTS candidate leg pure logic. No DB, no credentials.
import { describe, expect, it } from "vitest";
import {
  buildFtsQuery,
  rankFtsRows,
  retrieveFtsCandidate,
  type FtsRow,
} from "@/app/lib/rag/postgres-fts";

describe("buildFtsQuery", () => {
  it("preserves exact surface forms (F-1, OPT, PPO, %, amounts)", () => {
    expect(buildFtsQuery("  F-1 visa OPT  $250  20%  PPO\nprecertification ")).toBe(
      "F-1 visa OPT $250 20% PPO precertification",
    );
  });

  it("caps length and trims to empty", () => {
    expect(buildFtsQuery("   ")).toBe("");
    expect(buildFtsQuery("x".repeat(600)).length).toBe(500);
  });
});

describe("rankFtsRows", () => {
  const rows: FtsRow[] = [
    { chunk_id: "c-zed", document_id: "doc-a", page_number: 2, quote: "z", rank: 0.8 },
    { chunk_id: "c-aye", document_id: "doc-a", page_number: 1, quote: "F-1 visa holders eligible", rank: 0.8 },
    { chunk_id: "c-top", document_id: "doc-b", page_number: 1, quote: "$250 deductible", rank: 0.95 },
  ];

  it("orders rank desc with deterministic chunkId-asc tie-break", () => {
    const out = rankFtsRows(rows, 10);
    expect(out.map((p) => p.chunkId)).toEqual(["c-top", "c-aye", "c-zed"]);
  });

  it("carries chunk->document->page->quote provenance and slices topK", () => {
    const out = rankFtsRows(rows, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      documentId: "doc-b",
      page: 1,
      chunkId: "c-top",
      quote: "$250 deductible",
      score: 0.95,
    });
  });

  it("returns [] on empty input", () => {
    expect(rankFtsRows([], 5)).toEqual([]);
  });
});

describe("retrieveFtsCandidate", () => {
  it("resolves [] without DB credentials (honest skip, never fake success)", async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      await expect(retrieveFtsCandidate("F-1 visa eligibility")).resolves.toEqual([]);
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_KEY = savedKey;
    }
  });

  it("resolves [] on empty queries without touching the client", async () => {
    const searchFts = () => {
      throw new Error("must not query on empty input");
    };
    await expect(retrieveFtsCandidate("   ", { client: { searchFts } })).resolves.toEqual([]);
  });

  it("maps injected-client rows with provenance + tie-break", async () => {
    const client = {
      searchFts: async (): Promise<FtsRow[]> => [
        { chunk_id: "c-b", document_id: "plan-a.pdf", page_number: 1, quote: "PPO network applies", rank: 0.5 },
        { chunk_id: "c-a", document_id: "plan-a.pdf", page_number: 1, quote: "F-1 visa required", rank: 0.5 },
      ],
    };
    const out = await retrieveFtsCandidate("F-1 visa PPO", { client, topK: 5 });
    expect(out.map((p) => p.chunkId)).toEqual(["c-a", "c-b"]);
    expect(out[0]).toMatchObject({ documentId: "plan-a.pdf", page: 1 });
  });
});
