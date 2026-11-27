import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdaptiveResults from "@/app/components/AdaptiveResults";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
(globalThis as Record<string, unknown>).React ??= React;
const table: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "a", filename: "a.pdf", pageCount: 1 },
    { documentId: "b", filename: "b.pdf", pageCount: 1 },
  ],
  plans: ["a", "b"].map((id) => ({
    planId: id,
    name: `Policy ${id}`,
    sources: [{ documentId: id, page: 1, quote: `Policy ${id}` }],
  })),
  rows: [
    {
      factName: "travel-restrictions",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "a",
          planId: "a",
          display: "Travel to specified areas excluded",
          qualifiers: { conditions: "Read the excluded areas" },
          evidence: [
            {
              documentId: "a",
              page: 1,
              quote:
                "Travel to specified areas excluded. Read the excluded areas",
              evidenceId: "ev-a",
            },
          ],
        },
      ],
    },
    {
      factName: "material-exclusions",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "a",
          display: "Unassigned sports exclusion",
          qualifiers: {},
          evidence: [
            {
              documentId: "a",
              page: 1,
              quote: "Unassigned sports exclusion",
              evidenceId: "ev-u",
            },
          ],
        },
      ],
    },
    { factName: "unavailable-empty-topic", verdict: "NOT STATED", values: [] },
  ],
};
describe("approved adaptive components", () => {
  it("renders a readable individual view without empty comparison columns", () => {
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={table}
        view={{
          mode: "understand",
          documentId: "a",
          planIds: ["a"],
          tiers: {},
        }}
        sessionId="test-session"
        userContext={{}}
        contacts={[]}
      />,
    );
    expect(html).toContain("Travel to specified areas excluded");
    expect(html).toContain("Unverified applicability");
    expect(html).toContain("evidence=ev-a");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("unavailable-empty-topic");
    expect(html).not.toContain("b.pdf");
  });
  it("keeps unattributed facts outside selected plan columns and does not equate absence with denial", () => {
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={table}
        view={{ mode: "compare", planIds: ["b", "a"], tiers: {} }}
        sessionId="test-session"
        userContext={{}}
        contacts={[]}
      />,
    );
    const main = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(main).not.toContain("Unassigned sports exclusion");
    expect(main).toContain("Not stated for this plan");
    expect(html).toContain("Unassigned sports exclusion");
    expect(main.indexOf("Policy b")).toBeLessThan(main.indexOf("Policy a"));
  });
  it("renders covered and excluded facts in the single primary comparison table", () => {
    const withCoverage: Table = {
      ...table,
      rows: [
        ...table.rows,
        {
          factName: "emergency-care",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "a",
              display: "Covered",
              qualifiers: {},
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Emergency care covered",
                  evidenceId: "ev-emergency-a",
                },
              ],
            },
            {
              documentId: "b",
              planId: "b",
              display: "Not covered",
              qualifiers: {},
              evidence: [
                {
                  documentId: "b",
                  page: 1,
                  quote: "Emergency care not covered",
                  evidenceId: "ev-emergency-b",
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={withCoverage}
        view={{ mode: "compare", planIds: ["a", "b"], tiers: {} }}
        sessionId="test-session"
        userContext={{}}
        contacts={[]}
      />,
    );

    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).toContain("Emergency care covered");
    expect(html).toContain("Emergency care not covered");
  });
  it("keeps each plan-specific NOT STATED cell but explains absence only once", () => {
    const withTwoMissingDimensions: Table = {
      ...table,
      rows: [
        ...table.rows,
        {
          factName: "emergency-care",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "a",
              display: "Covered",
              qualifiers: {},
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Emergency care covered",
                  evidenceId: "ev-emergency-a",
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={withTwoMissingDimensions}
        view={{ mode: "compare", planIds: ["b", "a"], tiers: {} }}
        sessionId="test-session"
        userContext={{}}
        contacts={[]}
      />,
    );
    const comparison = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";

    expect((comparison.match(/Not stated for this plan\./g) ?? []).length).toBe(2);
    expect(
      (html.match(/Missing information is not a denial of coverage\./g) ?? [])
        .length,
    ).toBe(1);
  });
  it("labels all-tier values as separate tier groups without dropping qualifiers or evidence", () => {
    const tiered: Table = {
      ...table,
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "a",
              display: "$500",
              qualifiers: { planTier: "Basic", networkTier: "in-network" },
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Basic deductible $500 in-network",
                  evidenceId: "ev-a-basic",
                },
              ],
            },
            {
              documentId: "a",
              planId: "a",
              display: "$1,000",
              qualifiers: { planTier: "Plus", networkTier: "in-network" },
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Plus deductible $1,000 in-network",
                  evidenceId: "ev-a-plus",
                },
              ],
            },
            {
              documentId: "b",
              planId: "b",
              display: "$750",
              qualifiers: { planTier: "Standard", networkTier: "in-network" },
              evidence: [
                {
                  documentId: "b",
                  page: 1,
                  quote: "Standard deductible $750 in-network",
                  evidenceId: "ev-b-standard",
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={tiered}
        view={{ mode: "compare", planIds: ["a", "b"], tiers: {} }}
        sessionId="test-session"
        userContext={{}}
        contacts={[]}
      />,
    );
    const comparison = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";

    expect(html).toContain("All tiers shown");
    expect(html).toContain('role="group" aria-label="Basic tier value"');
    expect(html).toContain('role="group" aria-label="Plus tier value"');
    expect(html).toContain("Basic tier");
    expect(html).toContain("Plus tier");
    expect(html).toContain("different tiers are not directly comparable");
    expect(html).toContain("Network: in-network");
    expect(html).toContain("evidence=ev-a-basic");
    expect(html).toContain("evidence=ev-a-plus");
    expect(comparison).not.toContain("Tier: Basic");
    expect(comparison).not.toContain("Tier: Plus");
  });
  it("labels a specific tier in the plan header and excludes other tier values", () => {
    const tiered: Table = {
      ...table,
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "a",
              display: "$500",
              qualifiers: { planTier: "Basic" },
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Basic deductible $500",
                  evidenceId: "ev-a-basic",
                },
              ],
            },
            {
              documentId: "a",
              planId: "a",
              display: "$1,000",
              qualifiers: { planTier: "Plus" },
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Plus deductible $1,000",
                  evidenceId: "ev-a-plus",
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={tiered}
        view={{ mode: "compare", planIds: ["a", "b"], tiers: { a: "Basic" } }}
        sessionId="test-session"
        userContext={{}}
        contacts={[]}
      />,
    );
    const comparison = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";

    expect(html).toContain("Selected tier: Basic");
    expect(html).toContain("$500");
    expect(html).not.toContain("$1,000");
    expect(html).not.toContain("All tiers shown");
    expect(comparison).not.toContain("Tier: Basic");
  });
  it("labels only evidence-backed interpretations as why a finding matters", () => {
    const withInterpretation: Table = {
      ...table,
      rows: [
        {
          factName: "international-coverage",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "a",
              display: "Country-of-residence exclusion",
              qualifiers: {},
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote:
                    "This policy does not cover claims made in the insured person's country of residence.",
                  evidenceId: "ev-residence",
                },
              ],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={withInterpretation}
        view={{ mode: "understand", documentId: "a", planIds: ["a"], tiers: {} }}
        sessionId="test-session"
        userContext={{
          countryOrResidency: "United States",
          location: "Cleveland, 44118",
        }}
        contacts={[]}
      />,
    );

    expect(html).toContain("Why it matters");
    expect(html).toContain("does not determine eligibility");
    expect(html).toContain("evidence=ev-residence");
  });
});
