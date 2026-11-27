// Issued row resolutions: each comparison row's verdict + values is issued
// under the request's EvidenceAuthority after verification, and every surface
// renders rows only through `renderIssuedRows`. A row that is altered after
// issue, or was never issued, is replaced by a "cannot be confirmed" row that
// shows no value (TB-3, AT-PERSIST).

import type { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { CANNOT_BE_CONFIRMED, checkIssued, issueResolution, type Issued } from "@/app/lib/evidence/issued";
import { displayVerdictFor } from "@/app/lib/evidence/verdict-mapping";
import type { TableRow } from "@/app/lib/extraction/types";

export const ROW_RESOLVER = "comparison-row@1";

export interface RowResolution {
  row: TableRow;
  /** Provisions admitted to the store for this row's values. */
  provisionIds: string[];
}

/** Rationale carried by a row that cannot be confirmed. Starts with the exact
 *  user-facing phrase so every surface can show it verbatim. */
export const CANNOT_BE_CONFIRMED_RATIONALE =
  `${CANNOT_BE_CONFIRMED[0].toUpperCase()}${CANNOT_BE_CONFIRMED.slice(1)}: this result changed after it was verified, so its value is not shown. Re-run the comparison.`;

export function cannotBeConfirmedRow(factName: unknown): TableRow {
  return {
    factName: typeof factName === "string" && factName.trim() ? factName : "unknown",
    verdict: displayVerdictFor("cannot_be_confirmed"),
    rationale: CANNOT_BE_CONFIRMED_RATIONALE,
    values: [],
  };
}

export function isCannotBeConfirmedRow(row: { rationale?: string; values?: unknown[] }): boolean {
  return row.rationale === CANNOT_BE_CONFIRMED_RATIONALE && (row.values?.length ?? 0) === 0;
}

export function issueRows(
  authority: EvidenceAuthority,
  sessionId: string,
  rows: readonly TableRow[],
  provisionIdsByRow: readonly string[][] = [],
): Issued<RowResolution>[] {
  return rows.map((row, i) =>
    issueResolution<RowResolution>(authority, { row, provisionIds: [...(provisionIdsByRow[i] ?? [])] }, { sessionId, issuer: ROW_RESOLVER }),
  );
}

export interface RenderedRows {
  rows: TableRow[];
  /** factNames of rows shown as "cannot be confirmed". */
  cannotBeConfirmed: string[];
}

/** The single render gate for comparison rows. */
export function renderIssuedRows(authority: EvidenceAuthority, sessionId: string, issued: readonly unknown[]): RenderedRows {
  const rows: TableRow[] = [];
  const cannotBeConfirmed: string[] = [];
  for (const candidate of issued) {
    const check = checkIssued<RowResolution>(authority, sessionId, candidate);
    if (check.status === "confirmed" && check.meta.issuer === ROW_RESOLVER && check.resolution?.row) {
      rows.push(check.resolution.row);
      continue;
    }
    const claimed = (candidate as { resolution?: { row?: { factName?: unknown } } } | null)?.resolution?.row?.factName;
    const row = cannotBeConfirmedRow(claimed);
    rows.push(row);
    cannotBeConfirmed.push(row.factName);
  }
  return { rows, cannotBeConfirmed };
}
