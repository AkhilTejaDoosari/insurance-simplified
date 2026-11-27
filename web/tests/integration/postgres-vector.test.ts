// Todo 57 integration test: PostgresVectorStore round-trip against Supabase.
// SKIPS (never fails, never fake-passes) when SUPABASE_URL /
// SUPABASE_SECRET_KEY are absent — persistence is opt-in, the in-memory
// index remains the default runtime.
import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/app/lib/rag/chunks";
import {
  EMBEDDING_DIMENSION,
  isPostgresConfigured,
  PostgresVectorStore,
} from "@/app/lib/rag/postgres-vector";

const configured = isPostgresConfigured();

function restConfig(): { url: string; serviceKey: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error("integration test requires Supabase credentials");
  return { url, serviceKey };
}

function restHeaders(): Record<string, string> {
  const { serviceKey } = restConfig();
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
}

// Production flow creates the documents row (owner_session scope) before any
// chunk upsert — chunks.document_id is a foreign key, so the parent row must
// exist first. Same service-key REST surface the adapter uses.
async function insertDocumentRow(documentId: string, sessionId: string): Promise<void> {
  const { url } = restConfig();
  const res = await fetch(`${url}/rest/v1/documents`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify({
      id: documentId,
      owner_session: sessionId,
      filename: `${documentId}.pdf`,
      sha256: "0".repeat(64),
      status: "active",
    }),
  });
  if (!res.ok) throw new Error(`test setup: POST /rest/v1/documents failed with status ${res.status}`);
}

async function deleteDocumentRow(documentId: string): Promise<void> {
  const { url } = restConfig();
  await fetch(`${url}/rest/v1/documents?id=eq.${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers: restHeaders(),
  });
}

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

    await insertDocumentRow(documentId, scope);
    try {
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
    } finally {
      // ON DELETE CASCADE removes pages/chunks; the test leaves no rows behind.
      await deleteDocumentRow(documentId);
    }
  });
});

describe.skipIf(!configured)("match_chunks session scope (M5, migration 0007)", () => {
  it("rejects a NULL or blank filter_session instead of searching every owner", async () => {
    const { url } = restConfig();
    for (const filter_session of [null, "  "]) {
      const res = await fetch(`${url}/rest/v1/rpc/match_chunks`, {
        method: "POST",
        headers: restHeaders(),
        body: JSON.stringify({
          query_embedding: unitVector(0),
          match_count: 5,
          filter_document_id: null,
          filter_session,
        }),
      });
      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    }
  });

  it("ranks a session's chunks across all of its documents, never another session's", async () => {
    const run = `it-m5-scope-${Date.now().toString(36)}`;
    const mine = `${run}-mine`;
    const other = `${run}-other`;
    const docs = [`${mine}-d1`, `${mine}-d2`, `${other}-d1`];
    await insertDocumentRow(docs[0], mine);
    await insertDocumentRow(docs[1], mine);
    await insertDocumentRow(docs[2], other);
    try {
      const store = new PostgresVectorStore();
      const one = chunkDocument(docs[0], ["First plan page with a deductible line."]);
      const two = chunkDocument(docs[1], ["Second plan page with a copay line."]);
      const foreign = chunkDocument(docs[2], ["Other session page."]);
      // The foreign chunk is the exact query direction: it must still never appear.
      await store.upsertChunks(one, new Map(one.map((c) => [c.chunkId, unitVector(1)])), { sessionId: mine });
      await store.upsertChunks(two, new Map(two.map((c) => [c.chunkId, unitVector(2)])), { sessionId: mine });
      await store.upsertChunks(foreign, new Map(foreign.map((c) => [c.chunkId, unitVector(0)])), {
        sessionId: other,
      });
      const hits = await store.queryTopK(unitVector(0), 40, { sessionId: mine });
      expect(hits.map((h) => h.documentId).sort()).toEqual([docs[0], docs[1]]);
    } finally {
      for (const doc of docs) await deleteDocumentRow(doc);
    }
  });
});

describe.skipIf(configured)("postgres vector round-trip (no credentials)", () => {
  it("SKIPS honestly without SUPABASE_URL/SUPABASE_SECRET_KEY", () => {
    expect(configured).toBe(false);
  });
});
