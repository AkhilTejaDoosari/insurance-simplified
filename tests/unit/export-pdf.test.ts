import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { POST } from "@/app/api/export/route";
import type { ComparisonTable } from "@/app/lib/extraction/types";
import {
  deleteComparisonResult,
  documentFingerprint,
  resultFingerprintFor,
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
// Genuine stored results (AT-PERSIST read-back re-derives them on export):
// every stored quote is on its page, and the fingerprint is the one
// /api/extract issues for the stored content.
const benefitLine = (i: number) => (`Benefit ${i}: ` + "coverage details with qualifications ".repeat(16)).trim();
const documents: SessionDocument[] = [
  {
    documentId: "doc-1", filename: "acmetravel.pdf", pageCount: 8,
    pages: [
      "AcmeTravel deductible section\nAlpha", "", "Basic deductible $0\nElite deductible $100", "",
      Array.from({ length: 20 }, (_, i) => benefitLine(i)).join("\n"),
      // Labelled plan/fact/value lines: page evidence that proves plan Alpha.
      "Plan name: Alpha; annual-deductible: $0\nPlan name: Alpha; annual-deductible: $100", "", "",
    ],
  },
  {
    documentId: "doc-2", filename: "northpoint.pdf", pageCount: 4,
    pages: ["North Point deductible options\nBeta", "Lone Star deductible $50", "Plan name: Beta; annual-deductible: $50", ""],
  },
];
const PLAN_PROOF: Record<string, { page: number; quote: string }> = {
  "doc-1:$0": { page: 6, quote: "Plan name: Alpha; annual-deductible: $0" },
  "doc-1:$100": { page: 6, quote: "Plan name: Alpha; annual-deductible: $100" },
  "doc-2:$50": { page: 3, quote: "Plan name: Beta; annual-deductible: $50" },
};

const payload: PersistedComparisonResultPayload = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "doc-1", filename: "acmetravel.pdf", pageCount: 8 },
    { documentId: "doc-2", filename: "northpoint.pdf", pageCount: 4 },
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
          qualifiers: { planTier: "Scholar Shield Basic" },
          evidence: [{ documentId: "doc-1", page: 3, quote: "Basic deductible $0" }],
        },
        {
          documentId: "doc-1",
          display: "$100",
          qualifiers: { planTier: "Scholar Shield Elite" },
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
          evidence: [{ documentId: "doc-1", page: 5, quote: benefitLine(i) }],
        },
      ],
    })),
  ],
  contacts: [],
  userContext: { age: "24", visaOrStatus: "F-1" },
};

/** Fingerprint issued for the most recently saved result; selections carry it. */
let RESULT_FINGERPRINT = "";
function issued(p: PersistedComparisonResultPayload, docs = documents): PersistedComparisonResultPayload {
  RESULT_FINGERPRINT = resultFingerprintFor({ documentFingerprint: documentFingerprint(docs), table: p, context: p.userContext });
  return { ...p, resultFingerprint: RESULT_FINGERPRINT };
}

function ownSession() {
  const { session, capability } = createSession(documents, payload.userContext);
  created.push(session.sessionId);
  return { session, capability };
}

