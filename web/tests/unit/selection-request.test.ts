// M5: the shared client-selection contract used by BOTH chat and export.
// Structural parse + validation against the server-side validated table.

import { describe, expect, it } from "vitest";
import {
  hasProvenPlans,
  parseSelectionRequest,
  selectionMatchesResultFingerprint,
  validateSelectionScope,
  type SelectionRequest,
} from "@/app/lib/extraction/selection-request";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

function valid(): SelectionRequest {
  return {
    resultFingerprint: "fp-1",
    planIds: ["doc-1"],
    tiers: { "doc-1": null },
    legacyTiersByDocument: { "doc-1": "Basic" },
  };
}

const legacyTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$250",
          qualifiers: { planTier: "Basic" },
          evidence: [{ documentId: "doc-1", page: 1, quote: "deductible $250" }],
        },
      ],
    },
  ],
} as unknown as RegisteredComparisonTable;

describe("parseSelectionRequest", () => {
  it("accepts the canonical payload shape with an optional selection key", () => {
    const parsed = parseSelectionRequest({ ...valid(), selectionKey: "k" });
    expect(parsed).toEqual({ ...valid(), selectionKey: "k" });
  });

  it("rejects structurally malformed payloads", () => {
    expect(parseSelectionRequest(null)).toBeUndefined();
    expect(parseSelectionRequest("x")).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), resultFingerprint: "" })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), planIds: [] })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), planIds: ["a", "b", "c", "d", "e", "f"] })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), planIds: [42] })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), tiers: "all" })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), tiers: { "doc-1": 3 } })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), legacyTiersByDocument: { "doc-1": null } })).toBeUndefined();
    expect(parseSelectionRequest({ ...valid(), selectionKey: 1 })).toBeUndefined();
  });
});

describe("validateSelectionScope", () => {
  it("validates legacy plans against uploaded documents and documentTiers", () => {
    expect(validateSelectionScope(valid(), legacyTable)).toBeUndefined();
    expect(validateSelectionScope({ ...valid(), planIds: ["doc-2"] }, legacyTable)).toBe("foreign-plan");
    expect(
      validateSelectionScope({ ...valid(), legacyTiersByDocument: { "doc-1": "Silver" } }, legacyTable),
    ).toBe("unsupported-tier");
  });

  it("rejects empty legacy selection payloads outright", () => {
    const noTiers = { ...valid(), legacyTiersByDocument: {} };
    expect(validateSelectionScope(noTiers, legacyTable)).toBeUndefined();
  });

  it("requires evidence for proven-plan tiers", () => {
    const table = {
      ...legacyTable,
      plans: [
        { planId: "p1", name: "Alpha", sources: [] },
        { planId: "p2", name: "Beta", sources: [] },
        { planId: "p3", name: "Gamma", sources: [] },
        { planId: "p4", name: "Delta", sources: [] },
      ],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              planId: "p1",
              display: "$250",
              qualifiers: { planTier: "Choice" },
              evidence: [{ documentId: "doc-1", page: 1, quote: "x" }],
            },
          ],
        },
      ],
    } as unknown as RegisteredComparisonTable;
    expect(hasProvenPlans(table)).toBe(true);
    const proven: SelectionRequest = {
      resultFingerprint: "fp-1",
      planIds: ["p1"],
      tiers: { p1: "Choice" },
      legacyTiersByDocument: {},
    };
    expect(validateSelectionScope(proven, table)).toBeUndefined();
    expect(validateSelectionScope({ ...proven, tiers: { p1: "Platinum" } }, table)).toBe("unsupported-tier");
    expect(validateSelectionScope({ ...proven, planIds: ["p-nope"] }, table)).toBe("foreign-plan");
    expect(validateSelectionScope({ ...proven, planIds: ["p1", "p2", "p3", "p4"] }, table)).toBe("too-many-plans");
  });

  it("limits an individual document view to one proven plan", () => {
    const table = {
      ...legacyTable,
      plans: ["p1", "p2"].map((planId, index) => ({
        planId,
        name: index === 0 ? "Alpha" : "Beta",
        sources: [{ documentId: "doc-1", page: 1, quote: index === 0 ? "Alpha" : "Beta" }],
      })),
    } as unknown as RegisteredComparisonTable;
    const onePlan = parseSelectionRequest({
      ...valid(),
      viewMode: "understand",
      documentId: "doc-1",
      planIds: ["p1"],
      legacyTiersByDocument: {},
    })!;
    const multiplePlans = parseSelectionRequest({
      ...valid(),
      viewMode: "understand",
      documentId: "doc-1",
      planIds: ["p1", "p2"],
      legacyTiersByDocument: {},
    })!;

    expect(validateSelectionScope(onePlan, table)).toBeUndefined();
    expect(validateSelectionScope(multiplePlans, table)).toBe("malformed");
  });

  it("allows a legacy document scope of up to five documents", () => {
    const table = {
      ...legacyTable,
      documents: [1, 2, 3, 4, 5].map((n) => ({ documentId: `doc-${n}`, filename: `d${n}.pdf`, pageCount: 1 })),
    } as unknown as RegisteredComparisonTable;
    const legacy5: SelectionRequest = {
      resultFingerprint: "fp-1",
      planIds: ["doc-1", "doc-2", "doc-3", "doc-4", "doc-5"],
      tiers: {},
      legacyTiersByDocument: {},
    };
    expect(validateSelectionScope(legacy5, table)).toBeUndefined();
  });
});

describe("selectionMatchesResultFingerprint", () => {
  it("compares opaque fingerprints; absent stored value defers to the document check", () => {
    const selection = valid();
    expect(selectionMatchesResultFingerprint(selection, "fp-1")).toBe(true);
    expect(selectionMatchesResultFingerprint(selection, "fp-2")).toBe(false);
    expect(selectionMatchesResultFingerprint(selection, undefined)).toBe(true);
  });
});
