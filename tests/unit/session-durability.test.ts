// Session durability: the instance-local session is a cache. After instance
// loss, an authorized request rebuilds it from durable state (DB rows +
// object bytes) — pages verbatim, layout tables recomputed from the original
// bytes only when they reproduce the stored text exactly, evidence registry
// restored — so table claims and citation links keep working.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPages } from "@/app/lib/pdf/extract-pages";

vi.mock("@/app/lib/session-db", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/session-db")>();
  return {
    ...actual,
    isSessionDbConfigured: vi.fn(() => true),
    getSessionDb: vi.fn(),
    loadSessionDocumentsDb: vi.fn(),
    verifySessionCapability: vi.fn(async () => true),
    updateSessionContextDb: vi.fn(async () => undefined),
  };
});
vi.mock("@/app/lib/storage/objects", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/storage/objects")>();
  return { ...actual, getDocumentBytes: vi.fn() };
});
vi.mock("@/app/lib/comparison-result-db", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/comparison-result-db")>();
  return { ...actual, loadComparisonResult: vi.fn(async () => null), saveComparisonResult: vi.fn(async () => undefined) };
});

import { deleteSession, getEvidenceRecord, getSession, hashCapability } from "@/app/lib/session";
import { getSessionDb, loadSessionDocumentsDb } from "@/app/lib/session-db";
import { getDocumentBytes } from "@/app/lib/storage/objects";
import { loadComparisonResult } from "@/app/lib/comparison-result-db";
import { loadSession } from "@/app/lib/session-store";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

/** A one-page PDF with a real tier table (pdf.js reads it like an upload). */
async function schedulePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const at = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 9, font });
  at("Policy name: Alpha", 30, 760);
  at("BENEFIT", 30, 720); at("ELITE", 200, 720); at("BASIC", 310, 720);
  const rows: [string, string, string][] = [["Deductible", "$0", "$250"], ["Maternity Care", "Up to $5,000", "No coverage"], ["Local Ambulance", "Up to $750", "Up to $500"]];
  rows.forEach(([l, a, b], i) => { const y = 700 - i * 18; at(l, 30, y); at(a, 200, y); at(b, 310, y); });
  return pdf.save();
}

const SID = "sess-durable-test-1";
const CAP = "capability-durable-test-0123456789";
let bytes: Uint8Array;
let pages: string[];

beforeAll(async () => {
  bytes = await schedulePdf();
  pages = (await extractPages(bytes, "alpha.pdf")).pages;
});

function durableState(storedPages = pages) {
  vi.mocked(getSessionDb).mockResolvedValue({
    id: SID, status: "READY", context_json: { age: "30" }, capability_hash: hashCapability(CAP),
    created_at: "2026-11-14T00:00:00.000Z", updated_at: "2026-11-14T00:00:00.000Z", deleted_at: null, owner_user_id: null,
  });
  vi.mocked(loadSessionDocumentsDb).mockResolvedValue([
    { durableId: `${SID}--doc-1`, filename: "alpha.pdf", sha256: "a".repeat(64), objectKey: `sessions/${SID}/doc-1/${"a".repeat(64)}.pdf`, pages: storedPages },
  ]);
  vi.mocked(getDocumentBytes).mockResolvedValue(bytes);
}

afterEach(() => { deleteSession(SID); vi.mocked(loadComparisonResult).mockResolvedValue(null); });

describe("loadSession read-through", () => {
  it("rebuilds a lost instance cache: pages verbatim, tables recomputed, context and capability hash restored", async () => {
    durableState();
    expect(getSession(SID)).toBeUndefined();
    const session = await loadSession(SID);
    expect(session?.documents[0]).toMatchObject({ documentId: "doc-1", filename: "alpha.pdf", pageCount: 1, pages });
    expect(session?.documents[0].tables?.length).toBe(1);
    expect(session?.userContext).toEqual({ age: "30" });
    expect(session?.capabilityHash).toBe(hashCapability(CAP));
    expect(getSession(SID)).toBeDefined(); // cache warmed
  });

  it("attaches no tables when recomputed text differs from the stored text (fail closed)", async () => {
    durableState([pages[0].replace("$250", "$25")]);
    const session = await loadSession(SID);
    expect(session?.documents[0].tables).toBeUndefined();
    expect(session?.documents[0].pages[0]).toContain("$25");
  });

  it("returns nothing for a deleted session", async () => {
    durableState();
    vi.mocked(getSessionDb).mockResolvedValueOnce({ ...(await getSessionDb(SID))!, deleted_at: "2026-11-14T01:00:00.000Z" });
    expect(await loadSession(SID)).toBeUndefined();
  });

  it("restores the evidence registry from the persisted result so citation links resolve", async () => {
    durableState();
    const quote = "Deductible";
    vi.mocked(loadComparisonResult).mockResolvedValueOnce({
      sessionId: SID, status: "READY", documentFingerprint: "x", createdAt: "", updatedAt: "", expiresAt: "",
      payload: { rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [{ documentId: "doc-1", display: "d", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote }] }] }] },
    } as never);
    await loadSession(SID);
    expect(getEvidenceRecord(SID, evidenceIdFor("doc-1", 1, quote))).toMatchObject({ quote });
  });
});

describe("loadSessionDocumentsDb scoping", () => {
  it("never loads a document outside the session scope, nor a document with page gaps", async () => {
    const { loadSessionDocumentsDb: real } = await vi.importActual<typeof import("@/app/lib/session-db")>("@/app/lib/session-db");
    const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
    process.env.SUPABASE_URL = "https://example.invalid";
    process.env.SUPABASE_SECRET_KEY = "test-placeholder-not-a-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/rest/v1/documents")) {
        return new Response(JSON.stringify([
          { id: `${SID}--doc-1`, filename: "a.pdf", sha256: "a", object_key: null },
          { id: `other-session--doc-1`, filename: "x.pdf", sha256: "b", object_key: null },
          { id: `${SID}--doc-2`, filename: "b.pdf", sha256: "c", object_key: null },
        ]));
      }
      if (url.includes(encodeURIComponent(`${SID}--doc-2`))) return new Response(JSON.stringify([{ page_number: 1, text: "p1" }, { page_number: 3, text: "p3" }]));
      return new Response(JSON.stringify([{ page_number: 1, text: "p1" }, { page_number: 2, text: "p2" }]));
    });
    try {
      const docs = await real(SID);
      expect(docs.map((d) => d.durableId)).toEqual([`${SID}--doc-1`]);
      expect(docs[0].pages).toEqual(["p1", "p2"]);
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("other-session"))).toBe(false);
    } finally {
      fetchMock.mockRestore();
      if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
      if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = saved.key;
    }
  });
});

describe("POST /api/extract after instance loss", () => {
  it("serves table claims from the rebuilt session", async () => {
    durableState();
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { POST } = await import("@/app/api/extract/route");
    const res = await POST(new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-capability": CAP },
      body: JSON.stringify({ sessionId: SID, engine: "fallback" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ded = body.rows.find((r: { factName: string }) => r.factName === "annual-deductible").values;
    expect(ded.filter((v: { planId?: string }) => v.planId).map((v: { display: string }) => v.display)).toEqual([
      "Deductible (ELITE): $0",
      "Deductible (BASIC): $250",
    ]);
  });
});
