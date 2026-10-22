import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/export/route";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import {
  deleteComparisonResult,
  documentFingerprint,
  saveComparisonResult,
} from "@/app/lib/comparison-result-db";

const created: string[] = [];
const originalEnv = { ...process.env };
const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");

function session() {
  const result = createSession(
    [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["deductible $0"] }],
    {},
  );
  created.push(result.session.sessionId);
  return result;
}

async function persistFor(result: ReturnType<typeof session>) {
  await saveComparisonResult({
    sessionId: result.session.sessionId,
    documentFingerprint: documentFingerprint(result.session.documents),
    payload: {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: result.session.documents.map(({ documentId, filename, pageCount }) => ({
        documentId, filename, pageCount,
      })),
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [{
          documentId: "doc-1",
          display: "$0",
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 1, quote: "deductible $0" }],
        }],
      }],
      presentationGroups: [],
      contacts: [],
      userContext: {},
    },
  });
}

function request(sessionId: string, capability?: string, extraHeaders?: HeadersInit) {
  return new NextRequest(`http://localhost/api/export?sessionId=${sessionId}`, {
    headers: {
      ...(capability ? { cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` } : {}),
      ...extraHeaders,
    },
  });
}

describe("GET /api/export session authorization", () => {
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      void deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  it("rejects a session ID alone before reading comparison data", async () => {
    process.env.SUPABASE_URL = "";
    const own = session();
    const response = await GET(request(own.session.sessionId));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("rejects a wrong or cross-session capability", async () => {
    process.env.SUPABASE_URL = "";
    const own = session();
    const other = session();
    expect((await GET(request(own.session.sessionId, "incorrect"))).status).toBe(401);
    expect((await GET(request(own.session.sessionId, other.capability))).status).toBe(401);
  });

  it("rejects conflicting capability transports", async () => {
    process.env.SUPABASE_URL = "";
    const own = session();
    const response = await GET(request(own.session.sessionId, own.capability, {
      authorization: "Bearer conflicting",
    }));
    expect(response.status).toBe(401);
  });

  it("rejects an expired session capability", async () => {
    process.env.SUPABASE_URL = "";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const own = session();
    vi.useRealTimers();
    const response = await GET(request(own.session.sessionId, own.capability));
    expect(response.status).toBe(401);
  });

  it("allows the authorized session without exposing its capability", async () => {
    process.env.SUPABASE_URL = "";
    const own = session();
    await persistFor(own);
    const response = await GET(request(own.session.sessionId, own.capability));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect((await response.text()).includes(own.capability)).toBe(false);
  });
});
