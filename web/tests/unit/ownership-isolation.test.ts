// Todo 62 adversarial ownership test: owner B can never reach owner A's
// chunks. No live DB — the fake client below emulates the match_chunks /
// fts_search_chunks SQL semantics from db/schema.sql (conjunctive
// document + session predicates over documents.owner_session), while the
// store seam (requireScopeId) is the real production code under test.
//
// What this proves: scope plumbing forwards the caller's opaque session id
// to the RPC filter on every path, cross-scope documentIds do not leak, and
// unscoped calls throw instead of searching all owners.
//
// What this does NOT prove (stated honestly): DB-enforced RLS. There are no
// RLS policies in db/schema.sql or db/migrations, so isolation here is the
// client-side seam + the RPC filter_session predicate. RLS is NOT claimed.
import { describe, expect, it, vi } from "vitest";
import {
  PostgresVectorStore,
  type MatchRow,
  type PostgresVectorClient,
  type StoredChunkHash,
} from "@/app/lib/rag/postgres-vector";
import {
  retrieveFtsCandidate,
  type FtsClient,
  type FtsRow,
} from "@/app/lib/rag/postgres-fts";
import {
  UnscopedQueryError,
  isOpaqueScopeId,
  requireScopeId,
} from "@/app/lib/rag/ownership";

const DIM = 4;
const OWNER_A = "sess-owner-a-01";
const OWNER_B = "sess-owner-b-02";
const DOC_A = "doc-owner-a";
const DOC_B = "doc-owner-b";

const vec = (values: number[]): number[] => values;

interface FakeChunk {
  chunkId: string;
  documentId: string;
  page: number;
  quote: string;
  vector: number[];
}

function cosine(a: number[], b: number[]): number {
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, n) => s + n * n, 0));
  const dot = a.reduce((s, n, i) => s + n * b[i], 0);
  return dot / (norm(a) * norm(b));
}

// Fake transport with match_chunks SQL semantics: rows are visible only
// when the documents.owner_session join matches filter_session, ANDed with
// the optional document filter. Throws on missing scope like the real
// REST client (defense in depth — the store must already have thrown).
function fakeScopedClient(chunks: FakeChunk[], owners: Map<string, string>) {
  const seen: { sessionId: unknown; documentId: unknown }[] = [];
  const client: PostgresVectorClient = {
    fetchHashes: async (): Promise<StoredChunkHash[]> => [],
    upsertRows: async () => {},
    matchChunks: async (query, topK, filters): Promise<MatchRow[]> => {
      if (!isOpaqueScopeId(filters?.sessionId)) throw new UnscopedQueryError("fake.matchChunks");
      seen.push({ sessionId: filters.sessionId, documentId: filters.documentId });
      const scored = chunks
        .filter(
          (c) =>
            owners.get(c.documentId) === filters.sessionId &&
            (filters.documentId === undefined || c.documentId === filters.documentId),
        )
        .map((c) => ({
          chunk_id: c.chunkId,
          document_id: c.documentId,
          page_number: c.page,
          quote: c.quote,
          score: cosine(c.vector, query),
        }));
      scored.sort((x, y) => y.score - x.score);
      return scored.slice(0, Math.max(0, Math.min(topK, scored.length)));
    },
    deleteByDocument: async () => {},
    deleteBySession: async () => {},
  };
  return { client, seen };
}

function seed() {
  const chunks: FakeChunk[] = [
    { chunkId: "c-a1", documentId: DOC_A, page: 1, quote: "A deductible applicable", vector: vec([1, 0, 0, 0]) },
    { chunkId: "c-a2", documentId: DOC_A, page: 2, quote: "A copay schedule", vector: vec([0.9, 0.1, 0, 0]) },
    { chunkId: "c-b1", documentId: DOC_B, page: 1, quote: "B deductible applicable", vector: vec([1, 0, 0, 0]) },
  ];
  const owners = new Map([
    [DOC_A, OWNER_A],
    [DOC_B, OWNER_B],
  ]);
  return { chunks, owners };
}

function storeFor(client: PostgresVectorClient): PostgresVectorStore {
  return new PostgresVectorStore({ client, expectedDimension: DIM });
}