function request(sessionId: string, capability: string, selection: unknown) {
  return new NextRequest("http://localhost/api/export", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}`,
    },
    body: JSON.stringify({ sessionId, selection }),
  });
}

function selectionWith(overrides: Record<string, unknown> = {}) {
  return {
    resultFingerprint: RESULT_FINGERPRINT,
    planIds: ["doc-1", "doc-2"],
    tiers: {},
    legacyTiersByDocument: {},
    ...overrides,
  };
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
    payload: issued(payload, docs),
  });
}

describe("POST /api/export PDF contract", () => {
  it("preserves active comparison plan, source and value order in the immutable PDF snapshot", async () => {
    const own = ownSession();
    const data: PersistedComparisonResultPayload = { ...payload, plans: [
      { planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Alpha" }] },
      { planId: "beta", name: "Beta", sources: [{ documentId: "doc-2", page: 1, quote: "Beta" }] },
    ], rows: (payload.rows as ComparisonTable["rows"]).map((r) => ({ ...r, values: r.values.map((v) => {
      const proof = PLAN_PROOF[`${v.documentId}:${v.display}`];
      return proof ? { ...v, planId: v.documentId === "doc-1" ? "alpha" : "beta", evidence: [{ documentId: v.documentId, ...proof }] } : v;
    }) })) };
    await saveComparisonResult({ sessionId: own.session.sessionId, documentFingerprint: documentFingerprint(documents), payload: issued(data) });
    const response = await POST(request(own.session.sessionId, own.capability, selectionWith({ viewMode: "compare", planIds: ["beta", "alpha"], tiers: { alpha: "Scholar Shield Basic" } })));
    expect(response.status).toBe(200);
    const { text } = await pdfText(new Uint8Array(await response.arrayBuffer()));
    expect(text.indexOf("northpoint.pdf")).toBeLessThan(text.indexOf("acmetravel.pdf"));
    expect(text.indexOf("$50")).toBeLessThan(text.indexOf("$0"));
    expect(text).not.toContain("$100");
    expect(text).not.toContain("Scholar Shield Elite");
  });
  it("exports only the active individual document with no synthetic plan assignment", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(request(own.session.sessionId, own.capability, selectionWith({
      viewMode: "understand", documentId: "doc-2", planIds: [],
    })));
    expect(response.status).toBe(200);
    const { text } = await pdfText(new Uint8Array(await response.arrayBuffer()));
    expect(text).toContain("northpoint.pdf");
    expect(text).toContain("$50");
    expect(text).toContain("Unverified applicability");
    expect(text).not.toContain("acmetravel.pdf");
    expect(text).not.toContain("$100");
    expect(text).not.toContain(own.capability);
  });
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
    const response = await POST(request(own.session.sessionId, own.capability, selectionWith()));
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).not.toContain("pdf");
  });

  it("refuses export when the document fingerprint no longer matches", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId, [
      { documentId: "doc-1", filename: "old.pdf", pageCount: 1, pages: ["old text"] },
    ]);
    const response = await POST(request(own.session.sessionId, own.capability, selectionWith()));
    expect(response.status).toBe(409);
  });

  it("refuses a selection built for an earlier result fingerprint with 409", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(
      request(own.session.sessionId, own.capability, selectionWith({ resultFingerprint: "fp-old" })),
    );
    expect(response.status).toBe(409);
  });

  it("refuses a selection naming a document outside the verified result with 400", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(
      request(own.session.sessionId, own.capability, selectionWith({ planIds: ["doc-9"] })),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a named document tier the validated rows never state with 400", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(
      request(own.session.sessionId, own.capability, selectionWith({ legacyTiersByDocument: { "doc-1": "Gold Tier" } })),
    );
    expect(response.status).toBe(400);
  });

  it("serves a scoped PDF with tiers, citations, pagination, and no credentials", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(request(own.session.sessionId, own.capability, selectionWith()));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(".pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const { text, pageCount } = await pdfText(bytes);

    // Both selected document views render with their tier labels intact.
    expect(text).toContain("Deductible choices");
    expect(text).toContain("Plan name unconfirmed (upload 1)");
    expect(text).toContain("Plan name unconfirmed (upload 2)");
    expect(text).toContain("Scholar Shield Basic");
    expect(text).toContain("Scholar Shield Elite");
    expect(text).toContain("Lone Star");
    expect(text).toContain("acmetravel.pdf");
    expect(text).toContain("northpoint.pdf");
    expect(text).toContain("page 3");
    expect(text).toContain("page 2");
    expect(text).toContain("F-1");
    expect(text).toContain(" / ");
    expect(pageCount).toBeGreaterThan(1);

    expect(text).not.toContain("sess-");
    expect(text).not.toContain(own.capability);
    expect(text).not.toContain("ev-");
  });

  it("exports only the selected document scope, not the whole session", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(
      request(own.session.sessionId, own.capability, selectionWith({
        planIds: ["doc-1"],
        tiers: { "doc-1": "Scholar Shield Elite" },
        legacyTiersByDocument: { "doc-1": "Scholar Shield Elite" },
      })),
    );
    expect(response.status).toBe(200);
    const { text } = await pdfText(new Uint8Array(await response.arrayBuffer()));
    expect(text).toContain("$100");
    // The unselected second document and its tier never enter the report.
    expect(text).not.toContain("$50");
    expect(text).not.toContain("Lone Star");
    expect(text).toContain("northpoint.pdf"); // still cites the source file name list
    expect(text).toContain("Scholar Shield Elite");
    expect(text).not.toContain("Scholar Shield Basic");
  });

  it("parameter-1 never lands at all tiers; eligible text stays verbatim", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    const response = await POST(request(own.session.sessionId, own.capability, selectionWith()));
    const { text } = await pdfText(new Uint8Array(await response.arrayBuffer()));
    // Value text is verbatim and never paraphrased or refused.
    expect(text).toContain("$0");
    expect(text).toContain("coverage details with qualifications");
  });

  it("still rejects missing and wrong capabilities before any result read", async () => {
    const own = ownSession();
    await saveFor(own.session.sessionId);
    expect((await POST(request(own.session.sessionId, "", selectionWith()))).status).toBe(401);
  });
});
