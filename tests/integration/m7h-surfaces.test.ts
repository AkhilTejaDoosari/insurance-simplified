// M7 agent H: evidence surfaces producer — inventory views from sealed
// exclusions + page coverage, issued-surface gate, read-back re-derivation,
// and the /api/extract wiring. Synthetic, invented documents only.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { sealVerifiedTable, type RegistrableDocument } from "@/app/lib/evidence/session-evidence";
import { issueSurfaces, renderIssuedSurfaces, rederiveSurfaces, surfacesFor, SURFACES_ISSUER } from "@/app/lib/evidence/surfaces";
import { issueResolution } from "@/app/lib/evidence/issued";
import { confirmStoredResult } from "@/app/lib/evidence/read-back";
import { readabilityCoverageSource } from "@/app/lib/evidence/registry";
import { classifyPage, type PageReadability } from "@/app/lib/pdf/page-readability";
import { loadComparisonResult } from "@/app/lib/comparison-result-db";
import { getEvidenceRecord } from "@/app/lib/session";
import type { ComparisonTable, ProvenPlan } from "@/app/lib/extraction/types";
import type { ExclusionInventoryView } from "@/app/lib/evidence/surface-types";
import { blankProviderEnv, extractedSession, SESSIONS_DIR } from "@/tests/integration/m7b-fixtures";

const SID = "sess-m7h-surfaces";
const PAGES = [
  "Plan name: Invented Care Gold\nSummary of benefits",
  "Exclusions\n• Cosmetic surgery\n• Long-term care\n• Routine foot care\nCovered Services\nOffice visits: $20 copay",
  "Claims\nSubmit claims within 90 days of the date of service to the claims office listed on your card.",
];
const PLAN: ProvenPlan = { planId: "plan-gold", name: "Invented Care Gold", sources: [{ documentId: "s1", page: 1, quote: "Plan name: Invented Care Gold" }] };

function table(docs: RegistrableDocument[], plans: ProvenPlan[]): ComparisonTable {
  return {
    schemaVersion: "v1", factListVersion: "test",
    documents: docs.map((d) => ({ documentId: d.documentId, filename: "synthetic.pdf", pageCount: d.pageCount })),
    plans, rows: [],
  } as unknown as ComparisonTable;
}

function evidenceFor(readability?: PageReadability[]) {
  const d: RegistrableDocument = { documentId: "s1", pageCount: PAGES.length, pages: PAGES, ...(readability ? { readability } : {}) };
  return sealVerifiedTable(SID, [d], table([d], [PLAN]));
}

const allRead = () => PAGES.map((t, i) => classifyPage(i + 1, t, false));

describe("m7h inventory views", () => {
  it("the inventory view equals the sealed exclusion provisions", () => {
    const ev = evidenceFor(allRead());
    const surfaces = surfacesFor(ev, SID);
    expect(surfaces.exclusions).toHaveLength(1);
    const view = surfaces.exclusions[0] as ExclusionInventoryView;
    expect(view.kind).toBe("exclusion-inventory");
    const sealed = ev.store.listByKind("exclusion", { documentId: "s1" });
    expect(view.exclusions.map((e) => e.provisionId).sort()).toEqual(sealed.map((p) => p.provisionId).sort());
    expect(view.exclusions.map((e) => e.claim).sort()).toEqual(["Cosmetic surgery", "Long-term care", "Routine foot care"]);
    for (const e of view.exclusions) expect(e.evidence[0].evidenceId).toMatch(/^ev-[0-9a-f]{16}$/);
    expect(view).toMatchObject({ planId: "plan-gold", planName: "Invented Care Gold", coverage: "complete", pagesNotRead: [] });
    expect(surfaces.authority).toEqual([]); // one document: no authority views
  });

  it("coverage is partial, naming the page, when a page is unreadable or only partly read", () => {
    const partly = allRead();
    partly[2] = classifyPage(3, "x", true); // sparse text + images → partly-unreadable
    expect(partly[2].status).toBe("partly-unreadable");
    const view = surfacesFor(evidenceFor(partly), SID).exclusions[0] as ExclusionInventoryView;
    expect(view.coverage).toBe("partial");
    expect(view.pagesNotRead).toEqual([3]);
  });

  it("a stored readability record that hides an empty page is re-derived from the text", () => {
    const pages = [...PAGES, ""];
    const lying = [...allRead(), { page: 4, status: "read", textChars: 0 } as PageReadability];
    const record = readabilityCoverageSource([{ documentId: "s1", pages, readability: lying }])
      .coverageFor({ sessionId: SID, documentId: "s1", documentSha256: "0".repeat(64), pageCount: 4, pages });
    expect(record?.pages[3]).toMatchObject({ page: 4, status: "not_read" });
  });

  it("without a readability record, coverage is derived from page text; complete only if every page has text", () => {
    const view = surfacesFor(evidenceFor(undefined), SID).exclusions[0] as ExclusionInventoryView;
    expect(view.coverage).toBe("complete");
  });
});

