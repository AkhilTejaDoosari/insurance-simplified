// M7 integration: a missing exclusion section must reach the surface as an
// UNKNOWN inventory, not as silence (which would imply absence). The producer
// previously dropped every empty inventory; these tests fail if that returns.
//
// Synthetic documents only; no real policy text.
import { describe, expect, it } from "vitest";
import { sealVerifiedTable, type RegistrableDocument } from "@/app/lib/evidence/session-evidence";
import { surfacesFor } from "@/app/lib/evidence/surfaces";
import { classifyPage } from "@/app/lib/pdf/page-readability";
import { exclusionCoverageText, surfacesDisplay } from "@/app/lib/presentation/adaptive";
import type { ComparisonTable, ProvenPlan } from "@/app/lib/extraction/types";
import type { ExclusionInventoryView } from "@/app/lib/evidence/surface-types";

const SID = "sess-m7i-empty";
const PAGES = [
  "Plan name: Invented Care Gold\nSummary of benefits",
  "Covered services\nOffice visits: $20 copay\nClaims within 90 days",
];
const PLAN: ProvenPlan = {
  planId: "plan-gold",
  name: "Invented Care Gold",
  sources: [{ documentId: "s1", page: 1, quote: "Plan name: Invented Care Gold" }],
};

function evidenceWithoutSection() {
  const readability = PAGES.map((text, i) => classifyPage(i + 1, text, false));
  const doc: RegistrableDocument = {
    documentId: "s1",
    pageCount: PAGES.length,
    pages: PAGES,
    readability,
  };
  const table = {
    schemaVersion: "v1",
    factListVersion: "test",
    documents: [{ documentId: "s1", filename: "synthetic.pdf", pageCount: PAGES.length }],
    plans: [PLAN],
    rows: [],
  } as unknown as ComparisonTable;
  return sealVerifiedTable(SID, [doc], table);
}

describe("m7i missing exclusion section reaches the surface", () => {
  it("shows an unknown inventory with no items instead of dropping the section", () => {
    const surfaces = surfacesFor(evidenceWithoutSection(), SID);
    expect(surfaces.exclusions).toHaveLength(1);
    const view = surfaces.exclusions[0] as ExclusionInventoryView;
    expect(view).toMatchObject({
      kind: "exclusion-inventory",
      planName: "Invented Care Gold",
      coverage: "unknown",
      exclusions: [],
    });
  });

  it("never lets the empty unknown state read as coverage or absence", () => {
    const surfaces = surfacesFor(evidenceWithoutSection(), SID);
    const display = surfacesDisplay(
      { documents: [{ documentId: "s1", filename: "synthetic.pdf", pageCount: PAGES.length }] } as never,
      surfaces,
    ).exclusions[0];
    const text = [
      "coverageText" in display ? display.coverageText : "",
      "emptyText" in display ? display.emptyText ?? "" : "",
    ].join(" ");
    expect(text).not.toMatch(/\bNo\b/);
    expect(text).not.toMatch(/not covered|not excluded|excluded|covered/i);
    expect(text.toLowerCase()).toContain("exclusions may be missing");
    expect(exclusionCoverageText("unknown", [], PAGES.length)).toContain("may be missing");
  });
});
