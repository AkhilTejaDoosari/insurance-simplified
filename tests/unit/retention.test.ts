import { describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  deleteSessionDocument,
  getSession,
  readDocumentFile,
  registerEvidence,
  saveDocumentFile,
} from "@/app/lib/session";
import { chunkDocument } from "@/app/lib/rag/chunks";
import { InMemoryCosineIndex } from "@/app/lib/rag/cosine-index";

describe("P3-FG per-document delete seam", () => {
  it("makes the deleted document unreachable while survivors stay intact", () => {
    const { session } = createSession([
      { documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["alpha page one"] },
      { documentId: "doc-2", filename: "b.pdf", pageCount: 1, pages: ["beta page one"] },
    ]);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    saveDocumentFile(session.sessionId, "doc-1", bytes);
    saveDocumentFile(session.sessionId, "doc-2", bytes);
    registerEvidence(session.sessionId, [
      { documentId: "doc-1", page: 1, quote: "alpha page one" },
      { documentId: "doc-2", page: 1, quote: "beta page one" },
    ]);

    expect(deleteSessionDocument(session.sessionId, "doc-1")).toBe(true);

    // Post-delete unreachable: metadata, bytes, evidence for doc-1.
    expect(getSession(session.sessionId)?.documents.map((d) => d.documentId)).toEqual([
      "doc-2",
    ]);
    expect(readDocumentFile(session.sessionId, "doc-1")).toBeUndefined();
    expect(
      Object.values(getSession(session.sessionId)?.evidence ?? {}).some(
        (e) => e.documentId === "doc-1",
      ),
    ).toBe(false);

    // Survivors intact.
    expect(readDocumentFile(session.sessionId, "doc-2")).toEqual(Buffer.from(bytes));
    expect(getSession(session.sessionId)?.documents).toHaveLength(1);

    // Unknown doc / session / unsafe ids refuse.
    expect(deleteSessionDocument(session.sessionId, "doc-1")).toBe(false);
    expect(deleteSessionDocument("sess-does-not-exist", "doc-2")).toBe(false);
    expect(deleteSessionDocument("../etc", "doc-2")).toBe(false);
    expect(deleteSessionDocument(session.sessionId, "../passwd")).toBe(false);

    expect(deleteSession(session.sessionId)).toBe(true);
    expect(getSession(session.sessionId)).toBeUndefined();
    expect(readDocumentFile(session.sessionId, "doc-2")).toBeUndefined();
  });
});

describe("P3-FG scratch rebuild from canonical fixtures", () => {
  it("wipe + rebuild yields identical chunkIds and retrieval parity", () => {
    // Canonical: original page text (as stored in session documents).
    const pages = [
      "deductible five hundred dollars per year for in network care",
      "out of pocket maximum three thousand dollars with precertification required",
    ];
    const first = chunkDocument("doc-1", pages);
    expect(first.length).toBeGreaterThan(0);
    const firstIds = first.map((c) => c.chunkId);

    // Derived: vectors staged in the in-memory index (deterministic stand-ins).
    const vectorFor = (chunkId: string): number[] => {
      let h = 0;
      for (const ch of chunkId) h = (h * 31 + ch.charCodeAt(0)) % 997;
      return [h / 997, 1 - h / 997, 0.5];
    };
    const index = new InMemoryCosineIndex();
    for (const c of first) {
      index.add({ chunkId: c.chunkId, documentId: c.documentId, page: c.page, quote: c.text, vector: vectorFor(c.chunkId) });
    }
    const query = [0.2, 0.8, 0.5];
    const before = index.search(query, 5).map((r) => r.chunkId);

    // Scratch wipe: drop ALL derived state (index + nothing else persists it).
    index.clear();
    expect(index.size).toBe(0);
    expect(index.search(query, 5)).toEqual([]);

    // Rebuild purely from canonical pages (re-chunk + re-embed via same fns).
    const rebuilt = chunkDocument("doc-1", pages);
    expect(rebuilt.map((c) => c.chunkId)).toEqual(firstIds);
    for (const c of rebuilt) {
      index.add({ chunkId: c.chunkId, documentId: c.documentId, page: c.page, quote: c.text, vector: vectorFor(c.chunkId) });
    }
    const after = index.search(query, 5).map((r) => r.chunkId);
    expect(after).toEqual(before);
  });
});
