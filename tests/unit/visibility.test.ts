import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ComparisonTable from "@/app/components/ComparisonTable";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type {
  RegisteredComparisonTable as Table,
  RegisteredTableRow,
} from "@/app/lib/extraction/types";

const ev = (documentId: string, page: number, quote: string) => ({
  documentId,
  page,
  quote,
  evidenceId: evidenceIdFor(documentId, page, quote),
});

const val = (documentId: string, display: string, quote: string, planTier?: string) => ({
  documentId,
  display,
  qualifiers: planTier ? { planTier } : {},
  evidence: [ev(documentId, 1, quote)],
});

const row = (
  factName: string,
  verdict: RegisteredTableRow["verdict"],
  values: ReturnType<typeof val>[] = [],
): RegisteredTableRow => ({ factName, verdict, values }) as RegisteredTableRow;

const DOCS = [
  { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1 },
  { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 1 },
];

function table(rows: RegisteredTableRow[]): Table {
  return { schemaVersion: "v1", factListVersion: "v1", documents: DOCS, rows };
}

function html(t: Table, initialTierSelection?: Record<string, string>): string {
  return renderToStaticMarkup(
    createElement(ComparisonTable, {
      table: t,
      sessionId: "sess-1",
      ...(initialTierSelection ? { initialTierSelection } : {}),
    }),
  );
}

const HIGHLIGHTS = [
  "emergency-evacuation",
  "repatriation",
  "political-evacuation",
  "terrorism-coverage",
  "emergency-reunion",
  "bedside-visit",
  "ad-and-d",
  "incidental-trip",
  "telehealth",
  "physical-therapy",
  "chiropractic",
  "durable-medical-equipment",
  "home-nursing",
  "student-health-center",
];

describe("row visibility classes", () => {
  it("A. CORE all-NOT-STATED row still renders", () => {
    const out = html(table([row("annual-deductible", "NOT STATED")]));
    expect(out).toContain("Annual deductible");
  });

  it("B. COMPARATIVE all-NOT-STATED row is hidden", () => {
    const out = html(table([row("dental-coverage", "NOT STATED")]));
    expect(out).not.toContain("Dental");
  });

  it("C. one supported plan keeps a COMPARATIVE row visible", () => {
    const out = html(
      table([row("dental-coverage", "SUPPORTED", [val("doc-1", "Cleanings covered", "Cleanings covered.")])]),
    );
    expect(out).toContain("Dental");
    expect(out).toContain("Cleanings covered");
  });

  it("D. explicit exclusion keeps the row visible without becoming covered", () => {
    const out = html(
      table([row("dental-coverage", "SUPPORTED", [val("doc-1", "Routine dental excluded", "Routine dental excluded.")])]),
    );
    expect(out).toContain("Dental");
    expect(out).toContain("Routine dental excluded");
    expect(out).not.toContain("Covered");
  });

  it("E. NEEDS VERIFICATION keeps the row visible", () => {
    const out = html(
      table([row("urgent-care", "NEEDS VERIFICATION", [val("doc-1", "Urgent care terms vary", "Urgent care terms vary.")])]),
    );
    expect(out).toContain("Urgent / walk-in care");
  });

  it("F. all-14-NOT-STATED highlights render zero rows plus the empty state", () => {
    const out = html(table(HIGHLIGHTS.map((n) => row(n, "NOT STATED"))));
    expect(out).toContain("Nothing unique to highlight in these documents");
    expect(out).not.toContain("table__fact");
  });

  it("G. exactly 4 supported highlights render exactly 4 rows", () => {
    const supported = ["emergency-evacuation", "repatriation", "terrorism-coverage", "bedside-visit"];
    const rows = HIGHLIGHTS.map((n) =>
      supported.includes(n)
        ? row(n, "SUPPORTED", [val("doc-1", `${n} covered`, `${n} covered.`)])
        : row(n, "NOT STATED"),
    );
    const out = html(table(rows));
    expect(out).toContain("Emergency medical evacuation");
    expect(out).toContain("Repatriation");
    expect(out).toContain("Terrorism coverage");
    expect(out).toContain("Bedside visit");
    expect(out).not.toContain("Nothing unique to highlight");
    expect(out).not.toContain("Political evacuation");
    expect(out).not.toContain("Telehealth");
  });

  it("H. no NOT STATED highlight rows render", () => {
    const rows = HIGHLIGHTS.map((n, i) =>
      i < 2 ? row(n, "SUPPORTED", [val("doc-1", `${n} covered`, `${n} covered.`)]) : row(n, "NOT STATED"),
    );
    const out = html(table(rows));
    expect(out.match(/table__fact/g)?.length ?? 0).toBe(2);
  });

  it("I. evidence only in a hidden tier keeps a COMPARATIVE row hidden", () => {
    // doc-2 carries two tiers table-wide (picker alive via urgent-care),
    // but this row's only value sits in Platinum while Lite is selected.
    const t = table([
      row("urgent-care", "SUPPORTED", [val("doc-2", "$20", "Lite: $20.", "Lite")]),
      row("emergency-care", "SUPPORTED", [val("doc-2", "$0 to $25,000", "Platinum: $0 to $25,000.", "Platinum")]),
    ]);
    const out = html(t, { "doc-2": "Lite" });
    expect(out).not.toContain("Emergency room");
    expect(out).toContain("Urgent / walk-in care");
  });

  it("J. switching to the evidenced tier reveals the row", () => {
    const t = table([
      row("urgent-care", "SUPPORTED", [val("doc-2", "$20", "Lite: $20.", "Lite")]),
      row("emergency-care", "SUPPORTED", [val("doc-2", "$0 to $25,000", "Platinum: $0 to $25,000.", "Platinum")]),
    ]);
    expect(html(t, { "doc-2": "Platinum" })).toContain("Emergency room");
    expect(html(t)).toContain("Emergency room");
  });
});

