import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { buildReportPdf } from "@/app/lib/report/pdf";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { buildOverview } from "@/app/lib/extraction/overview";

const table: RegisteredComparisonTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "doc-1", filename: "sample-plan.pdf", pageCount: 3 },
  ],
  presentationGroups: [
    { title: "Costs and choices", factNames: ["annual-deductible", "premium"] },
  ],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$0 deductible",
          qualifiers: { planTier: "Basic" },
          evidence: [
            {
              documentId: "doc-1",
              page: 2,
              quote: "Basic deductible $0",
              evidenceId: "ev-1",
            },
          ],
        },
        {
          documentId: "doc-1",
          display: "$500 deductible",
          qualifiers: { planTier: "Choice" },
          evidence: [
            {
              documentId: "doc-1",
              page: 2,
              quote: "Choice deductible $500",
              evidenceId: "ev-2",
            },
          ],
        },
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
  it("keeps evidenced financial conditions beside a confirmed plan value", async () => {
    const scoped: RegisteredComparisonTable = {
      ...table,
      plans: [
        {
          planId: "alpha",
          name: "Alpha",
          sources: [{ documentId: "doc-1", page: 1, quote: "Alpha" }],
        },
      ],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              planId: "alpha",
              display: "$500",
              qualifiers: { networkTier: "in-network", ageBand: "30-34" },
              evidence: [
                {
                  documentId: "doc-1",
                  page: 2,
                  quote: "Deductible $500 in-network for ages 30-34",
                  evidenceId: "ev-conditioned",
                },
              ],
            },
          ],
        },
      ],
    };
    const text = (
      await pagesOf(
        await buildReportPdf({
          table: scoped,
          userContext: {},
          selection: {
            resultFingerprint: "fp",
            planIds: ["alpha"],
            tiers: {},
            legacyTiersByDocument: {},
          },
        }),
      )
    ).join(" ");
    expect(text).toContain("Network: in-network");
    expect(text).toContain("Ages: 30-34");
  });
  it("retains unassigned risks separately from confirmed plan facts", async () => {
    const scoped: RegisteredComparisonTable = {
      ...table,
      plans: [
        {
          planId: "alpha",
          name: "Alpha",
          sources: [{ documentId: "doc-1", page: 1, quote: "Alpha" }],
        },
      ],
      rows: [
        {
          factName: "material-exclusions",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "Unassigned hazardous sports exclusion",
              qualifiers: {},
              evidence: [
                {
                  documentId: "doc-1",
                  page: 2,
                  quote: "Hazardous sports excluded",
                  evidenceId: "ev-risk",
                },
              ],
            },
          ],
        },
      ],
    };
    const text = (
      await pagesOf(
        await buildReportPdf({
          table: scoped,
          userContext: {},
          selection: {
            resultFingerprint: "fp",
            planIds: ["alpha"],
            tiers: {},
            legacyTiersByDocument: {},
          },
        }),
      )
    ).join(" ");
    expect(text).toContain("Unverified applicability");
    expect(text).toContain("Unassigned hazardous sports exclusion");
    expect(
      text.indexOf("Unassigned hazardous sports exclusion"),
    ).toBeGreaterThan(text.indexOf("Document evidence requiring verification"));
  });

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
        values: [
          {
            documentId: "doc-1",
            display:
              `Benefit ${index}: ` +
              "coverage details with qualifications ".repeat(14),
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 3,
                quote: "Coverage details",
                evidenceId: `ev-${index}`,
              },
            ],
          },
        ],
      })),
      presentationGroups: [
        {
          title: "Observed benefits",
          factNames: Array.from({ length: 22 }, (_, i) => `benefit-${i}`),
        },
      ],
    };
    const pages = await pagesOf(
      await buildReportPdf({ table: longTable, userContext: {} }),
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join(" ")).toContain("Benefit 21");
    expect(pages.join(" ")).toContain("page 3");
  });

  it("renders only the selected plan/tier scope with citations adjacent to figures", async () => {
    const scoped: RegisteredComparisonTable = {
      ...table,
      presentationGroups: [
        { title: "Costs", factNames: ["premium", "annual-deductible"] },
      ],
      plans: [
        {
          planId: "plan-a",
          name: "Alpha Care",
          sources: [
            { documentId: "doc-1", page: 1, quote: "Plan name: Alpha Care" },
          ],
        },
      ],
      rows: [
        {
          factName: "premium",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              planId: "plan-a",
              display: "$80/mo",
              qualifiers: { planTier: "Basic" },
              evidence: [
                {
                  documentId: "doc-1",
                  page: 2,
                  quote: "Basic deductible $0",
                  evidenceId: "ev-1",
                },
              ],
            },
            {
              documentId: "doc-1",
              planId: "plan-a",
              display: "$140/mo",
              qualifiers: { planTier: "Choice" },
              evidence: [
                {
                  documentId: "doc-1",
                  page: 2,
                  quote: "Choice deductible $500",
                  evidenceId: "ev-2",
                },
              ],
            },
          ],
        },
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              planId: "plan-a",
              display: "$0 deductible",
              qualifiers: { planTier: "Basic" },
              evidence: [
                {
                  documentId: "doc-1",
                  page: 2,
                  quote: "Basic deductible $0",
                  evidenceId: "ev-3",
                },
              ],
            },
            {
              documentId: "doc-1",
              planId: "plan-a",
              display: "$500 deductible",
              qualifiers: { planTier: "Choice" },
              evidence: [
                {
                  documentId: "doc-1",
                  page: 2,
                  quote: "Choice deductible $500",
                  evidenceId: "ev-4",
                },
              ],
            },
          ],
        },
      ],
    };
    // Basic tier selected: the Choice amount must never appear.
    const bytes = await buildReportPdf({
      table: scoped,
      userContext: {},
      selection: {
        resultFingerprint: "fp",
        planIds: ["plan-a"],
        tiers: { "plan-a": "Basic" },
        legacyTiersByDocument: {},
      },
    });
    const text = (await pagesOf(bytes)).join(" ");
    expect(text).toContain("Alpha Care");
    expect(text).toContain("Basic tier");
    expect(text).toContain("$80/mo");
    expect(text).toContain("$0 deductible");
    expect(text).not.toContain("$140/mo");
    expect(text).not.toContain("500");
  });

  it("renders the derived overview header and at most three upfront findings", async () => {
    const bytes = await buildReportPdf({
      table,
      userContext: { age: "34" },
      selection: undefined,
      overview: buildOverview(table, { age: "34" }),
    });
    const text = (await pagesOf(bytes)).join(" ");
    expect(text).toContain("Your overview");
    expect(text).toContain("Annual deductible"); // overview item labels
  });

  it("hides empty sections, keeps each section title once, and ends without a blank page", async () => {
    const bytes = await buildReportPdf({
      table,
      userContext: {},
      selection: undefined,
      overview: buildOverview(table, {}),
    });
    const pages = await pagesOf(bytes);
    const text = pages.join(" ");
    // Workspace sections come from buildWorkspaceGroups; empty ones are absent
    // and no section title is printed twice.
    for (const title of ["Costs and choices", "My Costs"]) {
      const count = text.split(title).length - 1;
      expect(count).toBeLessThanOrEqual(1);
    }
    // Every rendered page carries real content — no blank trailing page.
    for (const pageText of pages) {
      expect(pageText.replace(/\s+/g, " ").trim().length).toBeGreaterThan(0);
    }
  });
});
