import { describe, expect, it } from "vitest";
import { cellValues, documentTiers } from "@/app/lib/extraction/tiers";
import type { CellValue, ComparisonTable } from "@/app/lib/extraction/types";

const value = (documentId: string, display: string, planTier?: string): CellValue => ({
  documentId,
  display,
  qualifiers: planTier ? { planTier } : {},
  evidence: [{ documentId, page: 1, quote: display }],
});

const table: ComparisonTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1 },
    { documentId: "doc-2", filename: "brochure.pdf", pageCount: 1 },
  ],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        value("doc-1", "$250"),
        value("doc-2", "$0 to $2,500", "Lite"),
        value("doc-2", "$0 to $25,000", "Platinum"),
      ],
    },
    {
      factName: "emergency-care",
      verdict: "SUPPORTED",
      values: [value("doc-2", "Up to $1,000,000", "plus"), value("doc-2", "Covered")],
    },
  ],
};

describe("documentTiers", () => {
  it("lists distinct tiers per document in first-seen order, case-insensitively", () => {
    const tiers = documentTiers(table);
    expect(tiers.get("doc-1")).toEqual([]);
    expect(tiers.get("doc-2")).toEqual(["Lite", "Platinum", "plus"]);
  });

  it("treats a document with a single tagged tier as single-tier", () => {
    const one: ComparisonTable = {
      ...table,
      rows: [{ factName: "x", verdict: "SUPPORTED", values: [value("doc-2", "$1", "Only")] }],
    };
    expect(documentTiers(one).get("doc-2")).toEqual(["Only"]);
  });
});

describe("cellValues", () => {
  const row = table.rows[0];
  it("returns a document's values when no tier is requested", () => {
    expect(cellValues(row.values, "doc-2").map((v) => v.display)).toEqual([
      "$0 to $2,500",
      "$0 to $25,000",
    ]);
  });
  it("filters to one tier, matching case-insensitively, and keeps untagged values", () => {
    const shared = table.rows[1];
    expect(cellValues(shared.values, "doc-2", "PLUS").map((v) => v.display)).toEqual([
      "Up to $1,000,000",
      "Covered",
    ]);
    expect(cellValues(row.values, "doc-2", "Lite").map((v) => v.display)).toEqual(["$0 to $2,500"]);
  });
});
