// Focused regression test for the DURABLE upload authentication path.
//
// Real path under test: POST /api/upload with durable persistence configured.
//   1. createSessionDb() mints { sessionId, capability } and stores
//      capability_hash = hashCapability(capability) durably.
//   2. The route creates the server-local ("temporary") session that every
//      protected route reads (extract / chat / document viewer).
//   3. The route sets the browser `sid_cap` cookie to the durable capability.
//
// INVARIANT: the temporary session MUST be keyed by the durable `sessionId`
// and MUST store hashCapability(capability-of-the-cookie). If step 2 mints a
// fresh sessionId/capability instead of reusing the durable values, the
// temporary session's capability hash no longer matches the browser cookie,
// and session-backed reads fail.
//
// Values below are inert test fixtures, never real credentials. Hash
// comparisons use boolean equality only — no capability/hash is ever printed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const DURABLE_SESSION_ID = "sess-durable-cap-regression-1";
const DURABLE_CAPABILITY = "durable-capability-fixture-not-a-credential";

// Durable store: configured and healthy. Returns the known durable identity
// the route is required to reuse for the temporary session.
vi.mock("@/app/lib/session-db", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/session-db")>(
    "@/app/lib/session-db",
  );
  return {
    ...actual,
    createSessionDb: vi.fn(async () => ({
      sessionId: DURABLE_SESSION_ID,
      capability: DURABLE_CAPABILITY,
      status: "DRAFT" as const,
    })),
    deleteSessionDb: vi.fn(async () => true),
  };
});

// Everything below the auth seam is stubbed: this test is about session
// identity + capability persistence, not PDF parsing or object storage.
vi.mock("@/app/lib/pdf/extract-pages", () => ({
  extractPages: vi.fn(async () => ({
    pageCount: 1,
    pages: ["Annual deductible $250 in-network."],
  })),
}));
vi.mock("@/app/lib/ingestion/quality-gate", () => ({
  checkExtraction: vi.fn(() => ({ ok: true })),
  classifyExtractorError: vi.fn(() => ({ reason: "unreadable" })),
  userVisibleMessage: vi.fn(() => "unreadable"),
}));
vi.mock("@/app/lib/storage/objects", () => ({
  getDefaultObjectStore: vi.fn(() => ({})),
  putDocumentBytes: vi.fn(async () => ({
    sha256: "0".repeat(64),
    objectKey: `obj-${"0".repeat(64)}`,
  })),
  deleteDocumentObjects: vi.fn(async () => {}),
  isSupabaseStorageConfigured: vi.fn(() => false),
}));
vi.mock("@/app/lib/rag/persist-session", () => ({
  isDurableConfigured: vi.fn(() => false),
  persistSessionUpload: vi.fn(async () => []),
  deleteDurableObjects: vi.fn(async () => {}),
  deleteDurableVectors: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/upload/route";
import {
  deleteSession,
  getSession,
  hashCapability,
  SESSION_CAPABILITY_COOKIE,
  verifySessionCapabilityTmpdir,
} from "@/app/lib/session";

function uploadRequest(count = 2): NextRequest {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append(
      "documents",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], `plan-${i}.pdf`, {
        type: "application/pdf",
      }),
    );
  }
  form.append("age", "34");
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/upload durable path — temporary session capability", () => {
  afterEach(() => {
    deleteSession(DURABLE_SESSION_ID);
  });

  it("keys the temporary session by the durable sessionId and stores the cookie capability's hash", async () => {
    const res = await POST(uploadRequest());
    expect(res.status).toBe(201);

    const body = (await res.json()) as { sessionId: string };
    // The temporary session MUST live under the durable sessionId.
    expect(body.sessionId).toBe(DURABLE_SESSION_ID);

    const cookie = res.cookies.get(SESSION_CAPABILITY_COOKIE)?.value ?? "";
    expect(cookie.length).toBeGreaterThan(0);

    const stored = getSession(DURABLE_SESSION_ID);
    expect(stored !== undefined).toBe(true);

    // Boolean equality assertions only — no values emitted.
    // (a) hash stored in the temporary session == hash of the durable capability
    expect(stored?.capabilityHash === hashCapability(DURABLE_CAPABILITY)).toBe(true);
    // (b) hash stored in the temporary session == hash derived from the cookie
    expect(stored?.capabilityHash === hashCapability(cookie)).toBe(true);
    // (c) end-to-end: the tmpdir verifier accepts the cookie the browser holds
    expect(verifySessionCapabilityTmpdir(DURABLE_SESSION_ID, cookie)).toBe(true);
  });

  it("accepts one document and returns its page count when it is the only PDF", async () => {
    const res = await POST(uploadRequest(1));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      documents: { documentId: string; filename: string; pageCount: number }[];
    };
    expect(body.documents).toEqual([{ documentId: "doc-1", filename: "plan-0.pdf", pageCount: 1 }]);
  });

  it("accepts four documents at the upper count boundary", async () => {
    const res = await POST(uploadRequest(4));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { documents: { documentId: string }[] };
    expect(body.documents).toHaveLength(4);
  });

  it("rejects zero and five documents before creating a session", async () => {
    for (const count of [0, 5]) {
      const res = await POST(uploadRequest(count));
      expect(res.status).toBe(400);
    }
  });
});
