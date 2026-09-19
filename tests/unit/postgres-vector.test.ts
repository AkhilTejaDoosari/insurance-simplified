// Todo 57 unit tests: PostgresVectorStore pure logic with a mocked client.
// No network, no credentials — all green without SUPABASE_* set.
import { describe, expect, it, vi } from "vitest";
import { DimensionError } from "@/app/lib/rag/embeddings";
import { chunkPage } from "@/app/lib/rag/chunks";
import {
  EMBEDDING_DIMENSION,
  PostgresUnconfiguredError,
  PostgresVectorStore,
  rankByCosine,
  textHashForSkip,
  validateDimension,
  type ChunkRow,
  type MatchRow,
  type PostgresVectorClient,
  type StoredChunkHash,
} from "@/app/lib/rag/postgres-vector";

const DIM = 4; // small width keeps unit vectors readable; dim-mismatch tests use EMBEDDING_DIMENSION separately.

function mockClient(overrides: Partial<PostgresVectorClient> = {}): PostgresVectorClient & {
  calls: { upserted: number[][]; matched: number; deletedDocs: string[]; deletedSessions: string[] };
} {
  const calls = { upserted: [] as number[][], matched: 0, deletedDocs: [] as string[], deletedSessions: [] as string[] };
  return {
    calls,
    fetchHashes: vi.fn(async (_documentId: string): Promise<StoredChunkHash[]> => []),
    upsertRows: vi.fn(async (rows: ChunkRow[]) => {
      calls.upserted.push(rows.map((r) => r.embedding.length));
    }),
    matchChunks: vi.fn(async (): Promise<MatchRow[]> => {
      calls.matched++;
      return [];
    }),
    deleteByDocument: vi.fn(async (documentId: string) => {
      calls.deletedDocs.push(documentId);
    }),
    deleteBySession: vi.fn(async (sessionId: string) => {
      calls.deletedSessions.push(sessionId);
    }),
    ...overrides,
  };
}

const vec = (values: number[]): number[] => values;

describe("validateDimension", () => {
  it("accepts the expected 1024-wide qwen3-embedding vectors", () => {
    expect(() => validateDimension(new Array(EMBEDDING_DIMENSION).fill(0))).not.toThrow();
    expect(EMBEDDING_DIMENSION).toBe(1024);
  });

  it("throws DimensionError (never coerces) on width mismatch", () => {
    try {
      validateDimension([1, 2, 3]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DimensionError);
      expect((err as DimensionError).expected).toBe(1024);
      expect((err as DimensionError).received).toBe(3);
    }
  });
});

describe("rankByCosine tie-break", () => {
  it("orders score desc, chunkId asc on exact ties", () => {
    const records = [
      { chunkId: "c-zed", documentId: "doc-a", page: 1, quote: "z", vector: vec([1, 0, 0, 0]) },
      { chunkId: "c-aye", documentId: "doc-a", page: 1, quote: "a", vector: vec([1, 0, 0, 0]) },
      { chunkId: "c-mid", documentId: "doc-a", page: 2, quote: "m", vector: vec([0, 1, 0, 0]) },
    ];
    const out = rankByCosine(records, vec([1, 0, 0, 0]), 3);
    expect(out.map((p) => p.chunkId)).toEqual(["c-aye", "c-zed", "c-mid"]);
    // Provenance survives ranking.
    expect(out[0]).toMatchObject({ documentId: "doc-a", page: 1, quote: "a" });
    expect(typeof out[0].score).toBe("number");
  });

  it("returns [] on empty input (refusal gating keeps working)", () => {
    expect(rankByCosine([], vec([1, 0, 0, 0]), 5)).toEqual([]);
  });
});

describe("PostgresVectorStore sync seam", () => {
  it("validates staged vectors against 1024 and throws DimensionError", () => {
    const store = new PostgresVectorStore({ client: mockClient() });
    expect(() => store.add({
      chunkId: "c-1", documentId: "d", page: 1, quote: "q", vector: [1, 2, 3],
    })).toThrow(DimensionError);
    expect(store.size).toBe(0);
    expect(store.dimension).toBeNull();
  });

  it("search validates the query BEFORE scoring and ranks staged records", () => {
    const store = new PostgresVectorStore({
      client: mockClient(),
      expectedDimension: DIM,
    });
    store.add({ chunkId: "c-b", documentId: "d", page: 1, quote: "qb", vector: vec([0, 1, 0, 0]) });
    store.add({ chunkId: "c-a", documentId: "d", page: 1, quote: "qa", vector: vec([1, 0, 0, 0]) });
    expect(() => store.search([1, 2], 2)).toThrow(DimensionError);
    const out = store.search(vec([1, 0, 0, 0]), 2);
    expect(out.map((p) => p.chunkId)).toEqual(["c-a", "c-b"]);
  });

  it("clear() drops staged vectors and resets the dimension", () => {
    const store = new PostgresVectorStore({
      client: mockClient(),
      expectedDimension: DIM,
    });
    store.add({ chunkId: "c-a", documentId: "d", page: 1, quote: "qa", vector: vec([1, 0, 0, 0]) });
    store.clear();
    expect(store.size).toBe(0);
    expect(store.dimension).toBeNull();
    expect(store.search(vec([1, 0, 0, 0]), 5)).toEqual([]);
  });
});

