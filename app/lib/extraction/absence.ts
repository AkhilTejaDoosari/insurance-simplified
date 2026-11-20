// Honest absence (EC-10). A row without a value says WHY ("not found in the
// pages read" vs. "candidates withheld") and names, per document, the pages
// that were read, not read, and only partly read. Server-derived from the
// session documents only: a model or caller never supplies these records.
//
// The display verdict stays NOT STATED (owner decision C-1); this record is
// the data that lets every surface render it as "not found in the pages read"
// rather than "not covered" or "No".

import { readabilityFor, summarizeReadability, type PageReadability } from "@/app/lib/pdf/page-readability";
import type { AbsenceCoverage, AbsenceReason, ComparisonTable, RowAbsence, TableCoverage, TableRow } from "@/app/lib/extraction/types";

export const WITHHELD_ROW_RATIONALE =
  "The document states this in a table line that could not be verified as a complete claim (see the withheld source line); confirm it against the original page.";

export interface CoverageDocument {
  documentId: string;
  pages: readonly string[];
  readability?: readonly PageReadability[];
}

export function documentCoverage(doc: CoverageDocument): AbsenceCoverage {
  return { documentId: doc.documentId, ...summarizeReadability(readabilityFor(doc)) };
}

export function rowAbsence(reason: AbsenceReason, documents: readonly CoverageDocument[]): RowAbsence {
  return { reason, documents: documents.map(documentCoverage) };
}

/** Attach server-derived coverage (`table.coverage`): reading coverage per
 *  document and one absence entry per NOT STATED row. Any coverage the input
 *  carries is replaced (never trusted). `reasons` holds server-set absence
 *  reasons by fact; the default is "not-found-in-pages-read". A NOT STATED
 *  row that carries withheld source lines is not an absence and becomes
 *  NEEDS VERIFICATION. Rows and document entries are otherwise unchanged. */
export function annotateAbsence<T extends ComparisonTable>(
  table: T,
  documents: readonly CoverageDocument[],
  reasons: ReadonlyMap<string, AbsenceReason> = new Map(),
): T {
  const byId = new Map(documents.map((d) => [d.documentId, d]));
  const inTable = table.documents.flatMap((d) => (byId.has(d.documentId) ? [byId.get(d.documentId)!] : []));
  const rows = table.rows.map((row): TableRow =>
    row.verdict === "NOT STATED" && row.withheld && row.withheld.length > 0
      ? { ...row, verdict: "NEEDS VERIFICATION", rationale: WITHHELD_ROW_RATIONALE }
      : row);
  const coverage: TableCoverage = {
    documents: inTable.map(documentCoverage),
    absences: rows.filter((row) => row.verdict === "NOT STATED")
      .map((row) => ({ factName: row.factName, reason: reasons.get(row.factName) ?? "not-found-in-pages-read" })),
  };
  return { ...table, rows, coverage };
}

/** The absence behind a NOT STATED row, for rendering ("not found in the
 *  pages read", naming pages not read). Undefined when the row is not an
 *  absence or the result carries no coverage (legacy). */
export function absenceFor(table: Pick<ComparisonTable, "coverage" | "rows">, factName: string): RowAbsence | undefined {
  const row = table.rows.find((r) => r.factName === factName);
  const entry = table.coverage?.absences.find((a) => a.factName === factName);
  if (!row || row.verdict !== "NOT STATED" || !entry || !table.coverage) return undefined;
  return { reason: entry.reason, documents: table.coverage.documents };
}

/** Remove model-asserted coverage/withheld fields from raw LLM output
 *  before any processing (they are server-derived only). */
export function stripServerOnlyFields(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const { coverage: _c, ...table } = raw as Record<string, unknown>;
  if (Array.isArray(table.rows)) {
    table.rows = table.rows.map((row) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) return row;
      const { withheld: _w, ...rest } = row as Record<string, unknown>;
      return rest;
    });
  }
  return table;
}
