// M7-G: session read-through hardening (session-store.ts).
//   - readability is restored on durable rehydration only when the
//     re-extracted page text equals the stored text (same rule as tables);
//     otherwise it stays absent and is derived from the text (EC-10).
//   - evidence restored from a persisted comparison result is re-verified
//     against the stored page text before it is registered (EC-1, EC-2);
//     unverifiable entries are dropped (M4 task-8 low finding A).
//   - a cached session is re-checked against the durable row: a deleted or
//     DELETING session is evicted and never served (low finding B).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPages } from "@/app/lib/pdf/extract-pages";

vi.mock("@/app/lib/session-db", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/session-db")>();
  return {
    ...actual,
    isSessionDbConfigured: vi.fn(() => true),
    getSessionDb: vi.fn(),
    loadSessionDocumentsDb: vi.fn(),
  };
});
vi.mock("@/app/lib/storage/objects", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/storage/objects")>();
  return { ...actual, getDocumentBytes: vi.fn() };
});
vi.mock("@/app/lib/comparison-result-db", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/comparison-result-db")>();
  return { ...actual, loadComparisonResult: vi.fn(async () => null) };
});

import { createSession, deleteSession, getEvidenceRecord, getSession, hashCapability } from "@/app/lib/session";
import { getSessionDb, isSessionDbConfigured, loadSessionDocumentsDb, type SessionRow } from "@/app/lib/session-db";
import { getDocumentBytes } from "@/app/lib/storage/objects";
import { loadComparisonResult } from "@/app/lib/comparison-result-db";
import { loadSession } from "@/app/lib/session-store";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const at = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 9, font });
  at("Policy name: Alpha", 30, 760);
  at("Annual deductible $250 per member.", 30, 720);
  at("Ambulance Up to $750. Lab work Up to $750.", 30, 700);
  pdf.addPage([612, 792]); // blank page 2
  return pdf.save();
}

const SID = "sess-m7g-store-1";
const CAP = "capability-m7g-store-0123456789";
let bytes: Uint8Array;
let pages: string[];

beforeAll(async () => {
  bytes = await samplePdf();
  pages = (await extractPages(bytes, "alpha.pdf")).pages;
});

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SID, status: "READY", context_json: {}, capability_hash: hashCapability(CAP),
    created_at: "2026-11-20T00:00:00.000Z", updated_at: "2026-11-20T00:00:00.000Z", deleted_at: null, owner_user_id: null,
    ...overrides,
  } as SessionRow;
}

function durableState(storedPages = pages) {
  vi.mocked(getSessionDb).mockResolvedValue(row());
  vi.mocked(loadSessionDocumentsDb).mockResolvedValue([
    { durableId: `${SID}--doc-1`, filename: "alpha.pdf", sha256: "a".repeat(64), objectKey: `sessions/${SID}/documents/doc-1/aa/${"a".repeat(64)}.pdf`, pages: storedPages },
  ]);
  vi.mocked(getDocumentBytes).mockResolvedValue(bytes);
}

afterEach(() => {
  deleteSession(SID);
  vi.mocked(loadComparisonResult).mockResolvedValue(null);
  vi.mocked(isSessionDbConfigured).mockReturnValue(true);
  vi.mocked(getSessionDb).mockReset();
});

describe("readability on durable rehydration", () => {
  it("restores the re-extracted readability when the page text is identical", async () => {
    durableState();
    const expected = (await extractPages(bytes, "alpha.pdf")).readability;
    const session = await loadSession(SID);
    expect(session?.documents[0].readability).toEqual(expected);
    expect(session?.documents[0].readability?.map((r) => r.status)).toEqual(["read", "empty"]);
  });

  it("leaves readability absent when the re-extracted text differs (never over-claimed)", async () => {
    durableState([pages[0].replace("$250", "$25"), pages[1]]);
    const session = await loadSession(SID);
    expect(session?.documents[0].readability).toBeUndefined();
    expect(session?.documents[0].tables).toBeUndefined();
  });
});

describe("evidence restored from a persisted result is re-verified", () => {
  it("registers only quotes that verify against the stored page text", async () => {
    durableState();
    const good = { documentId: "doc-1", page: 1, quote: "Annual deductible $250" };
    const absent = { documentId: "doc-1", page: 1, quote: "Maternity covered in full" };
    const wrongPage = { documentId: "doc-1", page: 2, quote: "Annual deductible $250" };
    const outOfRange = { documentId: "doc-1", page: 9, quote: "Annual deductible $250" };
    const nonUnique = { documentId: "doc-1", page: 1, quote: "Up to $750" };
    vi.mocked(loadComparisonResult).mockResolvedValueOnce({
      sessionId: SID, status: "READY", documentFingerprint: "x", createdAt: "", updatedAt: "", expiresAt: "",
      payload: {
        rows: [{ factName: "annual-deductible", values: [{ documentId: "doc-1", evidence: [good, absent, wrongPage] }] }],
        plans: [{ sources: [outOfRange, nonUnique] }],
      },
    } as never);
    await loadSession(SID);
    expect(getEvidenceRecord(SID, evidenceIdFor(good.documentId, good.page, good.quote))).toMatchObject(good);
    for (const bad of [absent, wrongPage, outOfRange, nonUnique]) {
      expect(getEvidenceRecord(SID, evidenceIdFor(bad.documentId, bad.page, bad.quote))).toBeUndefined();
    }
    expect(Object.keys(getSession(SID)!.evidence)).toHaveLength(1);
  });
});

describe("cached session re-checked against the durable row", () => {
  function cache() {
    createSession([{ documentId: "doc-1", filename: "alpha.pdf", pageCount: 1, pages: ["cached text"] }], {}, CAP, SID);
  }

  it("serves the cache when the row is live (one lookup)", async () => {
    cache();
    vi.mocked(getSessionDb).mockResolvedValue(row());
    const session = await loadSession(SID);
    expect(session?.documents[0].pages).toEqual(["cached text"]);
    expect(getSessionDb).toHaveBeenCalledTimes(1);
  });

  for (const [label, value] of [
    ["deleted_at set", row({ deleted_at: "2026-11-20T01:00:00.000Z" })],
    ["status DELETING", row({ status: "DELETING" } as Partial<SessionRow>)],
    ["status DELETED", row({ status: "DELETED" } as Partial<SessionRow>)],
    ["row missing", null],
  ] as const) {
    it(`evicts the cache and returns nothing when ${label}`, async () => {
      cache();
      vi.mocked(getSessionDb).mockResolvedValue(value);
      expect(await loadSession(SID)).toBeUndefined();
      expect(getSession(SID)).toBeUndefined();
    });
  }

  it("keeps the cache-only behaviour when the DB is unconfigured", async () => {
    cache();
    vi.mocked(isSessionDbConfigured).mockReturnValue(false);
    const session = await loadSession(SID);
    expect(session?.documents[0].pages).toEqual(["cached text"]);
    expect(getSessionDb).not.toHaveBeenCalled();
  });
});