describe("upsertChunks hash-skip", () => {
  const pageText = "Annual deductible: $250 in-network. Emergency care copay: $100.";

  function chunks() {
    return chunkPage("doc-a", 1, pageText);
  }

  it("persists changed chunks and skips hash-identical rows without re-embed", async () => {
    const all = chunks();
    const stored: StoredChunkHash[] = all.map((c) => ({
      chunk_id: c.chunkId,
      text_hash: textHashForSkip(c.text),
    }));
    // Pretend the first chunk changed upstream by dropping its stored hash.
    const changed = stored.slice(1);
    const client = mockClient({
      fetchHashes: vi.fn(async () => changed),
    });
    const store = new PostgresVectorStore({ client, expectedDimension: DIM });
    // Lookup throws if called for an unchanged chunk: proves no re-embed.
    const result = await store.upsertChunks(all, (chunk) => {
      if (chunk.chunkId === all[0].chunkId) return vec([1, 0, 0, 0]);
      throw new Error(`re-embedded unchanged chunk ${chunk.chunkId}`);
    });
    expect(result).toEqual({ inserted: 1, skipped: all.length - 1 });
    expect(client.calls.upserted).toHaveLength(1);
  });

  it("throws DimensionError on a wrong-width embedding instead of coercing", async () => {
    const client = mockClient();
    const store = new PostgresVectorStore({ client }); // expects 1024
    const all = chunkPage("doc-a", 1, pageText);
    await expect(
      store.upsertChunks(all, () => [1, 2, 3]),
    ).rejects.toBeInstanceOf(DimensionError);
    expect(client.calls.upserted).toHaveLength(0);
  });
});

describe("queryTopK", () => {
  it("validates dimensions before any network call", async () => {
    const client = mockClient();
    const store = new PostgresVectorStore({ client });
    await expect(store.queryTopK([1, 2, 3], 5)).rejects.toBeInstanceOf(DimensionError);
    expect(client.calls.matched).toBe(0);
  });

  it("maps rows with provenance and re-applies score-desc/chunkId-asc", async () => {
    const rows: MatchRow[] = [
      { chunk_id: "c-zed", document_id: "doc-a", page_number: 2, quote: "z", score: 0.9 },
      { chunk_id: "c-aye", document_id: "doc-a", page_number: 1, quote: "a", score: 0.9 },
      { chunk_id: "c-top", document_id: "doc-b", page_number: 1, quote: "t", score: 0.99 },
    ];
    const client = mockClient({ matchChunks: vi.fn(async () => rows) });
    const store = new PostgresVectorStore({ client });
    const out = await store.queryTopK(new Array(EMBEDDING_DIMENSION).fill(0.1), 10);
    expect(out.map((p) => p.chunkId)).toEqual(["c-top", "c-aye", "c-zed"]);
    expect(out[0]).toMatchObject({ documentId: "doc-b", page: 1, quote: "t" });
  });

  it("forwards document/session filters to the client", async () => {
    const matchChunks = vi.fn(async (): Promise<MatchRow[]> => []);
    const client = mockClient({ matchChunks });
    const store = new PostgresVectorStore({ client });
    await store.queryTopK(new Array(EMBEDDING_DIMENSION).fill(0.1), 5, {
      documentId: "doc-a",
      sessionId: "sess-1",
    });
    expect(matchChunks).toHaveBeenCalledWith(expect.any(Array), 5, {
      documentId: "doc-a",
      sessionId: "sess-1",
    });
  });
});

describe("unconfigured behavior", () => {
  it("throws PostgresUnconfiguredError (honest skip, never fake success)", async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      const store = new PostgresVectorStore(); // no injected client, no env
      await expect(store.queryTopK(new Array(EMBEDDING_DIMENSION).fill(0), 5)).rejects.toBeInstanceOf(
        PostgresUnconfiguredError,
      );
      await expect(
        store.upsertChunks(chunkPage("d", 1, "hello world"), new Map()),
      ).rejects.toBeInstanceOf(PostgresUnconfiguredError);
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_KEY = savedKey;
    }
  });
});
