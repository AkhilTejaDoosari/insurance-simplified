import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  createSession,
  deleteSession,
  saveDocumentFile,
  type Session,
} from "@/app/lib/session";
import { resolveCitationPage } from "@/app/lib/citation";
import { GET } from "@/app/api/document/[sessionId]/[documentId]/[filename]/route";

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
});

function fixtureBytes(): Uint8Array {
  const buf = readFileSync("tests/fixtures/plan-a.pdf");
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Real session with persisted PDF bytes, as POST /api/upload leaves it. */
function seedSession(filename = "plan-a.pdf"): Session {
  const session = createSession(
    [
      {
        documentId: "doc-1",
        filename,
        pageCount: 2,
        pages: ["Annual deductible: $250 in-network.", "Network: Acme Preferred."],
      },
    ],
    {}
  );
  created.push(session.sessionId);
  saveDocumentFile(session.sessionId, "doc-1", fixtureBytes());
  return session;
}

function get(sessionId: string, documentId: string) {
  return GET(new NextRequest("http://localhost/api/document/x/y/z"), {
    params: Promise.resolve({ sessionId, documentId }),
  });
}

describe("GET /api/document (uploaded PDF bytes)", () => {
  it("returns the correct PDF with content-type application/pdf", async () => {
    const session = seedSession();
    const res = await get(session.sessionId, "doc-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixtureBytes());
  });

  it("serves documents whose filenames need URL encoding", async () => {
    const session = seedSession("Patriot Travel #2 (2026).pdf");
    const res = await get(session.sessionId, "doc-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline;");
  });

  it("fails explicitly for an unknown session", async () => {
    const res = await get("sess-does-not-exist", "doc-1");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/session/i);
  });

  it("fails explicitly for an unknown document in a known session", async () => {
    const session = seedSession();
    const res = await get(session.sessionId, "doc-9");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/document/i);
  });

  it("fails explicitly when the session exists but the bytes are gone", async () => {
    const session = createSession(
      [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1, pages: ["x"] }],
      {}
    );
    created.push(session.sessionId);
    const res = await get(session.sessionId, "doc-1");
    expect(res.status).toBe(404);
  });
});

describe("resolveCitationPage (viewer page resolution)", () => {
  const session: Session = {
    sessionId: "sess-1",
    createdAt: "",
    documents: [
      { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2, pages: ["page one", "page two"] },
    ],
    userContext: {},
  };

  it("resolves the requested page with its text", () => {
    expect(resolveCitationPage(session, "doc-1", "2")).toEqual({
      ok: true,
      filename: "plan-a.pdf",
      page: 2,
      pageCount: 2,
      text: "page two",
    });
  });

  it("defaults a missing or unparseable page to 1", () => {
    expect(resolveCitationPage(session, "doc-1", undefined)).toMatchObject({ page: 1 });
    expect(resolveCitationPage(session, "doc-1", "nonsense")).toMatchObject({ page: 1 });
  });

  it("clamps out-of-range pages to the nearest valid page", () => {
    expect(resolveCitationPage(session, "doc-1", "99")).toMatchObject({ page: 2 });
    expect(resolveCitationPage(session, "doc-1", "0")).toMatchObject({ page: 1 });
  });

  it("reports unknown sessions and unknown documents distinctly", () => {
    expect(resolveCitationPage(undefined, "doc-1", "1")).toEqual({
      ok: false,
      error: "unknown-session",
    });
    expect(resolveCitationPage(session, "doc-9", "1")).toEqual({
      ok: false,
      error: "unknown-document",
    });
  });
});
