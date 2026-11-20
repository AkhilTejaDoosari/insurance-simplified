// M7 (agent I): export PDF sections for the evidence surfaces, built from
// read-back re-derivation only — never from the stored payload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { buildReportPdf } from "@/app/lib/report/pdf";
import type { EvidenceSurfaces } from "@/app/lib/evidence/surface-types";
import {
  authorityCbc,
  complete,
  completeEmpty,
  conflict,
  exclusionsCbc,
  forbiddenWording,
  partial,
  partialEmpty,
  resolved,
  surfaces,
  table,
  unknownEmpty,
} from "./helpers/m7i-surfaces";

// The route's single re-derivation call; real implementation unless a test
// overrides it.
const readBack = vi.hoisted(() => ({ override: null as null | (() => EvidenceSurfaces | null) }));
vi.mock("@/app/lib/evidence/surfaces-consumer/read-back", async (importActual) => {
  const actual = await importActual<typeof import("@/app/lib/evidence/surfaces-consumer/read-back")>();
  return {
    ...actual,
    surfacesForReadBack: (input: Parameters<typeof actual.surfacesForReadBack>[0]) =>
      readBack.override ? readBack.override() : actual.surfacesForReadBack(input),
  };
});

import { POST } from "@/app/api/export/route";
import {
  deleteComparisonResult,
  documentFingerprint,
  resultFingerprintFor,
  saveComparisonResult,
  type PersistedComparisonResultPayload,
} from "@/app/lib/comparison-result-db";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE, type SessionDocument } from "@/app/lib/session";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes);
  const result = await extractText(proxy, { mergePages: true });
  return (Array.isArray(result.text) ? result.text.join(" ") : result.text).replace(/\s+/g, " ");
}

const report = async (s: EvidenceSurfaces | null, selection?: Record<string, unknown>) =>
  pdfText(
    await buildReportPdf({
      table,
      userContext: {},
      surfaces: s,
      ...(selection ? { selection: { resultFingerprint: "f", tiers: {}, legacyTiersByDocument: {}, planIds: [], ...selection } as never } : {}),
    }),
  );

describe("m7i export PDF text", () => {
  it("lists each plan's exclusions verbatim with file and page, and the reading state", async () => {
    const text = await report(surfaces([complete, partial]));
    expect(text).toContain("Exclusions read");
    expect(text).toContain("Sample Plan A (plan-a.pdf)");
    expect(text).toContain("All 6 pages were read.");
    expect(text).toContain('"Cosmetic procedures are not a benefit under this plan." (plan-a.pdf, page 5)');
    expect(text).toContain('"Injuries from hazardous sports." (plan-a.pdf, page 6)');
    expect(text).toContain("Pages 3 and 4 could not be read fully - exclusions there may be missing.");
    expect(text).not.toContain("ev-x");
  });

  it("empty lists: complete says no exclusion section was found; unknown says exclusions may be missing", async () => {
    const text = await report(surfaces([completeEmpty, unknownEmpty]));
    expect(text).toContain("An exclusion section was not found in the pages read.");
    expect(text).toContain("It is not known whether every page was read - exclusions may be missing.");
  });

  it("authority: governing document with proof quotes, and CONFLICTED with reasons", async () => {
    const text = await report(surfaces([], [resolved, conflict]));
    expect(text).toContain("Which document governs");
    expect(text).toContain("plan-a-rider.pdf governs annual deductible (Sample Plan A).");
    expect(text).toContain('"This rider replaces the deductible schedule of Sample Plan A." (plan-a-rider.pdf, page 1)');
    expect(text).toContain("CONFLICTED: The documents disagree about out-of-pocket maximum (Sample Plan A)");
    expect(text).toContain("Why: their coverage periods could not be matched; neither document states that it replaces the other.");
  });

  it("cannot be confirmed shows the phrase and no values", async () => {
    const text = await report(surfaces([exclusionsCbc], [authorityCbc]));
    expect(text).toContain("NEEDS VERIFICATION: This plan's exclusion list cannot be confirmed");
    expect(text).toContain("NEEDS VERIFICATION: Which document governs cannot be confirmed");
    expect(text).not.toContain("Sample Plan");
  });

  it("scopes to the selected view's documents", async () => {
    const text = await report(surfaces([complete, partial]), { viewMode: "compare", planIds: ["pb"] });
    expect(text).toContain("Sample Plan B (plan-b.pdf)");
    expect(text).not.toContain("Sample Plan A (plan-a.pdf)");
  });

  it("never says No / Not covered / Not excluded / Excluded for a missing item", async () => {
    const text = await report(surfaces([unknownEmpty, partialEmpty, completeEmpty, exclusionsCbc], [conflict, authorityCbc]));
    const body = text.slice(text.indexOf("Exclusions read"));
    expect(forbiddenWording(body)).toEqual([]);
  });

  it("no surfaces: no section", async () => {
    expect(await report(null)).not.toContain("Exclusions read");
  });
});

