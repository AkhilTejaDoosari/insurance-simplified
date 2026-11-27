import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ComparisonTable from "@/app/components/ComparisonTable";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

(globalThis as Record<string, unknown>).React ??= React;

const cited = (display: string, quote: string, planTier?: string) => ({
  documentId: "doc-1",
  display,
  qualifiers: planTier ? { planTier } : {},
  evidence: [{ documentId: "doc-1", page: 2, quote, evidenceId: evidenceIdFor("doc-1", 2, quote) }],
});

const table: RegisteredComparisonTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "brochure.pdf", pageCount: 4 }],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        cited("$250", "Lite deductible: $250", "Lite"),
        cited("$500", "Plus deductible: $500", "Plus"),
      ],
    },
    { factName: "premium", verdict: "NOT STATED", values: [] },
  ],
};

describe("single-document results", () => {
  it("introduces the one-PDF experience as document understanding", () => {
    const html = renderToStaticMarkup(createElement(ComparisonTable, { table, sessionId: "sess-test" }));
    expect(html).toContain("Understand your document");
    expect(html).not.toContain("Your plans, side by side");
  });

  it("keeps separately cited tier values and an explicit missing cost", () => {
    const html = renderToStaticMarkup(createElement(ComparisonTable, { table, sessionId: "sess-test" }));
    expect(html).toContain('value="Lite"');
    expect(html).toContain('value="Plus"');
    expect(html).toContain("$250");
    expect(html).toContain("$500");
    expect(html).toContain("Not stated");
    expect(html).toContain(`evidence=${evidenceIdFor("doc-1", 2, "Lite deductible: $250")}`);
    expect(html).toContain(`evidence=${evidenceIdFor("doc-1", 2, "Plus deductible: $500")}`);
  });

  it("shows the source wording when multiple values share one citation", () => {
    const quote = "Annual deductible: $250 in-network / $500 out-of-network.";
    const scopedTable: RegisteredComparisonTable = {
      ...table,
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [cited("$250", quote), cited("$500", quote)],
      }],
    };
    const html = renderToStaticMarkup(createElement(ComparisonTable, {
      table: scopedTable,
      sessionId: "sess-test",
    }));
    expect(html).toContain("$250");
    expect(html).toContain("$500");
    expect(html).toContain("$250 in-network / $500 out-of-network.");
    expect(html).toMatch(/<a[^>]+>\$250 in-network<\/a>/);
    expect(html).toMatch(/<a[^>]+>\$500 out-of-network<\/a>/);
  });

  it("keeps each distinct source condition visible when values have separate citations", () => {
    const scopedTable: RegisteredComparisonTable = {
      ...table,
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          cited("$250", "Annual deductible: $250 in-network"),
          cited("$500", "Annual deductible: $500 out-of-network"),
        ],
      }],
    };
    const html = renderToStaticMarkup(createElement(ComparisonTable, {
      table: scopedTable,
      sessionId: "sess-test",
    }));
    expect(html).toContain("$250 in-network");
    expect(html).toContain("$500 out-of-network");
    expect(html).toMatch(/<a[^>]+>\$250 in-network<\/a>/);
    expect(html).toMatch(/<a[^>]+>\$500 out-of-network<\/a>/);
  });

  it("does not expand non-price values into lengthy source passages", () => {
    const scopedTable: RegisteredComparisonTable = {
      ...table,
      rows: [{
        factName: "network",
        verdict: "SUPPORTED",
        values: [
          cited("U.S. Network", "U.S. Network Access allows direct care from listed providers."),
          cited("International Network", "International Network access includes overseas providers."),
        ],
      }],
    };
    const html = renderToStaticMarkup(createElement(ComparisonTable, {
      table: scopedTable,
      sessionId: "sess-test",
    }));
    expect(html).not.toContain("Source wording:");
    expect(html).not.toContain("source wording:");
  });
});
