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

/** Structural evidence: the value is the cell of a header-anchored table.
 *  Verified by recomputation (table-facts.ts verifyTableAnchor) — a value
 *  whose anchor does not reproduce exactly is dropped at the route. */
export interface TableAnchor {
  kind: "table-cell";
  /** 1-based page of the table. */
  page: number;
  /** Index into the document's detected tables. */
  table: number;
  row: number;
  column: number;
  /** The row label verbatim: identifies the provision (two cells of
   *  different rows are different provisions, never rival values). */
  label: string;
}

/** Structural evidence: the value is one whole prose statement parsed by the
 *  closed statement grammar (statement-facts.ts) at this exact page span. */
export interface StatementAnchor {
  kind: "statement";
  page: number;
  start: number;
  end: number;
}

export type ClaimAnchor = TableAnchor | StatementAnchor;

export interface CellValue {
  documentId: string;
  /** Only present when evidence establishes this value belongs to a supported plan. */
  planId?: string;
  /** Full value text with ALL qualifiers verbatim (FR-006). */
  display: string;
  qualifiers: Qualifiers;
  evidence: EvidenceCitation[];
  /** Present only on structural claims (table cell / prose statement). */
  anchor?: ClaimAnchor;
}

/** Why a row has no value (EC-10). A miss is never "not covered":
 *  - `not-found-in-pages-read`: no candidate passage was found in the pages
 *    whose text was read;
 *  - `candidates-withheld`: candidate passages were found but none survived
 *    citation/structure verification, so none is shown. */
export type AbsenceReason = "not-found-in-pages-read" | "candidates-withheld";

export const ABSENCE_REASONS: readonly AbsenceReason[] = ["not-found-in-pages-read", "candidates-withheld"];

/** Per-document reading coverage behind an absence. */
export interface AbsenceCoverage {
  documentId: string;
  /** 1-based pages whose text was read. */
  pagesRead: number[];
  /** Pages with no extractable text (blank or image-only): never searched. */
  pagesNotRead: number[];
  /** Pages read only partly (little text, plus images that may hold more). */
  pagesPartlyRead: number[];
  /** Server-derived document form (Summary of Benefits and Coverage). */
  form?: "sbc" | "sbc-student";
}

/** Server-derived absence for one NOT STATED row (see `TableCoverage`). */
export interface RowAbsence {
  reason: AbsenceReason;
  documents: AbsenceCoverage[];
}

/** Server-derived reading coverage of the whole result (EC-10). Kept beside
 *  the rows (not inside them) so row and document records stay unchanged:
 *  `absences` has exactly one entry per NOT STATED row; `documents` one entry
 *  per document of the table. Never taken from model output. */
export interface TableCoverage {
  documents: AbsenceCoverage[];
  absences: { factName: string; reason: AbsenceReason }[];
}

/** Why a passage that states this fact did not become a claim. */
export type WithheldReason =
  | "label-unrecognized"
  | "header-unverifiable"
  | "row-quote-too-long"
  | "row-quote-unverifiable"
  | "governing-context-unreadable"
  | "governing-note-unverifiable"
  /** A label or heading line naming the fact with no value of its own. */
  | "label-without-value"
  /** A "<Term> means …" definition line: it names, it does not state. */
  | "definition-line"
  /** A footnoted label whose footnote was not found: its basis is unknown. */
  | "footnote-unresolved";

/** A source line the page states for this fact but that the reader withheld
 *  (EC-2/EC-5). Shown so the drop is visible, never as a value. The quote is
 *  the verified verbatim page span. */
export interface WithheldClaim {
  documentId: string;
  page: number;
  quote: string;
  reason: WithheldReason;
}

export interface TableRow {
  factName: string;
  verdict: Verdict;
  /** Required when verdict is DOES NOT APPEAR TO FIT: names the ruling-out context field. */
  rationale?: string;
  values: CellValue[];
  /** Source lines stating this fact that were withheld instead of shown. */
  withheld?: WithheldClaim[];
}

