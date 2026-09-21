// P3-D idempotency tests: same bytes twice → single chunk set, single
// active embedding set, stable provenance. Verifies the existing
// PostgresVectorStore.upsertChunks hash-skip (no new code there) plus the new
// content-key helpers.
import { describe, expect, it, vi } from "vitest";
import { chunkDocument } from "@/app/lib/rag/chunks";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import {
  PostgresVectorStore,
  textHashForSkip,
  type ChunkRow,
  type PostgresVectorClient,
  type StoredChunkHash,
} from "@/app/lib/rag/postgres-vector";
import {
  dedupeByChunkId,
  documentKeyForBytes,
  stableDocumentIdForKey,
} from "@/app/lib/ingestion/idempotency";

const PAGE =
  "Annual deductible: $250 in-network. Emergency care copay: $100. " +
  "Out-of-pocket maximum: $3,000 per covered person per plan year. " +
  "Prescription coverage included with prior authorization requirements.";

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function mockClient(overrides: Partial<PostgresVectorClient> = {}): PostgresVectorClient {
  return {
    fetchHashes: vi.fn(async (): Promise<StoredChunkHash[]> => []),
    upsertRows: vi.fn(async (_rows: ChunkRow[]): Promise<void> => {}),
    matchChunks: vi.fn(async () => []),
    deleteByDocument: vi.fn(async (): Promise<void> => {}),
    deleteBySession: vi.fn(async (): Promise<void> => {}),
    ...overrides,
  };
}

describe("content keys", () => {
  it("maps identical bytes to the same key/id, different bytes elsewhere", () => {
    const a = bytesOf("same-pdf-bytes");
    const b = bytesOf("same-pdf-bytes");
    const c = bytesOf("other-pdf-bytes");
    expect(documentKeyForBytes(a)).toBe(documentKeyForBytes(b));
    expect(documentKeyForBytes(a)).not.toBe(documentKeyForBytes(c));
    expect(stableDocumentIdForKey(documentKeyForBytes(a))).toBe(
      stableDocumentIdForKey(documentKeyForBytes(b)),
    );
    expect(stableDocumentIdForKey(documentKeyForBytes(a))).not.toBe(
      stableDocumentIdForKey(documentKeyForBytes(c)),
    );
  });

  it("rejects non-sha256 keys instead of minting unstable ids", () => {
    expect(() => stableDocumentIdForKey("nope")).toThrow();
  });
});

describe("reprocessing identical bytes", () => {
  it("yields an identical single chunk set with stable provenance", () => {
    const key = documentKeyForBytes(bytesOf("fixture-bytes"));
    const documentId = stableDocumentIdForKey(key);
    const pages = [PAGE, `${PAGE} Second page tail.`];
    const first = chunkDocument(documentId, pages);
    const second = chunkDocument(documentId, pages);
    expect(first.length).toBeGreaterThan(0);
    expect(second.map((c) => c.chunkId)).toEqual(first.map((c) => c.chunkId));

    // A retry that concatenates both passes collapses to one copy.
    const retried = dedupeByChunkId([...first, ...second]);
    expect(retried.chunks.map((c) => c.chunkId)).toEqual(first.map((c) => c.chunkId));
    expect(retried.duplicateCount).toBe(first.length);

    // Provenance resolves identically across passes.
    for (const chunk of first) {
      expect(evidenceIdFor(chunk.documentId, chunk.page, chunk.text)).toBe(
        evidenceIdFor(second[0].documentId, chunk.page, chunk.text),
      );
    }
  });
});

describe("upsertChunks second identical pass inserts nothing", () => {
  it("process same bytes twice → single active embedding set (no re-embed)", async () => {
    const documentId = stableDocumentIdForKey(documentKeyForBytes(bytesOf("embed-fixture")));
    const chunks = chunkDocument(documentId, [PAGE]);
    expect(chunks.length).toBeGreaterThan(0);

    // First pass persists everything.
    const firstStored: StoredChunkHash[] = [];
    const client = mockClient({
      fetchHashes: vi.fn(async () => [...firstStored]),
      upsertRows: vi.fn(async (rows: ChunkRow[]) => {
        for (const r of rows) firstStored.push({ chunk_id: r.chunk_id, text_hash: r.text_hash });
      }),
    });
    const store = new PostgresVectorStore({ client, expectedDimension: 4 });
    const first = await store.upsertChunks(
      chunks,
      () => [1, 0, 0, 0],
      { sessionId: "sess-idem", documentId },
    );
    expect(first.inserted).toBe(chunks.length);
    expect(first.skipped).toBe(0);

    // Second identical pass: all hashes match → 0 inserts, lookup must never run.
    const second = await store.upsertChunks(
      chunkDocument(documentId, [PAGE]),
      () => {
        throw new Error("re-embedded an unchanged chunk");
      },
      { sessionId: "sess-idem", documentId },
    );
    expect(second).toEqual({ inserted: 0, skipped: chunks.length });
    expect(firstStored).toHaveLength(chunks.length);
    // Stored hashes use the same normalization as chunk IDs.
    for (const chunk of chunks) {
      expect(firstStored.find((s) => s.chunk_id === chunk.chunkId)?.text_hash).toBe(
        textHashForSkip(chunk.text),
      );
    }
  });
});
