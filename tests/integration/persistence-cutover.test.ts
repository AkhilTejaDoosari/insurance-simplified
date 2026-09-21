// Runtime persistence cutover proof: the ACTUAL application services end to
// end against live Supabase. SKIPS (never fails, never fake-passes) unless
// durable persistence AND embeddings are both configured.
//
// Unlike the adapter-level tests, every step below traverses the same
// services the routes call: persistSessionUpload (upload route),
// answerQuestionSemantic + verifyEvidenceCitation (chat route),
// deleteDurableVectors/deleteDurableObjects + deleteSession (delete route),
// SupabaseStorageAdapter.get (document route byte serving).
import { describe, expect, it } from "vitest";
import { answerQuestionSemantic } from "@/app/lib/rag/answer";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import {
  deleteDurableObjects,
  deleteDurableVectors,
  isDurableConfigured,
  persistSessionUpload,
  retrievePersistentSemantic,
} from "@/app/lib/rag/persist-session";
import { isEmbeddingConfigured } from "@/app/lib/rag/embeddings";
import { deleteSession } from "@/app/lib/session";
import {
  SupabaseStorageAdapter,
  objectKeyFor,
  sha256Hex,
} from "@/app/lib/storage/objects";

const configured = isDurableConfigured() && isEmbeddingConfigured();

const DOC_A_PAGES = [
  "Acme health plan annual deductible $250 in-network. Emergency copay $100 waived if admitted.",
  "Acme outpatient precertification required. F-1 visa holders eligible.",
];
const DOC_B_PAGES = [
  "Beta dental plan annual cleaning covered twice yearly. Orthodontia excluded.",
  "Beta vision allowance $150 per plan year for frames and lenses.",
];

function sessionDocs() {
  return [
    { documentId: "doc-1", filename: "acme.pdf", pageCount: DOC_A_PAGES.length, pages: DOC_A_PAGES },
    { documentId: "doc-2", filename: "beta.pdf", pageCount: DOC_B_PAGES.length, pages: DOC_B_PAGES },
  ];
}

describe.skipIf(!configured)("persistence cutover (live application services)", () => {
  it("upload persists, retrieval cites, deletion cleans, sessions stay isolated", async () => {
    const ts = Date.now().toString(36);
    const sessionId = `it-cutover-${ts}`;
    const otherId = `it-cutover-other-${ts}`;
    const docs = sessionDocs().map((d) => ({
      ...d,
      bytes: new TextEncoder().encode(`%PDF-cutover-${ts}-${d.documentId}`),
    }));

    const persisted = await persistSessionUpload(sessionId, docs);
    expect(persisted.map((p) => p.documentId).sort()).toEqual(["doc-1", "doc-2"]);
    try {
      // Durable object exists with byte-identical content (what the viewer serves).
      const store = new SupabaseStorageAdapter();
      for (const meta of persisted) {
        const original = docs.find((d) => d.documentId === meta.documentId)!.bytes;
        expect(meta.objectKey).toBe(objectKeyFor(meta.sha256));
        expect(meta.sha256).toBe(sha256Hex(original));
        expect(await store.get(meta.objectKey)).toEqual(original);
      }

      // Persistent pgvector returns scoped evidence with session documentIds.
      const hits = await retrievePersistentSemantic(
        "What is the annual deductible?",
        sessionId,
        5,
      );
      expect(hits).not.toBeNull();
      expect(hits!.length).toBeGreaterThan(0);
      expect(hits![0].documentId).toBe("doc-1");
      for (const h of hits!) {
        expect(["doc-1", "doc-2"]).toContain(h.documentId);
        expect(h.page).toBeGreaterThanOrEqual(1);
        expect(h.quote.trim()).not.toBe("");
      }

      // Chat-level answer cites the correct source/page; citation verifies
      // against the session documents exactly as the chat route checks.
      const answer = await answerQuestionSemantic(sessionDocs(), "What is the annual deductible?", {
        sessionId,
      });
      expect(answer.kind).toBe("answer");
      if (answer.kind === "answer") {
        expect(answer.citations.length).toBeGreaterThan(0);
        expect(answer.citations[0].documentId).toBe("doc-1");
        const sessionShape = sessionDocs().map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          pageCount: d.pages.length,
          pages: d.pages,
        }));
        for (const c of answer.citations) {
          expect(verifyEvidenceCitation(sessionShape, c).ok).toBe(true);
        }
      }

      // Session isolation at the service level: B's chunks never leak into A.
      const otherDocs = [
        {
          documentId: "doc-1",
          filename: "other.pdf",
          pages: ["Unrelated lighthouse maintenance schedule for harbor beacons."],
          bytes: new TextEncoder().encode(`%PDF-cutover-other-${ts}`),
        },
      ];
      await persistSessionUpload(otherId, otherDocs);
      try {
        const aHits = await retrievePersistentSemantic("deductible", sessionId, 10);
        expect(aHits!.length).toBeGreaterThan(0);
        expect(aHits!.find((h) => h.quote.includes("lighthouse"))).toBeUndefined();
      } finally {
        await deleteDurableVectors(otherId);
        await deleteDurableObjects(
          otherId,
          [objectKeyFor(sha256Hex(otherDocs[0].bytes))],
        );
      }

      // Deletion in route order removes durable state and stays retry-safe.
      await deleteDurableVectors(sessionId);
      await deleteDurableObjects(
        sessionId,
        persisted.map((p) => p.objectKey),
      );
      deleteSession(sessionId);
      const after = await retrievePersistentSemantic("deductible", sessionId, 5);
      expect(after ?? []).toEqual([]);
      for (const meta of persisted) {
        expect(await store.get(meta.objectKey)).toBeUndefined();
      }
      await deleteDurableVectors(sessionId);
      await deleteDurableObjects(
        sessionId,
        persisted.map((p) => p.objectKey),
      );
    } finally {
      try {
        await deleteDurableVectors(sessionId);
      } catch {
        // Best-effort test hygiene.
      }
      try {
        await deleteDurableObjects(
          sessionId,
          persisted.map((p) => p.objectKey),
        );
      } catch {
        // Best-effort test hygiene.
      }
      deleteSession(sessionId);
    }
  }, 180000);
});

describe.skipIf(configured)("persistence cutover (no credentials)", () => {
  it("SKIPS honestly without durable persistence + embeddings", () => {
    expect(configured).toBe(false);
  });
});