export interface ComparisonTable {
  schemaVersion: "v1";
  factListVersion: string;
  documents: { documentId: string; filename: string; pageCount: number }[];
  /** Pages read / not read per document and why each NOT STATED row has no
   *  value (EC-10). Server-derived; absent on legacy results. */
  coverage?: TableCoverage;
  /** Optional, evidence-attested identity. Absent on legacy or unresolved results. */
  plans?: ProvenPlan[];
  /** Server-derived: one entry per uploaded document saying whether a plan
   *  identity was verified for it and, if not, why (P0-01). Absent on legacy
   *  results; consumers use `planInventoryOf`, which rebuilds it. */
  planInventory?: PlanInventoryEntry[];
  rows: TableRow[];
}

export interface PlanInventoryEntry {
  documentId: string;
  /** Verified plans sourced from this document (empty when unresolved). */
  planIds: string[];
  /** reanalysis-available: restored from a session stored under an earlier
   *  identity rule; the current rule can identify a plan if analysed again. */
  status: "verified-plan" | "no-verified-plan-name" | "plan-source-unverified" | "reanalysis-available";
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

  if (t.coverage !== undefined) {
    const c = t.coverage as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || !Array.isArray(c.documents) || !Array.isArray(c.absences)) fail("invalid coverage");
    for (const a of c.absences as Record<string, unknown>[]) {
      const row = (t.rows as Record<string, unknown>[]).find((r) => r && r.factName === a?.factName);
      if (!a || !ABSENCE_REASONS.includes(a.reason as AbsenceReason) || !row || row.verdict !== "NOT STATED") {
        fail("coverage absence must name a NOT STATED row with a known reason");
      }
    }
    for (const d of c.documents as Record<string, unknown>[]) {
      if (!d || typeof d.documentId !== "string" || !docIds.has(d.documentId)) fail("coverage references unknown document");
    }
  }

  for (const r of t.rows as Record<string, unknown>[]) {
    assertVerdict(r.verdict);
    if (typeof r.factName !== "string" || !r.factName) fail("row missing factName");
    if (!Array.isArray(r.values)) fail(`row ${r.factName}: values must be an array`);
    if (r.verdict === "NOT STATED" && (r.values as unknown[]).length > 0) {
      fail(`row ${r.factName}: NOT STATED rows must have empty values`);
    }
    if (r.withheld !== undefined) {
      if (!Array.isArray(r.withheld)) fail(`row ${r.factName}: withheld must be an array`);
      // A withheld statement of the fact is not an absence (finding #2).
      if (r.verdict === "NOT STATED" && r.withheld.length > 0) {
        fail(`row ${r.factName}: a row with withheld source lines cannot be NOT STATED`);
      }
      for (const w of r.withheld as Record<string, unknown>[]) {
        if (!w || typeof w !== "object" || typeof w.documentId !== "string" || !docIds.has(w.documentId) ||
          !Number.isInteger(w.page) || (w.page as number) < 1 || typeof w.quote !== "string" || !w.quote.trim() ||
          typeof w.reason !== "string") {
          fail(`row ${r.factName}: invalid withheld record`);
        }
      }
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
      const anchor = v.anchor as Record<string, unknown> | undefined;
      if (anchor?.kind === "table-cell" && (typeof anchor.label !== "string" || !anchor.label.trim())) {
        fail(`row ${r.factName}: invalid table anchor`);
      }
      const anchorKeys = anchor?.kind === "table-cell" ? ["page", "table", "row", "column"]
        : anchor?.kind === "statement" ? ["page", "start", "end"] : null;
      if (anchor !== undefined && (typeof anchor !== "object" || anchor === null || !anchorKeys ||
        !anchorKeys.every((k) => Number.isInteger(anchor[k]) && (anchor[k] as number) >= 0))) {
        fail(`row ${r.factName}: invalid table anchor`);
      }
      // A table cell's scope comes from its column heading, a separate cited
      // span, not from the value's own clause. Its qualifiers are checked
      // structurally instead: the route drops any anchored value that does
      // not reproduce exactly from the server-computed layout.
      if (anchor === undefined) for (const key of MATERIAL_QUALIFIERS) {
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
