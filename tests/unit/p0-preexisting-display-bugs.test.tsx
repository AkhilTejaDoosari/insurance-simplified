// Two pre-existing display bugs the owner asked to fix (2026-11-20).
// 1. The PDF export printed every non-ASCII mark as "?", so a verbatim "•"
//    or "®" read as "?" in exported source wording.
// 2. A table cell whose label notes carry two dollar amounts (a copayment and
//    a "$0 Deductible" condition) was told "Your purchased option is unknown"
//    although the cell is one figure, not a list of options.
// Synthetic text only.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import ConditionalValue from "@/app/components/ConditionalValue";
import { buildReportPdf } from "@/app/lib/report/pdf";
import type { RegisteredCellValue, RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
(globalThis as Record<string, unknown>).React ??= React;

const OPTION_NOTE = "Your purchased option is unknown";

function tableValue(label: string, heading: string, cell: string): RegisteredCellValue {
  return {
    documentId: "a",
    planId: "a",
    display: `${label} (${heading}): ${cell}`,
    qualifiers: {},
    evidence: [
      { documentId: "a", page: 2, quote: `${label} ${cell}`, evidenceId: "ev-1" },
      { documentId: "a", page: 2, quote: heading, evidenceId: "ev-2" },
    ],
    anchor: { kind: "table-cell", page: 2, table: 0, row: 1, column: 1, label },
  };
}

function lineValue(display: string): RegisteredCellValue {
  return { documentId: "a", planId: "a", display, qualifiers: {}, evidence: [{ documentId: "a", page: 2, quote: display, evidenceId: "ev-1" }] };
}

const html = (value: RegisteredCellValue) =>
  renderToStaticMarkup(<ConditionalValue value={value} factLabel="Fact" factName="urgent-care" documentName="a.pdf" sessionId="s" />);

const table = (factName: string, value: RegisteredCellValue): Table => ({
  schemaVersion: "v1",
  factListVersion: "v2",
  documents: [{ documentId: "a", filename: "a.pdf", pageCount: 2 }],
  plans: [{ planId: "a", name: "Policy a", sources: [{ documentId: "a", page: 1, quote: "Policy a" }] }],
  rows: [{ factName, verdict: "SUPPORTED", values: [value] }],
});

describe("purchased-option note (pre-existing bug 2)", () => {
  it("is not shown when the only dollar amounts are in a table cell's label notes", () => {
    const value = tableValue("Walk-in Clinic • Copayment: $40 • Copayment does not apply if the schedule states a $0 Deductible", "In-Network Plan Pays", "90%");
    expect(html(value)).not.toContain(OPTION_NOTE);
  });

  it("is still shown when the table cell itself lists several amounts", () => {
    expect(html(tableValue("Overall Maximum", "Plan Pays", "$50,000 / $100,000 / $250,000"))).toContain(OPTION_NOTE);
  });

  it("is still shown for a source line listing several amounts", () => {
    expect(html(lineValue("Policy maximum options: $50,000 or $100,000"))).toContain(OPTION_NOTE);
  });
});

describe("PDF export glyphs (pre-existing bug 1)", () => {
  it("prints bullet, registered, trademark, accented and dash characters as themselves", async () => {
    const display = "Walk-in Clinic • Northwind Plus® Basic™ café – covered";
    const bytes = await buildReportPdf({
      table: table("urgent-care", lineValue(display)),
      userContext: {},
      selection: { resultFingerprint: "fp", viewMode: "understand", documentId: "a", planIds: ["a"], tiers: {}, legacyTiersByDocument: {} },
    });
    const proxy = await getDocumentProxy(bytes);
    const pdf = String((await extractText(proxy, { mergePages: true })).text).replace(/\s+/g, " ");
    expect(pdf).toContain("Walk-in Clinic • Northwind Plus® Basic™ café");
    expect(pdf).not.toContain("Clinic ? Northwind");
  });
});
