import { describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  getSession,
  readDocumentFile,
  saveDocumentFile,
  sessionCount,
} from "@/app/lib/session";

describe("memory-only sessions with delete-on-close (FR-019)", () => {
  it("creates retrievable sessions and deletes them without residual state", () => {
    const before = sessionCount();
    const session = createSession(
      [
        {
          documentId: "doc-1",
          filename: "plan-a.pdf",
          pageCount: 2,
          pages: ["page one", "page two"],
        },
      ],
      { age: "34" }
    );

    expect(getSession(session.sessionId)?.documents).toHaveLength(1);
    expect(sessionCount()).toBe(before + 1);

    expect(deleteSession(session.sessionId)).toBe(true);
    expect(getSession(session.sessionId)).toBeUndefined();
    expect(sessionCount()).toBe(before);
  });

  it("returns false when deleting an unknown session", () => {
    expect(deleteSession("sess-does-not-exist")).toBe(false);
  });

  // Same file as the count assertions above: sessions share one tmp dir, so
  // creating them from a parallel test file would race sessionCount().
  it("stores raw document bytes for page links and removes them with the session", () => {
    const session = createSession([
      { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1, pages: ["p1"] },
    ]);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    saveDocumentFile(session.sessionId, "doc-1", bytes);
    expect(readDocumentFile(session.sessionId, "doc-1")).toEqual(Buffer.from(bytes));
    expect(deleteSession(session.sessionId)).toBe(true);
    expect(readDocumentFile(session.sessionId, "doc-1")).toBeUndefined();
  });

  it("refuses unsafe ids when reading document files", () => {
    expect(readDocumentFile("../etc", "doc-1")).toBeUndefined();
    expect(readDocumentFile("sess-x", "../passwd")).toBeUndefined();
  });
});