describe("per-plan verdict states (no global Status column)", () => {
  const docTable = (rows: RegisteredTableRow[], userContext?: Record<string, string>): string =>
    renderToStaticMarkup(
      createElement(ComparisonTable, {
        table: table(rows),
        sessionId: "sess-1",
        ...(userContext ? { userContext, onTableUpdate: () => {} } : {}),
      }),
    );

  it("renders no global Status column", () => {
    const out = docTable([row("annual-deductible", "SUPPORTED", [val("doc-1", "$250", "Deductible $250.")])]);
    expect(out).not.toContain(">Status<");
    expect(out).not.toContain("col-verdict");
  });

  it("mixed eligibility shows per-plan states without contradiction", () => {
    const out = docTable(
      [
        {
          factName: "eligibility-for-you",
          verdict: "DOES NOT APPEAR TO FIT",
          rationale: "User context field 'visaOrStatus' rules this fact out.",
          values: [
            val("doc-1", "F-1 only", "F-1 visa holders only."),
            val("doc-2", "Open enrollment", "Open enrollment, H-1B holders welcome."),
          ],
        } as RegisteredTableRow,
      ],
      { visaOrStatus: "H-1B" },
    );
    expect(out).toContain("DOES NOT APPEAR TO FIT");
    expect(out).toContain("Appears eligible");
  });

  it("SUPPORTED rows render values with no badge", () => {
    const out = docTable([
      row("annual-deductible", "SUPPORTED", [val("doc-1", "$250", "Deductible $250.")]),
    ]);
    expect(out).toContain("$250");
    expect(out).not.toContain("SUPPORTED");
  });

  it("empty cells render concise Not stated", () => {
    const out = docTable([
      row("annual-deductible", "SUPPORTED", [val("doc-1", "$250", "Deductible $250.")]),
    ]);
    expect(out).toContain("Not stated");
  });
});
