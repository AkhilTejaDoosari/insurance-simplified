// Server/session verification boundary for an extracted comparison table.
//
// Single implementation used by /api/extract AND by the offline evaluation
// harness, so measured quality is the production behavior (no mirror copy).
// Pure with respect to I/O: it reads only the session documents passed in.
//
// Steps, each fail-closed:
//   0. plan identities survive only when every named source verifies;
//      deterministic mention scope is applied against those plans;
//   1. every cited passage is verified against its page and canonicalized;
//      values left without evidence are dropped; a table-cell value whose
//      anchor does not reproduce exactly from the document layout is dropped;
//      display grounding failures make the row NEEDS VERIFICATION;
//   2. Stage E plan attribution (resolveRowPlanIds);
//   3. unattributed TOC/glossary-shaped values are not displayed;
//   4. rows left empty flip to NOT STATED.

import { verifyEvidenceCitation, checkDisplayGrounding } from "@/app/lib/evidence-verification";
import type { CellValue, ComparisonTable, EvidenceCitation } from "@/app/lib/extraction/types";
import { attestPlans, attributePlanScope, resolveRowPlanIds } from "@/app/lib/extraction/plan-identity";
import { isGlossaryDefinitionLine, isTocEntryLine } from "@/app/lib/extraction/noise-shapes";
import { verifyClaimAnchor } from "@/app/lib/extraction/claim-anchors";
import { timeSync } from "@/app/lib/observability/timing";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";

export interface VerifiableDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
  tables?: LayoutTable[];
}

export function verifyComparisonTable(table: ComparisonTable, documents: VerifiableDocument[]): ComparisonTable {
  // Plan identity is optional and never inferred from filenames. A claimed
  // association survives only when every named source verifies on its page.
  const proposedPlans = table.plans ?? attestPlans(documents.filter((doc) =>
    table.documents.some((entry) => entry.documentId === doc.documentId)
  ));
  const plans = proposedPlans.flatMap((plan) => {
    const verifiedSources = plan.sources.map((source) => {
      const result = verifyEvidenceCitation(documents, source);
      return result.ok ? { ...source, quote: result.quote } : null;
    });
    return verifiedSources.every((source) => source !== null)
      ? [{ ...plan, sources: verifiedSources as NonNullable<typeof verifiedSources[number]>[] }]
      : [];
  });
  const scoped = plans.length > 0 ? attributePlanScope({ ...table, plans }, documents) : table;

  const rows: ComparisonTable["rows"] = [];
  for (const row of scoped.rows) {
    // Step 1 — citations and structure.
    const verifiedValues: { value: CellValue; evidence: EvidenceCitation[]; groundingRationale?: string }[] = [];
    for (const value of row.values) {
      const evidence: EvidenceCitation[] = [];
      for (const entry of value.evidence) {
        const verified = timeSync("extract.verifyEvidenceCitation", () => verifyEvidenceCitation(documents, entry));
        if (verified.ok) evidence.push({ ...entry, quote: verified.quote });
      }
      if (evidence.length === 0) continue;
      const candidate = { ...value, evidence };
      if (value.anchor && !verifyClaimAnchor(row.factName, candidate, documents)) continue;
      const grounding = timeSync("extract.checkDisplayGrounding", () =>
        checkDisplayGrounding(value.display, row.factName, evidence.map((e) => e.quote))
      );
      verifiedValues.push({
        value: candidate,
        evidence,
        ...(!grounding.supported && grounding.rationale ? { groundingRationale: grounding.rationale } : {}),
      });
    }
    // Step 2 — Stage E plan attribution (see resolveRowPlanIds).
    const planIds = timeSync("extract.resolveRowPlanIds", () =>
      resolveRowPlanIds(row.factName, verifiedValues.map((entry) => entry.value), plans, documents)
    );
    // Step 3 — attribution is final; unattributed TOC/glossary-shaped values
    // are dropped from display. Attributed values are never dropped here.
    const kept = verifiedValues.flatMap((entry, index) => {
      const planId = planIds[index];
      if (!planId && entry.evidence.every((e) => isTocEntryLine(e.quote) || isGlossaryDefinitionLine(e.quote))) {
        return [];
      }
      return [{ entry, planId }];
    });
    const groundingRationales = kept.flatMap(({ entry }) => (entry.groundingRationale ? [entry.groundingRationale] : []));
    const values = kept.map(({ entry, planId }) => {
      const { planId: _claimedPlanId, ...unscoped } = entry.value;
      return { ...unscoped, ...(planId ? { planId } : {}), evidence: entry.evidence };
    });
    // Step 4 — verdicts.
    if (values.length === 0) {
      rows.push({ factName: row.factName, verdict: "NOT STATED", values: [] });
    } else if (groundingRationales.length > 0) {
      const prior = typeof row.rationale === "string" ? `${row.rationale} ` : "";
      rows.push({
        ...row,
        verdict: "NEEDS VERIFICATION",
        rationale: `${prior}${[...new Set(groundingRationales)].join(" ")}`.trim(),
        values,
      });
    } else {
      rows.push({ ...row, values });
    }
  }
  return { ...table, ...(plans.length ? { plans } : { plans: undefined }), rows };
}
