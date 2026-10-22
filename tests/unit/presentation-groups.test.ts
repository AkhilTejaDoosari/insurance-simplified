import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ComparisonTable from "@/app/components/ComparisonTable";
import { organizeRows, proposeGroups, sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import type { RegisteredComparisonTable, TableRow } from "@/app/lib/extraction/types";

(globalThis as Record<string, unknown>).React ??= React;

const value = (documentId: string, quote: string) => ({
  documentId,
  display: quote,
  qualifiers: {},
  evidence: [{ documentId, page: 1, quote, evidenceId: `ev-${documentId}` }],
});

const rows = [
  { factName: "annual-deductible", verdict: "SUPPORTED", values: [value("doc-1", "$250 deductible")] },
  { factName: "emergency-evacuation", verdict: "SUPPORTED", values: [value("doc-2", "Evacuation benefit")] },
  { factName: "premium", verdict: "NOT STATED", values: [] },
] satisfies RegisteredComparisonTable["rows"];

const proposed = {
  groups: [
    { title: "Cost choices", factNames: ["annual-deductible"] },
    { title: "Travel safeguards", factNames: ["emergency-evacuation", "invented-benefit"] },
  ],
};

describe("document-specific presentation groups", () => {
  it("keeps only verified fact IDs while preserving unique and unassigned material rows", () => {
    const groups = sanitizeGroups(proposed, rows);
    expect(groups.map((group) => group.title)).toEqual([
      "Cost choices", "Travel safeguards", "More from your documents",
    ]);
    expect(groups.flatMap((group) => group.factNames)).toEqual([
      "annual-deductible", "emergency-evacuation", "premium",
    ]);
  });

  it("falls back to one neutral group when the proposal cannot be trusted", () => {
    const groups = sanitizeGroups({ groups: [{ title: "Free $9,999 coverage", factNames: ["invented-benefit"] }] }, rows);
    expect(groups).toEqual([{ title: "What your documents say", factNames: [
      "annual-deductible", "emergency-evacuation", "premium",
    ] }]);
  });

  it("renders document-specific tabs and keeps per-value citations in their groups", () => {
    const table: RegisteredComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-1", filename: "first.pdf", pageCount: 1 },
        { documentId: "doc-2", filename: "second.pdf", pageCount: 1 },
      ],
      rows,
      presentationGroups: sanitizeGroups(proposed, rows),
    };
    const html = renderToStaticMarkup(createElement(ComparisonTable, { table, sessionId: "sess-test" }));
    expect(html).toContain("Cost choices");
    expect(html).toContain("Travel safeguards");
    expect(html).toContain('href="/view/sess-test/doc-1/First?page=1&amp;evidence=ev-doc-1"');
    expect(html).not.toContain("Care &amp; Coverage");
  });

  it("preserves each row and its evidence objects without mutation", () => {
    const source: TableRow[] = rows;
    const groups = organizeRows(source, sanitizeGroups(proposed, source));
    expect(groups[0]?.rows[0]).toBe(source[0]);
    expect(groups[1]?.rows[0]).toBe(source[1]);
  });

  it("accepts AI grouping only for observed fact IDs without changing validated values", async () => {
    const response = await proposeGroups(
      { rows, filenames: ["first.pdf", "second.pdf"], userContext: { age: "34" } },
      async () => proposed,
    );
    expect(response.flatMap((group) => group.factNames)).toEqual([
      "annual-deductible", "emergency-evacuation", "premium",
    ]);
    expect(rows[0].values[0].display).toBe("$250 deductible");
  });
});
