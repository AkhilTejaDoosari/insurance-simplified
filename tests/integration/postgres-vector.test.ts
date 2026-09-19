// Todo 57 integration test: PostgresVectorStore round-trip against Supabase.
// SKIPS (never fails, never fake-passes) when SUPABASE_URL /
// SUPABASE_SERVICE_KEY are absent — persistence is opt-in, the in-memory
// index remains the default runtime.
import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/app/lib/rag/chunks";
import {
  EMBEDDING_DIMENSION,
  isPostgresConfigured,
  PostgresVectorStore,
} from "@/app/lib/rag/postgres-vector";

const configured = isPostgresConfigured();

function unitVector(seed: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  v[seed % EMBEDDING_DIMENSION] = 1;
  return v;
}

describe.skipIf(!configured)("postgres vector round-trip (live Supabase)", () => {
  it("upserts chunks, matches them back, and deletes the document", async () => {
    const scope = `it-pgvector-${Date.now().toString(36)}`;
    const documentId = `${scope}-doc`;
    const pages = [
      "ACME HEALTH PLAN A. Annual deductible: $250 in-network. F-1 visa holders eligible.",
      "Emergency care copay: $100, waived if admitted. Precertification required.",
    ];
    const chunks = chunkDocument(documentId, pages);
    expect(chunks.length).toBeGreaterThan(0);

    const store = new PostgresVectorStore();
    const embeddings = new Map(chunks.map((c, i) => [c.chunkId, unitVector(i)]));
    const first = await store.upsertChunks(chunks, embeddings, { sessionId: scope });
    expect(first.inserted).toBe(chunks.length);
    expect(first.skipped).toBe(0);

    // Second upsert with identical text: everything skips, no re-embed needed.
    const throwingLookup = () => {
      throw new Error("must not re-embed hash-identical chunks");
    };
    const second = await store.upsertChunks(chunks, throwingLookup, { sessionId: scope });
    expect(second).toEqual({ inserted: 0, skipped: chunks.length });

    const hits = await store.queryTopK(unitVector(0), 5, { documentId, sessionId: scope });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      // Provenance: chunk -> document -> page -> source quote.
      expect(hit.documentId).toBe(documentId);
      expect(hit.page).toBeGreaterThanOrEqual(1);
      expect(hit.chunkId.trim()).not.toBe("");
      expect(hit.quote.trim()).not.toBe("");
    }

    await store.deleteDocument(documentId);
    const after = await store.queryTopK(unitVector(0), 5, { documentId, sessionId: scope });
    expect(after).toEqual([]);
  });
});

describe.skipIf(configured)("postgres vector round-trip (no credentials)", () => {
  it("SKIPS honestly without SUPABASE_URL/SUPABASE_SERVICE_KEY", () => {
    expect(configured).toBe(false);
  });
});
