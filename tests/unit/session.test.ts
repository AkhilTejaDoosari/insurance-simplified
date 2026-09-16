import { describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  getSession,
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
});