describe("m7h issued-surface gate (TB-3 style)", () => {
  it("an altered issued surface cannot be confirmed; the unaltered one renders", () => {
    const ev = evidenceFor(allRead());
    const { issued } = issueSurfaces(ev, SID);
    const ok = renderIssuedSurfaces(ev.authority, SID, issued);
    expect(ok.exclusions[0].kind).toBe("exclusion-inventory");

    const tampered = structuredClone(issued.exclusions[0]) as unknown as { resolution: ExclusionInventoryView };
    tampered.resolution.exclusions.pop(); // drop an exclusion after issue
    expect(renderIssuedSurfaces(ev.authority, SID, { exclusions: [tampered] }).exclusions[0])
      .toEqual({ kind: "cannot-be-confirmed", of: "exclusion-inventory", label: "cannot be confirmed" });

    const flipped = structuredClone(issued.exclusions[0]) as unknown as { resolution: ExclusionInventoryView };
    flipped.resolution.coverage = "complete";
    flipped.resolution.pagesNotRead = [2];
    expect(renderIssuedSurfaces(ev.authority, SID, { exclusions: [flipped] }).exclusions[0].kind).toBe("cannot-be-confirmed");

    // Another authority (e.g. read back from storage) or another session.
    expect(renderIssuedSurfaces(new EvidenceAuthority(), SID, issued).exclusions[0].kind).toBe("cannot-be-confirmed");
    expect(renderIssuedSurfaces(ev.authority, "sess-other", issued).exclusions[0].kind).toBe("cannot-be-confirmed");
    // A caller-built view that was never issued.
    expect(renderIssuedSurfaces(ev.authority, SID, { exclusions: [{ resolution: ok.exclusions[0] }] }).exclusions[0].kind).toBe("cannot-be-confirmed");
  });
});

describe("m7h self-contradicting views are never shown", () => {
  it("an issued but self-contradicting view renders as cannot be confirmed", () => {
    const ev = evidenceFor(allRead());
    const view = surfacesFor(ev, SID).exclusions[0] as ExclusionInventoryView;
    const meta = { sessionId: SID, issuer: SURFACES_ISSUER };
    const bad = issueResolution(ev.authority, { ...view, coverage: "complete", pagesNotRead: [3] }, meta);
    expect(renderIssuedSurfaces(ev.authority, SID, { exclusions: [bad] }).exclusions[0].kind).toBe("cannot-be-confirmed");
    const resolvedConflicted = issueResolution(ev.authority, { kind: "authority", scopeLabel: "x", status: "resolved", verdict: "CONFLICTED", governing: [], relations: [] }, meta);
    expect(renderIssuedSurfaces(ev.authority, SID, { authority: [resolvedConflicted] }).authority[0].kind).toBe("cannot-be-confirmed");
    const bareSupersedes = issueResolution(ev.authority, { kind: "authority", scopeLabel: "x", status: "resolved", governing: [], relations: [{ from: "a", to: "b", relation: "supersedes", evidence: [] }] }, meta);
    expect(renderIssuedSurfaces(ev.authority, SID, { authority: [bareSupersedes] }).authority[0].kind).toBe("cannot-be-confirmed");
  });
});

