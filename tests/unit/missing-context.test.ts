import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ComparisonTable from "@/app/components/ComparisonTable";
import { toCanonicalContext } from "@/app/components/ContextInputs";
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
      factName: "student-eligibility",
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
      factName: "coverage-dates",
      verdict: "NOT STATED",
      values: [],
    },
  ],
};

const INTAKE = {
  age: "25",
  countryOrResidency: "United States",
  visaOrStatus: "F-1 STEM OPT",
  city: "Delray Beach",
  zip: "33484",
  coverageStart: "2026-09-21",
  coverageEnd: "2026-09-25",
};

function html(userContext: Record<string, string>): string {
  return renderToStaticMarkup(
    createElement(ComparisonTable, {
      table: TABLE,
      sessionId: "sess-1",
      userContext,
      onContextUpdate: () => {},
      onTableUpdate: () => {},
    }),
  );
}

describe("missing-context prompts follow canonical session context", () => {
  it("canonicalizes split intake inputs to the persisted session shape", () => {
    expect(toCanonicalContext(INTAKE)).toEqual({
      age: "25",
      countryOrResidency: "United States",
      visaOrStatus: "F-1 STEM OPT",
      location: "Delray Beach, 33484",
      coverageDates: "2026-09-21 to 2026-09-25",
    });
  });

  it("does not re-ask for supplied visa/status or coverage dates", () => {
    const out = html(toCanonicalContext(INTAKE));
    expect(out).not.toContain("NEEDS YOUR INPUT");
  });

  it("still prompts when visa/status is genuinely missing", () => {
    const out = html(toCanonicalContext({ ...INTAKE, visaOrStatus: "Not applicable" }));
    expect(out).toContain("NEEDS YOUR INPUT");
  });

  it("still prompts when coverage dates are genuinely missing", () => {
    const { coverageStart: _s, coverageEnd: _e, ...noDates } = INTAKE;
    const out = html(toCanonicalContext(noDates));
    expect(out).toContain("NEEDS YOUR INPUT");
  });

  it("never pairs a duplicate prompt with a supplied field on a decided row", () => {
    const out = html(toCanonicalContext(INTAKE));
    expect(out).toContain("SUPPORTED");
    expect(out).not.toContain("NEEDS YOUR INPUT");
  });
});
