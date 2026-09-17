import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ComparisonTable from "@/app/components/ComparisonTable";
import { documentUrl } from "@/app/lib/document-url";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { RegisteredCellValue, RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

const ev = (documentId: string, page: number, quote: string) => ({
  documentId,
  page,
  quote,
  evidenceId: evidenceIdFor(documentId, page, quote),
});

const v = (
  documentId: string,
  display: string,
  evidence: ReturnType<typeof ev>[] = [],
  planTier?: string,
): RegisteredCellValue => ({
  documentId,
  display,
  qualifiers: planTier ? { planTier } : {},
  evidence,
});

const TABLE: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 },
    { documentId: "doc-2", filename: "brochure.pdf", pageCount: 2 },
  ],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        v("doc-1", "$250", [ev("doc-1", 1, "Annual deductible: $250.")]),
        v("doc-2", "$0 to $2,500", [ev("doc-2", 1, "Lite: $0 to $2,500.")], "Lite"),
        v("doc-2", "$0 to $25,000", [ev("doc-2", 1, "Platinum: $0 to $25,000.")], "Platinum"),
      ],
    },
    {
      factName: "out-of-pocket-maximum",
      verdict: "SUPPORTED",
      values: [
        v("doc-1", "$3,000", [
          ev("doc-1", 1, "Out-of-pocket maximum $3,000."),
          ev("doc-1", 2, "Out-of-pocket maximum restated $3,000."),
        ]),
      ],
    },
    {
      factName: "maternity-coverage",
      verdict: "NOT STATED",
      values: [],
    },
  ],
};

function html(): string {
  return renderToStaticMarkup(createElement(ComparisonTable, { table: TABLE, sessionId: "sess-1" }));
}

function hrefAttr(url: string): string {
  return `href="${url.replace(/&/g, "&amp;")}"`;
}

describe("comparison values link directly to their own source evidence", () => {
  it("renders each value as a citation link with document, page, and evidence ID", () => {
    const expected = documentUrl(
      "sess-1",
      "doc-1",
      "plan-a.pdf",
      1,
      evidenceIdFor("doc-1", 1, "Annual deductible: $250."),
    );
    expect(html()).toContain(hrefAttr(expected));
  });

  it("links each plan value to its OWN evidence, not the row's", () => {
    const out = html();
    const lite = documentUrl("sess-1", "doc-2", "brochure.pdf", 1, evidenceIdFor("doc-2", 1, "Lite: $0 to $2,500."));
    const platinum = documentUrl("sess-1", "doc-2", "brochure.pdf", 1, evidenceIdFor("doc-2", 1, "Platinum: $0 to $25,000."));
    expect(out).toContain(hrefAttr(lite));
    expect(out).toContain(hrefAttr(platinum));
    expect(lite).not.toBe(platinum);
  });

  it("uses the first citation deterministically for multi-evidence values", () => {
    const out = html();
    const primary = documentUrl("sess-1", "doc-1", "plan-a.pdf", 1, evidenceIdFor("doc-1", 1, "Out-of-pocket maximum $3,000."));
    const secondary = documentUrl("sess-1", "doc-1", "plan-a.pdf", 2, evidenceIdFor("doc-1", 2, "Out-of-pocket maximum restated $3,000."));
    expect(out).toContain(hrefAttr(primary));
    expect(out).not.toContain(hrefAttr(secondary));
  });

  it("exposes an accessible source label and real link semantics", () => {
    const out = html();
    expect(out).toContain('aria-label="View source evidence for Annual deductible — plan-a.pdf, page 1"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("<a");
  });

  it("renders no intermediate evidence panel on the comparison page", () => {
    expect(html()).not.toContain('aria-label="Evidence"');
  });
});