describe("m7h authority views (2+ documents)", () => {
  it("documents of different verified plans produce no authority view (different plan values ≠ conflict)", () => {
    const a: RegistrableDocument = { documentId: "a1", pageCount: 1, pages: ["Plan name: Invented One\nDeductible: $500"] };
    const b: RegistrableDocument = { documentId: "b1", pageCount: 1, pages: ["Plan name: Invented Two\nDeductible: $900"] };
    const plans: ProvenPlan[] = [
      { planId: "p1", name: "Invented One", sources: [{ documentId: "a1", page: 1, quote: "Plan name: Invented One" }] },
      { planId: "p2", name: "Invented Two", sources: [{ documentId: "b1", page: 1, quote: "Plan name: Invented Two" }] },
    ];
    const ev = sealVerifiedTable(SID, [a, b], table([a, b], plans));
    expect(surfacesFor(ev, SID).authority).toEqual([]);
  });
});

describe("m7h /api/extract surfaces + read-back", () => {
  const created: string[] = [];
  beforeAll(() => blankProviderEnv());
  afterAll(() => {
    for (const id of created) {
      for (const f of readdirSync(SESSIONS_DIR).filter((n) => n.startsWith(id))) rmSync(join(SESSIONS_DIR, f), { force: true });
    }
  });

  const DOCUMENT = {
    documentId: "doc-m7h",
    filename: "synthetic-plan.pdf",
    pageCount: 2,
    pages: [
      "Plan name: Invented Health Bronze\nSummary of benefits",
      "Specialist visit: $40 copay\nExclusions\n• Cosmetic surgery\n• Long-term care\nCovered Services\nEmergency room: $250 copay",
    ],
  };

  it("adds top-level surfaces, registers their quotes, stores them, and re-derives them on read-back", async () => {
    const { sessionId, table: res } = await extractedSession(created, DOCUMENT);
    expect(res.surfaces.schema).toBe("evidence-surfaces/v1");
    const view = res.surfaces.exclusions[0] as ExclusionInventoryView;
    expect(view.kind).toBe("exclusion-inventory");
    expect(view.exclusions.map((e) => e.claim).sort()).toEqual(["Cosmetic surgery", "Long-term care"]);
    for (const e of view.exclusions.flatMap((x) => x.evidence)) {
      expect(getEvidenceRecord(sessionId, e.evidenceId!)).toMatchObject({ documentId: e.documentId, page: e.page, quote: e.quote });
    }

    const record = await loadComparisonResult(sessionId);
    expect(record?.payload.surfaces).toEqual(res.surfaces);
    const documents = [structuredClone(DOCUMENT)];
    const confirmed = confirmStoredResult({ sessionId, documents, record: record! });
    expect(rederiveSurfaces({ sessionId, documents, record: record!, confirmed })).toEqual(res.surfaces);

    // A stored view edited after extraction does not re-derive.
    const edited = structuredClone(record!);
    (edited.payload.surfaces!.exclusions[0] as ExclusionInventoryView).exclusions.pop();
    const c2 = confirmStoredResult({ sessionId, documents, record: edited });
    expect(rederiveSurfaces({ sessionId, documents, record: edited, confirmed: c2 })!.exclusions[0].kind).toBe("cannot-be-confirmed");

    // Changed page text: nothing re-derives.
    const changed = [{ ...structuredClone(DOCUMENT), pages: [DOCUMENT.pages[0], DOCUMENT.pages[1].replace("Long-term care", "Long term care")] }];
    const c3 = confirmStoredResult({ sessionId, documents: changed, record: record! });
    expect(rederiveSurfaces({ sessionId, documents: changed, record: record!, confirmed: c3 })!.exclusions[0].kind).toBe("cannot-be-confirmed");

    // A legacy record without surfaces yields null (nothing to confirm).
    const legacy = structuredClone(record!);
    delete legacy.payload.surfaces;
    expect(rederiveSurfaces({ sessionId, documents, record: legacy, confirmed })).toBeNull();
  });
});
