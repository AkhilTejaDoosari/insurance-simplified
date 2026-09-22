// "Verify before enrolling" derivation. Actionable unresolved items only:
// CORE facts missing per plan, material NEEDS VERIFICATION, and true
// same-scope CONFLICTED results. Cross-plan differences are comparison
// data, never conflicts. No extraction or verdict logic changes here.

import { FACTS } from "@/app/lib/extraction/fact-list";
import { ELIGIBILITY_ROW_LABEL, ELIGIBILITY_ROW_NAME, NON_DISPLAY_FEEDERS } from "@/app/lib/extraction/eligibility";
import { SECTIONS } from "@/app/lib/extraction/sections";
import type {
  RegisteredCellValue,
  RegisteredTableRow,
} from "@/app/lib/extraction/types";

export type VerifyItemKind = "not-stated" | "needs-verification" | "conflicted";

export interface VerifyCitation {
  documentId: string;
  page: number;
  evidenceId: string;
}

export interface VerifyItem {
  factName: string;
  label: string;
  kind: VerifyItemKind;
  /** Human-readable per-plan statement, e.g. "Not stated for Plan A". */
  text: string;
  documentId: string | null;
  planName: string | null;
  citation: VerifyCitation | null;
}

const CORE_FACTS: ReadonlySet<string> = new Set(
  SECTIONS.find((s) => s.title === "Essentials")?.factNames ?? [],
);

export function verifyLabelFor(factName: string): string {
  if (factName === ELIGIBILITY_ROW_NAME) return ELIGIBILITY_ROW_LABEL;
  return FACTS.find((f) => f.name === factName)?.label ?? factName;
}

function firstCitation(
  value: RegisteredCellValue,
): VerifyCitation | null {
  const primary = value.evidence[0];
  if (!primary || typeof primary.evidenceId !== "string") return null;
  return {
    documentId: value.documentId,
    page: primary.page,
    evidenceId: primary.evidenceId,
  };
}

/** Build verify items from the session table; planNameOf maps documents. */
export function buildVerifyItems(
  rows: RegisteredTableRow[],
  documents: { documentId: string }[],
  planNameOf: (documentId: string) => string,
): VerifyItem[] {
  const items: VerifyItem[] = [];
  const hidden = NON_DISPLAY_FEEDERS as readonly string[];
  for (const row of rows) {
    // Evidence feeders never render as own rows; the composite speaks for them.
    if (hidden.includes(row.factName)) continue;
    const label = verifyLabelFor(row.factName);
    const byDoc = new Map<string, RegisteredCellValue[]>();
    for (const v of row.values) {
      const list = byDoc.get(v.documentId) ?? [];
      list.push(v);
      byDoc.set(v.documentId, list);
    }
    if (row.verdict === "NOT STATED") {
      if (!CORE_FACTS.has(row.factName)) continue;
      for (const d of documents) {
        if ((byDoc.get(d.documentId) ?? []).length > 0) continue;
        items.push({
          factName: row.factName,
          label,
          kind: "not-stated",
          text: `${label} — Not stated for ${planNameOf(d.documentId)}`,
          documentId: d.documentId,
          planName: planNameOf(d.documentId),
          citation: null,
        });
      }
      continue;
    }
    if (row.verdict === "NEEDS VERIFICATION") {
      for (const [documentId, values] of byDoc) {
        const citation = firstCitation(values[0]);
        if (!citation) continue;
        items.push({
          factName: row.factName,
          label,
          kind: "needs-verification",
          text: `${label} — Needs verification for ${planNameOf(documentId)}`,
          documentId,
          planName: planNameOf(documentId),
          citation,
        });
      }
      continue;
    }
    if (row.verdict === "CONFLICTED") {
      let covered = false;
      for (const [documentId, values] of byDoc) {
        if (values.length < 2) continue;
        covered = true;
        items.push({
          factName: row.factName,
          label,
          kind: "conflicted",
          text: `${label} — Conflicting evidence within ${planNameOf(documentId)}`,
          documentId,
          planName: planNameOf(documentId),
          citation: firstCitation(values[0]),
        });
      }
      if (!covered) {
        for (const [documentId, values] of byDoc) {
          items.push({
            factName: row.factName,
            label,
            kind: "conflicted",
            text: `${label} — Conflicting evidence within ${planNameOf(documentId)}`,
            documentId,
            planName: planNameOf(documentId),
            citation: firstCitation(values[0]),
          });
        }
      }
    }
  }
  return items;
}
