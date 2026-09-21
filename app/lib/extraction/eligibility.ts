// Personalized "Eligibility for you" composite row (Essentials #1).
// Replaces the separate visible Eligibility / Student-visa / Coverage-dates
// rows: those facts remain in the extraction contract as evidence feeders,
// but only this composite renders. User context (age, residency, visa,
// location, coverage dates) parameterizes the evaluation and is never a
// display row. Verdicts reuse the closed five-state vocabulary.

import type {
  CellValue,
  ComparisonTable,
  TableRow,
} from "@/app/lib/extraction/types";
import type { Verdict } from "@/app/lib/verdicts";

export const ELIGIBILITY_ROW_NAME = "eligibility-for-you";

export const ELIGIBILITY_ROW_LABEL = "Eligibility for you";

/** Feeder facts: extracted for evidence, never rendered as own rows. */
export const ELIGIBILITY_FEEDERS: readonly string[] = [
  "eligibility",
  "student-eligibility",
  "coverage-dates",
  "age-limits",
];

/** Feeders with no canonical display section of their own. age-limits keeps
 *  its Rules & Restrictions row and additionally feeds the composite. */
export const NON_DISPLAY_FEEDERS: readonly string[] = [
  "eligibility",
  "student-eligibility",
  "coverage-dates",
];

/** Intake fields that can complete an otherwise unevaluatable composite. */
export const ELIGIBILITY_INPUT_FIELDS: readonly string[] = [
  "visaOrStatus",
  "coverageDates",
  "age",
];

const SEVERITY: Record<Verdict, number> = {
  "DOES NOT APPEAR TO FIT": 4,
  CONFLICTED: 3,
  "NEEDS VERIFICATION": 2,
  SUPPORTED: 1,
  "NOT STATED": 0,
};

/** Build the composite from feeder rows; feeders stay in the table for
 *  evidence/contract stability and are hidden at the display layer. */
export function buildEligibilityRow(
  rows: TableRow[],
  userContext: Record<string, string>
): TableRow {
  void userContext;
  const feeders = rows.filter((r) => (ELIGIBILITY_FEEDERS as readonly string[]).includes(r.factName));
  const cited = feeders.filter((r) => r.verdict !== "NOT STATED" && r.values.length > 0);
  if (cited.length === 0) {
    return { factName: ELIGIBILITY_ROW_NAME, verdict: "NOT STATED", values: [] };
  }
  let winning = cited[0];
  for (const r of cited) {
    if (SEVERITY[r.verdict] > SEVERITY[winning.verdict]) winning = r;
  }
  const values: CellValue[] = cited.flatMap((r) =>
    r.values.map((v) => ({
      documentId: v.documentId,
      display: v.display,
      qualifiers: { ...v.qualifiers },
      evidence: v.evidence.map((e) => ({ ...e })),
    }))
  );
  const row: TableRow = {
    factName: ELIGIBILITY_ROW_NAME,
    verdict: winning.verdict,
    values,
  };
  if (winning.verdict === "DOES NOT APPEAR TO FIT" && typeof winning.rationale === "string") {
    row.rationale = winning.rationale;
  }
  return row;
}

/** Append the composite to a validated-shape table (feeders retained). */
export function withEligibilityRow<T extends ComparisonTable>(
  table: T,
  userContext: Record<string, string>
): T {
  const composite = buildEligibilityRow(table.rows, userContext);
  return {
    ...table,
    rows: [...table.rows.filter((r) => r.factName !== ELIGIBILITY_ROW_NAME), composite],
  };
}

/** First still-missing intake field when the composite genuinely cannot
 *  complete (NOT STATED); null when evaluation finished or nothing missing. */
export function eligibilityMissingField(
  composite: TableRow,
  userContext: Record<string, string>
): string | null {
  if (composite.verdict !== "NOT STATED") return null;
  for (const field of ELIGIBILITY_INPUT_FIELDS) {
    if (!(userContext[field] ?? "").trim()) return field;
  }
  return null;
}
