import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { buildReportPdf } from "@/app/lib/report/pdf";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

const table: RegisteredComparisonTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "sample-plan.pdf", pageCount: 3 }],
  presentationGroups: [{ title: "Costs and choices", factNames: ["annual-deductible", "premium"] }],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        { documentId: "doc-1", display: "$0 deductible", qualifiers: { planTier: "Basic" },
          evidence: [{ documentId: "doc-1", page: 2, quote: "Basic deductible $0", evidenceId: "ev-1" }] },
        { documentId: "doc-1", display: "$500 deductible", qualifiers: { planTier: "Choice" },
          evidence: [{ documentId: "doc-1", page: 2, quote: "Choice deductible $500", evidenceId: "ev-2" }] },
      ],
    },
    { factName: "premium", verdict: "NOT STATED", values: [] },
  ],
};

async function pagesOf(bytes: Uint8Array): Promise<string[]> {
  const proxy = await getDocumentProxy(bytes);
  const result = await extractText(proxy, { mergePages: false });
  return Array.isArray(result.text) ? result.text : [result.text];
}

describe("PDF report from validated workspace data", () => {
  it("includes both tiers, an honest unknown, document/page citations, and no session credentials", async () => {
    const bytes = await buildReportPdf({ table, userContext: { age: "34" } });
    const pages = await pagesOf(bytes);
    const text = pages.join(" ");
    expect(text).toContain("Insurance document summary");
    expect(text).toContain("Costs and choices");
    expect(text).toContain("Basic");
    expect(text).toContain("Choice");
    expect(text).toContain("sample-plan.pdf");
    expect(text).toContain("page 2");
    expect(text).toContain("Not stated");
    expect(text).not.toContain("ev-1");
    expect(text).not.toContain("sess-");
  });

  it("paginates many long rows and preserves a source reference at the end", async () => {
    const longTable: RegisteredComparisonTable = {
      ...table,
      rows: Array.from({ length: 22 }, (_, index) => ({
        factName: `benefit-${index}`,
        verdict: "SUPPORTED" as const,
        values: [{
          documentId: "doc-1",
          display: `Benefit ${index}: ` + "coverage details with qualifications ".repeat(14),
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 3, quote: "Coverage details", evidenceId: `ev-${index}` }],
        }],
      })),
      presentationGroups: [{ title: "Observed benefits", factNames: Array.from({ length: 22 }, (_, i) => `benefit-${i}`) }],
    };
    const pages = await pagesOf(await buildReportPdf({ table: longTable, userContext: {} }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join(" ")).toContain("Benefit 21");
    expect(pages.join(" ")).toContain("page 3");
  });
});
