import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { GET } from "@/app/api/export/route";
import {
  deleteComparisonResult,
  documentFingerprint,
  saveComparisonResult,
  type PersistedComparisonResultPayload,
} from "@/app/lib/comparison-result-db";
import {
  createSession,
  deleteSession,
  SESSION_CAPABILITY_COOKIE,
  type SessionDocument,
} from "@/app/lib/session";

const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");
const created: string[] = [];
const originalEnv = { ...process.env };

const documents: SessionDocument[] = [
  { documentId: "doc-1", filename: "worldtrips.pdf", pageCount: 8, pages: ["WorldTrips deductible section"] },
  { documentId: "doc-2", filename: "sevencorners.pdf", pageCount: 4, pages: ["Seven Corners deductible options"] },
];

const payload: PersistedComparisonResultPayload = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "doc-1", filename: "worldtrips.pdf", pageCount: 8 },
    { documentId: "doc-2", filename: "sevencorners.pdf", pageCount: 4 },
  ],
  presentationGroups: [{ title: "Deductible choices", factNames: ["annual-deductible"] }],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$0",
          qualifiers: { planTier: "Student Secure Basic" },
          evidence: [{ documentId: "doc-1", page: 3, quote: "Basic deductible $0" }],
        },
        {
          documentId: "doc-1",
          display: "$100",
          qualifiers: { planTier: "Student Secure Elite" },
          evidence: [{ documentId: "doc-1", page: 3, quote: "Elite deductible $100" }],
        },
        {
          documentId: "doc-2",
          display: "$50",
          qualifiers: { planTier: "Lone Star" },
          evidence: [{ documentId: "doc-2", page: 2, quote: "Lone Star deductible $50" }],
        },
      ],
    },
    ...Array.from({ length: 20 }, (_, i) => ({
      factName: `benefit-${i}`,
      verdict: "SUPPORTED" as const,
      values: [
        {
          documentId: "doc-1",
          display: `Benefit ${i}: ` + "coverage details with qualifications ".repeat(16),
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 5, quote: `Benefit ${i} coverage` }],
        },
      ],
    })),
  ],
  contacts: [],
  userContext: { age: "24", visaOrStatus: "F-1" },
};

function ownSession() {
  const { session, capability } = createSession(documents, payload.userContext);
  created.push(session.sessionId);
  return { session, capability };
}

function request(sessionId: string, capability?: string) {
  return new NextRequest(`http://localhost/api/export?sessionId=${sessionId}`, {
    headers: capability ? { cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` } : {},
  });
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const proxy = await getDocumentProxy(bytes);
  const result = await extractText(proxy, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [result.text];
  return { text: pages.join(" "), pageCount: pages.length };
}

async function saveFor(sessionId: string, docs = documents) {
  await saveComparisonResult({
    sessionId,
    documentFingerprint: documentFingerprint(docs),
    payload,
  });
}

describe("GET /api/export PDF contract", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SECRET_KEY = "";
    process.env.SUPABASE_SERVICE_KEY = "";
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      await deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  it("fails closed when no result was persisted", async () => {
    const own = ownSession();
    const response = await GET(request(own.session.sessionId, own.capability));
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).not.toContain("pdf");
  });

  it("refuses export when the document fingerprint no longer matches", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId, [
      { documentId: "doc-1", filename: "old.pdf", pageCount: 1, pages: ["old text"] },
    ]);
    const response = await GET(request(own.session.sessionId, own.capability));
    expect(response.status).toBe(409);
  });

  it("serves a PDF with tiers, citations, pagination, and no credentials", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await GET(request(own.session.sessionId, own.capability));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(".pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const { text, pageCount } = await pdfText(bytes);

    expect(text).toContain("Deductible choices");
    expect(text).toContain("Student Secure Basic");
    expect(text).toContain("Student Secure Elite");
    expect(text).toContain("Lone Star");
    expect(text).toContain("worldtrips.pdf");
    expect(text).toContain("sevencorners.pdf");
    expect(text).toContain("page 3");
    expect(text).toContain("page 2");
    expect(text).toContain("F-1");
    expect(text).toContain(" / ");
    expect(pageCount).toBeGreaterThan(1);

    expect(text).not.toContain("sess-");
    expect(text).not.toContain(own.capability);
    expect(text).not.toContain("ev-");
  });

  it("still rejects missing and wrong capabilities before any result read", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    expect((await GET(request(own.session.sessionId))).status).toBe(401);
    expect((await GET(request(own.session.sessionId, "wrong"))).status).toBe(401);
  });
});