describe("ownership isolation (vector leg)", () => {
  it("owner B searching the same question reaches zero chunks from owner A", async () => {
    const { chunks, owners } = seed();
    const { client } = fakeScopedClient(chunks, owners);
    const out = await storeFor(client).queryTopK(vec([1, 0, 0, 0]), 10, { sessionId: OWNER_B });
    expect(out.length).toBeGreaterThan(0);
    for (const hit of out) {
      expect(hit.chunkId.startsWith("c-a")).toBe(false);
      expect(hit.documentId).not.toBe(DOC_A);
    }
    expect(out.map((h) => h.chunkId)).toEqual(["c-b1"]);
  });

  it("owner A's own chunks stay reachable under A's scope", async () => {
    const { chunks, owners } = seed();
    const { client } = fakeScopedClient(chunks, owners);
    const out = await storeFor(client).queryTopK(vec([1, 0, 0, 0]), 10, { sessionId: OWNER_A });
    expect(out.map((h) => h.chunkId).sort()).toEqual(["c-a1", "c-a2"]);
  });

  it("owner B naming owner A's documentId still sees nothing (session predicate is conjunctive)", async () => {
    const { chunks, owners } = seed();
    const { client } = fakeScopedClient(chunks, owners);
    const out = await storeFor(client).queryTopK(vec([1, 0, 0, 0]), 10, {
      documentId: DOC_A,
      sessionId: OWNER_B,
    });
    expect(out).toEqual([]);
  });

  it("forwards the caller scope as the RPC session filter", async () => {
    const { chunks, owners } = seed();
    const { client, seen } = fakeScopedClient(chunks, owners);
    await storeFor(client).queryTopK(vec([1, 0, 0, 0]), 5, { sessionId: OWNER_B });
    expect(seen).toEqual([{ sessionId: OWNER_B, documentId: undefined }]);
  });

  it.each([
    ["missing filters", undefined],
    ["empty filters", {}],
    ["empty sessionId", { sessionId: "" }],
    ["free-text sessionId (never PII as scope)", { sessionId: "my diabetes medication question" }],
    ["wrong type", { sessionId: 42 }],
  ])("unscoped queryTopK throws (%s) before any client call", async (_label, filters) => {
    const { chunks, owners } = seed();
    const matchChunks = vi.fn(async (): Promise<MatchRow[]> => []);
    const { client } = fakeScopedClient(chunks, owners);
    const store = storeFor({ ...client, matchChunks });
    await expect(
      (store.queryTopK as (...args: unknown[]) => Promise<unknown>)(vec([1, 0, 0, 0]), 5, filters),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
    expect(matchChunks).not.toHaveBeenCalled();
  });

  it("unscoped upsertChunks throws (writes must declare an owning scope)", async () => {
    const { chunks, owners } = seed();
    const { client } = fakeScopedClient(chunks, owners);
    const store = storeFor(client);
    await expect(
      (store.upsertChunks as (...args: unknown[]) => Promise<unknown>)(
        [],
        new Map(),
        { sessionId: "" },
      ),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
  });
});

describe("ownership isolation (FTS leg)", () => {
  function fakeFts(docs: Map<string, string>) {
    const rows: FtsRow[] = [
      { chunk_id: "c-a1", document_id: DOC_A, page_number: 1, quote: "A deductible applicable", rank: 0.9 },
      { chunk_id: "c-b1", document_id: DOC_B, page_number: 1, quote: "B deductible applicable", rank: 0.9 },
    ];
    const seen: unknown[] = [];
    const client: FtsClient = {
      searchFts: async (queryText, topK, filters) => {
        if (!isOpaqueScopeId(filters?.sessionId)) throw new UnscopedQueryError("fake.searchFts");
        seen.push(filters.sessionId);
        return rows
          .filter(
            (r) =>
              docs.get(r.document_id) === filters.sessionId &&
              (filters.documentId === undefined || r.document_id === filters.documentId),
          )
          .slice(0, topK);
      },
    };
    return { client, seen, queryText: "deductible applicable" };
  }

  it("owner B reaches only B rows; owner A rows are unreachable", async () => {
    const { client } = fakeFts(new Map([[DOC_A, OWNER_A], [DOC_B, OWNER_B]]));
    const out = await retrieveFtsCandidate("deductible applicable", {
      client,
      topK: 5,
      sessionId: OWNER_B,
    });
    expect(out.map((h) => h.chunkId)).toEqual(["c-b1"]);
    expect(out.find((h) => h.documentId === DOC_A)).toBeUndefined();
  });

  it("unscoped retrieveFtsCandidate throws before any client call", async () => {
    const { client, queryText } = fakeFts(new Map());
    const searchFts = vi.fn(client.searchFts.bind(client));
    await expect(
      retrieveFtsCandidate(queryText, { client: { searchFts } } as never),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
    expect(searchFts).not.toHaveBeenCalled();
  });
});

describe("scope id hygiene", () => {
  it("accepts opaque session ids, rejects free text", () => {
    expect(isOpaqueScopeId(OWNER_A)).toBe(true);
    expect(isOpaqueScopeId("it-pgvector-abc123")).toBe(true);
    expect(isOpaqueScopeId("")).toBe(false);
    expect(isOpaqueScopeId("my diabetes medication question")).toBe(false);
    expect(isOpaqueScopeId(undefined)).toBe(false);
    expect(requireScopeId(OWNER_A, "test")).toBe(OWNER_A);
    expect(() => requireScopeId("raw health text here", "test")).toThrow(UnscopedQueryError);
  });
});
