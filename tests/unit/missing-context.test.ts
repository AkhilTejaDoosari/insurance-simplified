import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ComparisonTable from "@/app/components/ComparisonTable";
import { toCanonicalContext } from "@/app/components/ContextInputs";
import { ELIGIBILITY_ROW_NAME } from "@/app/lib/extraction/eligibility";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

const ev = (documentId: string, page: number, quote: string) => ({
  documentId,
  page,
  quote,
  evidenceId: evidenceIdFor(documentId, page, quote),
});

const TABLE: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 }],
  rows: [
    {
      factName: ELIGIBILITY_ROW_NAME,
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "Students holding F1/M1 visas are eligible",
          qualifiers: {},
          evidence: [ev("doc-1", 4, "Students holding F1/M1 visas are eligible")],
        },
      ],
    },
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$250",
          qualifiers: {},
          evidence: [ev("doc-1", 1, "Annual deductible: $250.")],
        },
      ],
    },
  ],
};

const unstated = (factName: string): Table => ({
  ...TABLE,
  rows: TABLE.rows.map((r) =>
    r.factName === factName ? { ...r, verdict: "NOT STATED" as const, values: [] } : r,
  ),
});

const INTAKE = {
  age: "25",
  countryOrResidency: "United States",
  visaOrStatus: "F-1 STEM OPT",
  city: "Delray Beach",
  zip: "33484",
  coverageStart: "2026-09-21",
  coverageEnd: "2026-09-25",
};

function html(table: Table, userContext: Record<string, string>): string {
  return renderToStaticMarkup(
    createElement(ComparisonTable, {
      table,
      sessionId: "sess-1",
      userContext,
      onContextUpdate: () => {},
      onTableUpdate: () => {},
    }),
  );
}

describe("missing-context prompts follow canonical session context", () => {
  it("does not re-ask for supplied visa/status or coverage dates", () => {
    const out = html(TABLE, toCanonicalContext(INTAKE));
    expect(out).toContain("Appears eligible");
    expect(out).not.toContain("NEEDS YOUR INPUT");
  });

  it("still prompts when the composite cannot complete for missing input", () => {
    const out = html(
      unstated(ELIGIBILITY_ROW_NAME),
      toCanonicalContext({ ...INTAKE, visaOrStatus: "Not applicable" }),
    );
    expect(out).toContain("NEEDS YOUR INPUT");
  });

  it("never pairs a duplicate prompt with a supplied field on a decided row", () => {
    const out = html(TABLE, toCanonicalContext(INTAKE));
    expect(out).toContain("Appears eligible");
    expect(out).not.toContain("NEEDS YOUR INPUT");
  });

  it("renders no separate student-visa or coverage-dates rows", () => {
    const out = html(TABLE, toCanonicalContext(INTAKE));
    expect(out).not.toContain("Student / visa eligibility");
    expect(out).not.toContain("Coverage dates / term");
  });
});
