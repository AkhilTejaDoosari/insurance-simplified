// Gap-driven insurer questions (spec FR-015).
// Derives plain follow-up questions from NOT STATED / CONFLICTED /
// NEEDS VERIFICATION rows. Advisory text only — never a plan
// recommendation (FR-017).

import type { ComparisonTable, TableRow } from "@/app/lib/extraction/types";

export interface InsurerQuestion {
  questionText: string;
  motivatingFact: string;
  triggeringVerdict: "NOT STATED" | "CONFLICTED" | "NEEDS VERIFICATION";
  documentIds: string[];
}

function questionFor(row: TableRow): string {
  const fact = row.factName.replace(/-/g, " ");
  switch (row.verdict) {
    case "NOT STATED":
      return `Your documents do not mention ${fact} — what does the plan say about it, and where is it written?`;
    case "CONFLICTED":
      return `Your documents disagree on ${fact} — which value applies to you, and can the insurer confirm it in writing?`;
    case "NEEDS VERIFICATION":
      return `The statement about ${fact} is vague or missing details — what are the exact terms, limits, and conditions?`;
    default:
      return "";
  }
}

export function suggestQuestions(table: ComparisonTable): InsurerQuestion[] {
  const out: InsurerQuestion[] = [];
  for (const row of table.rows) {
    if (
      row.verdict !== "NOT STATED" &&
      row.verdict !== "CONFLICTED" &&
      row.verdict !== "NEEDS VERIFICATION"
    ) {
      continue;
    }
    out.push({
      questionText: questionFor(row),
      motivatingFact: row.factName,
      triggeringVerdict: row.verdict,
      documentIds: row.values.map((v) => v.documentId),
    });
  }
  return out;
}