// ---- Route: re-derivation only ------------------------------------------
const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");
const originalEnv = { ...process.env };
const created: string[] = [];
const docs: SessionDocument[] = [
  { documentId: "d1", filename: "plan-a.pdf", pageCount: 2, pages: ["Sample Plan A deductible $100", "Sample exclusions page"] },
];
const basePayload: PersistedComparisonResultPayload = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "d1", filename: "plan-a.pdf", pageCount: 2 }],
  rows: [],
  contacts: [],
  userContext: {},
};
const FORGED_CLAIM = "Forged stored exclusion line";
const forgedSurfaces: EvidenceSurfaces = surfaces([
  {
    kind: "exclusion-inventory",
    documentId: "d1",
    planId: "pa",
    planName: "Forged plan",
    coverage: "complete",
    pagesNotRead: [],
    exclusions: [{ provisionId: "p", claim: FORGED_CLAIM, evidence: [{ documentId: "d1", page: 2, quote: FORGED_CLAIM }] }],
  },
]);

async function exportWith(stored: Partial<PersistedComparisonResultPayload> & { surfaces?: unknown }) {
  const { session, capability } = createSession(docs, {});
  created.push(session.sessionId);
  const p = { ...basePayload, ...stored } as PersistedComparisonResultPayload;
  const fingerprint = resultFingerprintFor({ documentFingerprint: documentFingerprint(docs), table: p, context: {} });
  await saveComparisonResult({ sessionId: session.sessionId, documentFingerprint: documentFingerprint(docs), payload: { ...p, resultFingerprint: fingerprint } });
  const res = await POST(
    new NextRequest("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
      body: JSON.stringify({ sessionId: session.sessionId, selection: { resultFingerprint: fingerprint, planIds: ["d1"], tiers: {}, legacyTiersByDocument: {} } }),
    }),
  );
  expect(res.status).toBe(200);
  return pdfText(new Uint8Array(await res.arrayBuffer()));
}

describe("m7i export route uses read-back re-derivation", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SECRET_KEY = "";
    process.env.SUPABASE_SERVICE_KEY = "";
    readBack.override = null;
  });
  afterEach(async () => {
    readBack.override = null;
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      await deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  it("never prints stored surfaces: a stored inventory that is not re-derived is 'cannot be confirmed'", async () => {
    const text = await exportWith({ surfaces: forgedSurfaces });
    expect(text).not.toContain(FORGED_CLAIM);
    expect(text).not.toContain("Forged plan");
    expect(text).toContain("This plan's exclusion list cannot be confirmed");
  });

  it("prints the re-derived surfaces, not the stored ones", async () => {
    readBack.override = () =>
      surfaces([{ ...completeEmpty, documentId: "d1", planName: "Sample Plan A" }]);
    const text = await exportWith({ surfaces: forgedSurfaces });
    expect(text).not.toContain(FORGED_CLAIM);
    expect(text).toContain("Sample Plan A (plan-a.pdf)");
    expect(text).toContain("All 2 pages were read.");
    expect(text).toContain("An exclusion section was not found in the pages read.");
  });

  it("legacy stored results without surfaces print no section", async () => {
    expect(await exportWith({})).not.toContain("Exclusions read");
  });
});
