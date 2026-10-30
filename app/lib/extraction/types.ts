// Comparison table types + validator (contracts/comparison-schema.md v1).
// Used by the extraction path; the RAG path MUST NOT import this module
// (constitution principle II — separate schemas per path).

import { assertVerdict, type Verdict } from "@/app/lib/verdicts";
import type { PresentationGroup } from "@/app/lib/extraction/presentation-groups";
import { MATERIAL_QUALIFIERS, qualifierHasEvidence } from "@/app/lib/extraction/qualifier-evidence";

export interface Qualifiers {
  networkTier?: string;
  period?: string;
  ageBand?: string;
  conditions?: string;
  /** Named plan tier/option when one document describes several (e.g. "Lite",
   *  "Platinum"). A document may then carry one value per tier in a row. */
  planTier?: string;
  /** Inclusive premium age-band bounds from explicit source rate tables. */
  ageMin?: number;
  ageMax?: number;
  /** Parsed premium amount and billing frequency from explicit source text. */
  amount?: number;
  frequency?: string;
  /** Source-attested currency when the document states one other than the
   *  document's implicit `$`. Recorded so a mismatched currency is never
   *  equated with another one. */
  currency?: string;
  /** Source-attested kind of the amount ("annual deductible",
   *  "out-of-pocket maximum"). Retained when one display carries several
   *  amounts, which would otherwise lose each figure's type. */
  costType?: string;
  /** Whether an amount is an option the member may choose, or a choice the
   *  document proves was made. The model never asserts it — extraction derives
   *  it from source text, and `purchased` additionally requires
   *  `purchaseAttested()`. Absent means "no claim". */
  selectionStatus?: SelectionStatus;
}

/** Closed vocabulary for the selectable/purchased distinction. */
export type SelectionStatus = "selectable" | "purchased" | "unknown";

const SELECTION_STATUSES: readonly string[] = ["selectable", "purchased", "unknown"];

/** Source language that proves the member actually made the choice. A
 *  brochure listing options is never enough (spec I: "A selectable deductible
 *  is not a purchased deductible"). */
