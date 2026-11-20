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
//   4. rows left empty flip to NOT STATED — unless a statement of the fact
//      was withheld (kept NEEDS VERIFICATION with its source line); every
//      NOT STATED row carries a server-derived absence record (EC-10) saying
//      whether nothing was found in the pages read or candidates were withheld.

import { verifyEvidenceCitation, checkDisplayGrounding } from "@/app/lib/evidence-verification";
import type { CellValue, ComparisonTable, EvidenceCitation } from "@/app/lib/extraction/types";
import { attestPlans, attributePlanScope, resolveRowPlanIds } from "@/app/lib/extraction/plan-identity";
import { isGlossaryDefinitionLine, isTocEntryLine } from "@/app/lib/extraction/noise-shapes";
import { verifyClaimAnchor } from "@/app/lib/extraction/claim-anchors";
import { timeSync } from "@/app/lib/observability/timing";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import type { PageReadability } from "@/app/lib/pdf/page-readability";
import type { AbsenceReason, WithheldClaim } from "@/app/lib/extraction/types";
import { annotateAbsence, WITHHELD_ROW_RATIONALE } from "@/app/lib/extraction/absence";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";

/** Rationale for a plan's own structural same-scope contradiction. */
export const STRUCTURAL_CONFLICT_RATIONALE =
  "The plan's own document states different values for this provision in the same scope; both cited values are shown.";

/** True when two attributed structural claims (table cell / statement) of the
 *  same plan, document, scope and provision state different values. Values
 *  of different plans, or table cells of differently-labelled rows, are
 *  distinct provisions and never conflict (contradictions.ts). */
function structuralConflict(values: readonly CellValue[]): boolean {
  const proven = values.filter((v) => v.anchor !== undefined && typeof v.planId === "string");
  return proven.some((a, i) => proven.some((b, j) => j > i && a.planId === b.planId && hasSameScopeContradiction([a, b])));
}

export interface VerifiableDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
  tables?: LayoutTable[];
  readability?: PageReadability[];
}

/** A withheld record survives only when its quote is literally on its page
 *  of a session document (it is a pointer, never a value). */
function verifiedWithheld(withheld: readonly WithheldClaim[] | undefined, documents: VerifiableDocument[]): WithheldClaim[] {
  return (withheld ?? []).filter((w) => {
    const doc = documents.find((d) => d.documentId === w.documentId);
    const page = doc && Number.isInteger(w.page) ? doc.pages[w.page - 1] : undefined;
    return typeof page === "string" && typeof w.quote === "string" && !!w.quote.trim() && page.includes(w.quote);
  });
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
  const absenceReasons = new Map<string, AbsenceReason>();
  for (const row of scoped.rows) {
    const withheld = verifiedWithheld(row.withheld, documents);
    const withheldField = withheld.length > 0 ? { withheld } : {};
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
        checkDisplayGrounding(value.display, row.factName, evidence.map((e) => e.quote), {
          qualifiers: value.qualifiers as unknown as Record<string, unknown>,
          // The anchor re-derived above: the display is verbatim by construction.
          structural: !!value.anchor,
        })
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
    const { withheld: _untrusted, ...base } = row;
    if (values.length === 0 && withheld.length > 0) {
      rows.push({ factName: row.factName, verdict: "NEEDS VERIFICATION", rationale: WITHHELD_ROW_RATIONALE, values: [], withheld });
    } else if (values.length === 0 && row.values.length === 0 && row.verdict === "NEEDS VERIFICATION") {
      // An unresolved row with no values (e.g. a matching passage that was
      // not unique enough to cite) stays unresolved: it is not an absence.
      rows.push({ ...base, values: [] });
    } else if (values.length === 0) {
      // Candidates proposed but none survived verification are withheld,
      // not "not found" (EC-10).
      if (row.values.length > 0) absenceReasons.set(row.factName, "candidates-withheld");
      rows.push({ factName: row.factName, verdict: "NOT STATED", values: [] });
    } else if (groundingRationales.length > 0) {
      const prior = typeof row.rationale === "string" ? `${row.rationale} ` : "";
      rows.push({
        ...base,
        verdict: "NEEDS VERIFICATION",
        rationale: `${prior}${[...new Set(groundingRationales)].join(" ")}`.trim(),
        values,
        ...withheldField,
      });
    } else {
      // A plan's own structural contradiction is CONFLICTED on the row too:
      // consumers that read only the row verdict must not see SUPPORTED.
      rows.push(base.verdict === "SUPPORTED" && structuralConflict(values)
        ? { ...base, verdict: "CONFLICTED", rationale: STRUCTURAL_CONFLICT_RATIONALE, values, ...withheldField }
        : { ...base, values, ...withheldField });
    }
  }
  const scopedDocs = documents.filter((doc) => table.documents.some((entry) => entry.documentId === doc.documentId));
  return annotateAbsence({ ...table, ...(plans.length ? { plans } : { plans: undefined }), rows }, scopedDocs, absenceReasons);
}
