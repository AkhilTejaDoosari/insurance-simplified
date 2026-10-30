import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ComparisonTable from "@/app/components/ComparisonTable";
import PersonalizedOverview from "@/app/components/PersonalizedOverview";
import {
  createSelection,
  selectTier,
  setSelectedPlanIds,
} from "@/app/lib/extraction/selection";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

(globalThis as Record<string, unknown>).React ??= React;

const table: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-a", filename: "synthetic.pdf", pageCount: 2 }],
  plans: [
    {
      planId: "alpha",
      name: "Alpha",
      sources: [{ documentId: "doc-a", page: 1, quote: "Alpha" }],
    },
  ],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-a",
          planId: "alpha",
          display: "$500",
          qualifiers: {},
          evidence: [
            {
              documentId: "doc-a",
              page: 1,
              quote: "Deductible $500",
              evidenceId: "ev-cost",
            },
          ],
        },
        {
          documentId: "doc-a",
          display: "$9,999 unassigned",
          qualifiers: {},
          evidence: [
            {
              documentId: "doc-a",
              page: 2,
              quote: "Unassigned option $9,999",
              evidenceId: "ev-unassigned",
            },
          ],
        },
      ],
    },
    {
      factName: "pre-existing-conditions",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-a",
          planId: "alpha",
          display: "Not covered",
          qualifiers: {},
          evidence: [
            {
              documentId: "doc-a",
              page: 2,
              quote: "Pre-existing conditions not covered",
              evidenceId: "ev-risk",
            },
          ],
        },
      ],
    },
  ],
};

describe("V5 evidence-safe continuous review", () => {
  it("keeps lengthy unassigned evidence discoverable in expandable source details", () => {
    const lengthy: Table = {
      ...table,
      rows: [
        {
          ...table.rows[0],
          values: Array.from({ length: 5 }, (_, i) => ({
            ...table.rows[0].values[1],
            display: `Unassigned source ${i + 1}`,
          })),
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ComparisonTable table={lengthy} sessionId="session" />,
    );
    expect(html).toContain("Show 2 more source passages");
    expect(html).toContain("Unassigned source 5");
    expect(html).toContain("<details");
  });
  it("keeps unassigned evidence out of plan cells without dropping its source", () => {
    const html = renderToStaticMarkup(
      <ComparisonTable table={table} sessionId="session" />,
    );
    const matrix = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(matrix).toContain("$500");
    expect(matrix).not.toContain("$9,999 unassigned");
    expect(html).toContain("$9,999 unassigned");
    expect(html).toContain("Unverified applicability");
    expect(html).toContain("ev-unassigned");
  });

  it("shows cost and restriction rows together, with contacts beneath the matrix", () => {
    const html = renderToStaticMarkup(
      <ComparisonTable table={table} sessionId="session" />,
    );
    const matrix = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(matrix).toContain("$500");
    expect(matrix).toContain("Not covered");
    expect(html.indexOf("Contact information not verified")).toBeGreaterThan(
      html.indexOf("</table>"),
    );
    expect(html).not.toContain('class="comparison__tabs"');
  });

  it("shows at most three sourced findings instead of repeating absent facts", () => {
    const html = renderToStaticMarkup(
      <PersonalizedOverview
        table={table}
        userContext={{}}
        selection={createSelection(table, "fp")}
        sessionId="session"
      />,
    );
    expect(html).toContain("The short version");
    expect((html.match(/class="brief"/g) ?? []).length).toBeLessThanOrEqual(3);
    expect((html.match(/class="brief"/g) ?? []).length).toBeGreaterThan(0);
    expect(html).not.toContain("$9,999");
    expect(html).not.toContain("Not stated in the uploaded brochure");
  });

  it("prioritizes source-backed restrictions in the short version", () => {
    const html = renderToStaticMarkup(
      <PersonalizedOverview
        table={table}
        userContext={{}}
        selection={createSelection(table, "fp")}
        sessionId="session"
      />,
    );
    expect(html).toContain("Not covered");
    expect(html.indexOf("Not covered")).toBeLessThan(html.indexOf("$500"));
  });

  it("never promotes an unknown plan identifier into the document fallback column", () => {
    const unknown = {
      ...table,
      plans: undefined,
      rows: [
        {
          ...table.rows[0],
          values: [
            {
              ...table.rows[0].values[0],
              planId: "doc-a",
              display: "$123 unknown identity",
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ComparisonTable table={unknown} sessionId="session" />,
    );
    expect(html.match(/<table[\s\S]*?<\/table>/)?.[0]).not.toContain(
      "$123 unknown identity",
    );
    expect(html).toContain("$123 unknown identity");
  });

  it("allows an evidenced tier of a selected plan in a multi-plan document", () => {
    const multi: Table = {
      ...table,
      plans: [
        ...table.plans!,
        {
          planId: "beta",
          name: "Beta",
          sources: [{ documentId: "doc-a", page: 1, quote: "Beta" }],
        },
      ],
      rows: [
        {
          ...table.rows[0],
          values: [
            { ...table.rows[0].values[0], qualifiers: { planTier: "Plus" } },
          ],
        },
      ],
    };
    expect(
      selectTier(createSelection(multi, "fp"), multi, "alpha", "Plus").tiers
        .alpha,
    ).toBe("Plus");
  });

  it("caps the document fallback shortlist and can reorder it without inventing plans", () => {
    const legacy: Table = {
      ...table,
      plans: undefined,
      documents: Array.from({ length: 5 }, (_, i) => ({
        documentId: `doc-${i}`,
        filename: `synthetic-${i}.pdf`,
        pageCount: 2,
      })),
    };
    const selection = createSelection(legacy, "fp");
    expect(selection.selectedPlanIds).toEqual(["doc-0", "doc-1", "doc-2"]);
    expect(
      setSelectedPlanIds(selection, legacy, ["doc-2", "doc-0"]).selectedPlanIds,
    ).toEqual(["doc-2", "doc-0"]);
  });
});