const PURCHASE_ATTESTATION =
  /\b(?:you(?:'ve| have| had)?\s+(?:selected|chose|chosen|picked|purchased|elected)|your\s+(?:selected|chosen|elected)\s+(?:deductible|option|plan|coverage|benefit))\b/i;

/** True only when a cited passage attests the member's own selection. */
export function purchaseAttested(evidence: readonly EvidenceCitation[], display?: string): boolean {
  const amounts = display?.match(/\$\s?[\d,]+(?:\.\d+)?/g) ?? [];
  if (amounts.length > 1) return false;
  const selectedAmount = amounts[0];
  return evidence.some((e) => PURCHASE_ATTESTATION.test(e.quote) && (
    !selectedAmount || new RegExp(`\\$\\s?${selectedAmount.replace(/\$\s?/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d,.])`).test(e.quote)
  ));
}

export interface EvidenceCitation {
  documentId: string;
  /** 1-based page number. */
  page: number;
  quote: string;
}

/** Presentation-time citation: core evidence plus its session-bound opaque
 *  evidence ID (`ev-...`), assigned at the server/session boundary (never
 *  by extraction) so citation URLs resolve to the exact passage. */
export type RegisteredEvidenceCitation = EvidenceCitation & {
  evidenceId: string;
};

export interface CellValue {
  documentId: string;
  /** Only present when evidence establishes this value belongs to a supported plan. */
  planId?: string;
  /** Full value text with ALL qualifiers verbatim (FR-006). */
  display: string;
  qualifiers: Qualifiers;
  evidence: EvidenceCitation[];
}

export interface TableRow {
  factName: string;
  verdict: Verdict;
  /** Required when verdict is DOES NOT APPEAR TO FIT: names the ruling-out context field. */
  rationale?: string;
  values: CellValue[];
}

export interface ComparisonTable {
  schemaVersion: "v1";
  factListVersion: string;
  documents: { documentId: string; filename: string; pageCount: number }[];
  /** Optional, evidence-attested identity. Absent on legacy or unresolved results. */
  plans?: ProvenPlan[];
  rows: TableRow[];
}

export interface ProvenPlan {
  planId: string;
  name: string;
  /** Required to establish that two separate PDFs describe the same plan. */
  policyIdentifier?: string;
  /** Matching issuer is also required before merging two PDFs. */
  issuer?: string;
  /** Each supporting PDF must cite its own original page. */
  sources: EvidenceCitation[];
}

/** A value's plan relationship must survive citation verification as well as
 *  schema validation. An explicit extraction claim, however, is accepted only
 *  when the cited passage itself is a labelled plan/fact/value line — narrative
 *  mentions or ambiguous paragraphs are not enough (comparison-schema v1
 *  contract). The route's Stage E gate additionally resolves a controlled
 *  document-ownership proof for values without a labelled line: exactly one
 *  verified plan identity for the value's own document, applicability guards,
 *  and a conflict-free peer group (see resolveRowPlanIds in plan-identity.ts). */
export function hasPlanValueProof(
  planName: string,
  factName: string,
  display: string,
  evidence: readonly EvidenceCitation[],
): boolean {
  return evidence.some((e) => {
    const quote = e.quote.trim().toLowerCase();
    return quote === `plan name: ${planName}; ${factName}: ${display}`.toLowerCase() ||
      quote === `policy name: ${planName}; ${factName}: ${display}`.toLowerCase();
  });
}

/** Presentation-time table: every cited passage carries its session-bound
 *  evidence ID. Produced at the server/session boundary by registering a
 *  validated core table — extraction itself never mints IDs. */
export interface RegisteredCellValue extends Omit<CellValue, "evidence"> {
  evidence: RegisteredEvidenceCitation[];
}

export interface RegisteredTableRow extends Omit<TableRow, "values"> {
  values: RegisteredCellValue[];
}

export interface RegisteredComparisonTable extends Omit<ComparisonTable, "rows"> {
  rows: RegisteredTableRow[];
  /** Server-issued digest of the validated result/context for view invalidation. */
  resultFingerprint?: string;
  presentationGroups?: readonly PresentationGroup[];
}

function fail(msg: string): never {
  throw new Error(`Invalid comparison table: ${msg}`);
}

/** Validate an unknown payload against comparison-schema v1. Throws on violation. */
export function validateTable(payload: unknown): ComparisonTable {
  if (typeof payload !== "object" || payload === null) fail("payload not an object");
  const t = payload as Record<string, unknown>;
  if (t.schemaVersion !== "v1") fail("schemaVersion must be 'v1'");
  if (typeof t.factListVersion !== "string" || !t.factListVersion) {
    fail("factListVersion required");
  }
  if (!Array.isArray(t.documents)) fail("documents must be an array");
  if (!Array.isArray(t.rows)) fail("rows must be an array");

  const docIds = new Set<string>();
  for (const d of t.documents as Record<string, unknown>[]) {
    if (typeof d.documentId !== "string") fail("document missing documentId");
    docIds.add(d.documentId);
  }

  const plans = new Map<string, { name: string; sources: Set<string> }>();
  if (t.plans !== undefined) {
    if (!Array.isArray(t.plans)) fail("plans must be an array");
    for (const p of t.plans as Record<string, unknown>[]) {
      if (!p || typeof p !== "object") fail("invalid plan");
      if (typeof p.planId !== "string" || !p.planId.trim()) fail("planId required");
      if (plans.has(p.planId)) fail("duplicate planId");
      if (typeof p.name !== "string" || !p.name.trim()) fail("plan name required");
      if (!Array.isArray(p.sources) || p.sources.length === 0) fail("plan sources required");
      if (p.sources.length > 1 && (typeof p.policyIdentifier !== "string" || !p.policyIdentifier.trim())) fail("cross-document plan requires policy identifier");
      if (p.sources.length > 1 && (typeof p.issuer !== "string" || !p.issuer.trim())) fail("cross-document plan requires issuer");
      const sourceIds = new Set<string>();
      for (const source of p.sources as Record<string, unknown>[]) {
        if (!source || typeof source !== "object" || typeof source.documentId !== "string" || !docIds.has(source.documentId)) fail("plan source references unknown document");
        if (sourceIds.has(source.documentId)) fail("duplicate plan source");
        if (typeof source.page !== "number" || !Number.isInteger(source.page) || source.page < 1 || typeof source.quote !== "string" || !source.quote.trim()) fail("invalid plan source citation");
        if (!source.quote.toLowerCase().includes(p.name.toLowerCase().trim())) fail("plan name not supported by source quote");
        if (p.policyIdentifier && (typeof p.policyIdentifier !== "string" || !source.quote.toLowerCase().includes(p.policyIdentifier.toLowerCase()))) fail("policy identifier not supported by source quote");
        if (p.issuer && (typeof p.issuer !== "string" || !source.quote.toLowerCase().includes(p.issuer.toLowerCase()))) fail("issuer not supported by source quote");
        sourceIds.add(source.documentId);
      }
      plans.set(p.planId, { name: p.name, sources: sourceIds });
    }
  }

  for (const r of t.rows as Record<string, unknown>[]) {
    assertVerdict(r.verdict);
    if (typeof r.factName !== "string" || !r.factName) fail("row missing factName");
    if (!Array.isArray(r.values)) fail(`row ${r.factName}: values must be an array`);
    if (r.verdict === "NOT STATED" && (r.values as unknown[]).length > 0) {
      fail(`row ${r.factName}: NOT STATED rows must have empty values`);
    }
    if (r.verdict === "DOES NOT APPEAR TO FIT" && typeof r.rationale !== "string") {
      fail(`row ${r.factName}: DOES NOT APPEAR TO FIT requires a rationale naming the context field`);
    }
    for (const v of r.values as Record<string, unknown>[]) {
      if (typeof v.documentId !== "string" || !docIds.has(v.documentId)) {
        fail(`row ${r.factName}: value references unknown document`);
      }
      if (v.planId !== undefined && (typeof v.planId !== "string" || !plans.get(v.planId)?.sources.has(v.documentId))) {
        fail(`row ${r.factName}: value references unsupported plan source`);
      }
      if (typeof v.display !== "string" || !v.display.trim()) {
        fail(`row ${r.factName}: value display must be non-empty`);
      }
      const displayIsAbsence = v.display.trim().toLowerCase() === "not stated";
      if (
        (r.verdict === "NOT STATED" || displayIsAbsence) &&
        Array.isArray(v.evidence) &&
        v.evidence.length > 0
      ) {
        fail(
          `row ${r.factName}: absence must not carry evidence — never backfill citations for unstated facts (principle IV)`
        );
      }
      if (typeof v.qualifiers !== "object" || v.qualifiers === null) {
        fail(`row ${r.factName}: value qualifiers must be an object`);
      }
      const planTier = (v.qualifiers as Record<string, unknown>).planTier;
      if (planTier !== undefined && (typeof planTier !== "string" || !planTier.trim())) {
        fail(`row ${r.factName}: qualifiers.planTier must be a non-empty string when present`);
      }
      // M2 condition bindings are additive, optional, and fail closed: a
      // purchase claim without a source passage attesting the member's own
      // choice is rejected rather than displayed (spec I protected rules).
      const q = v.qualifiers as Record<string, unknown>;
      const status = q.selectionStatus;
      if (status !== undefined) {
        if (typeof status !== "string" || !SELECTION_STATUSES.includes(status)) {
          fail(`row ${r.factName}: qualifiers.selectionStatus must be selectable, purchased, or unknown`);
        }
        if (status === "purchased" && !purchaseAttested(v.evidence as EvidenceCitation[], v.display as string)) {
          fail(`row ${r.factName}: a purchased selection requires source passage attesting the choice`);
        }
      }
      for (const key of ["currency", "costType"] as const) {
        const bound = q[key];
        if (bound !== undefined && (typeof bound !== "string" || !bound.trim())) {
          fail(`row ${r.factName}: qualifiers.${key} must be a non-empty string when present`);
        }
      }
      if (!Array.isArray(v.evidence) || v.evidence.length === 0) {
        fail(`row ${r.factName}: every populated value requires >=1 evidence entry (FR-007)`);
      }
      // The verifier subsequently proves these quotes occur on the cited page;
      // do not accept scope claims absent even from the claimed source passage.
      const citedText = (v.evidence as EvidenceCitation[]).map((e) => e.quote).join("\n");
      for (const key of MATERIAL_QUALIFIERS) {
        if (q[key] !== undefined && (typeof q[key] !== "string" ||
          !qualifierHasEvidence(v as unknown as CellValue, key, q[key] as string))) {
          fail(`row ${r.factName}: qualifiers.${key} not supported by evidence`);
        }
      }
      if (typeof q.period === "string" && /\bmonth(?:ly)?\b/i.test(q.period) &&
        !/\bmonth(?:ly)?\b/i.test(citedText)) {
        fail(`row ${r.factName}: qualifiers.period not supported by evidence`);
      }
      if (typeof q.period === "string" && /\b(?:annual(?:ly)?|year(?:ly)?)\b/i.test(q.period) &&
        !/\b(?:annual(?:ly)?|year(?:ly)?)\b/i.test(citedText)) {
        fail(`row ${r.factName}: qualifiers.period not supported by evidence`);
      }
      // M1 accepts only an explicitly labeled plan/fact/value line, not
      // narrative mentions or ambiguous document-wide paragraphs.
      if (typeof v.planId === "string" && !hasPlanValueProof(
        plans.get(v.planId)!.name, r.factName as string, v.display as string,
        v.evidence as EvidenceCitation[],
      )) fail(`row ${r.factName}: value lacks evidence of plan relationship`);
      for (const e of v.evidence as Record<string, unknown>[]) {
        if (e.documentId !== v.documentId) fail(`row ${r.factName}: evidence document mismatch`);
        if (typeof e.page !== "number" || e.page < 1) fail(`row ${r.factName}: evidence page must be >= 1`);
        if (typeof e.quote !== "string" || !e.quote.trim()) {
          fail(`row ${r.factName}: evidence quote must be non-empty`);
        }
      }
    }
  }

  return payload as ComparisonTable;
}
