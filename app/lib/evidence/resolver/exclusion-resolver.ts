// C2 Exclusion applicability resolver (evidence-core.md §4; TB-2, TB-4).
//
// For a service question against ONE registered document (plan), the
// resolver:
//   1. derives the document's exclusion inventory from the request's
//      ProvisionStore and page-coverage record (never from the caller), and
//      assesses EVERY exclusion in it — retrieved or not;
//   2. classifies each exclusion with the versioned materiality map
//      (adapter data). Carve-outs and express overrides count only when
//      stated verbatim in the sealed provision. Any unclassified,
//      circumstantial, unmapped, overlapping, scoped or caller-supplied case
//      is `unresolved_material`;
//   3. folds the assessments into ONE `OutcomeStatus` (verdict-mapping.ts is
//      the only place it becomes a display verdict) and issues it with
//      `issueResolution` under the request's EvidenceAuthority.
//
// A caller-built assessment ("proposal") is never authority: it can only
// make an assessment more conservative, never less. A missing or unproven
// exclusion never yields an exclusion outcome; an absent benefit is
// `not_found_in_read_pages` (NOT STATED) only when every page was read.

import type { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { buildExclusionInventory, type ExclusionCoverageState } from "@/app/lib/evidence/exclusions/inventory";
import { CANNOT_BE_CONFIRMED, checkIssued, issueResolution, type Issued } from "@/app/lib/evidence/issued";
import { provisionSealIntact, type SealedProvision } from "@/app/lib/evidence/provision";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { HEALTH_MATERIALITY_MAP_V1 } from "@/app/lib/evidence/resolver/health-materiality";
import {
  checkMaterialityMap,
  conceptHits,
  containsAny,
  firstHit,
  type MaterialityMap,
} from "@/app/lib/evidence/resolver/materiality";
import {
  APPLICABILITY_STATUSES,
  displayVerdictFor,
  type ApplicabilityStatus,
  type OutcomeStatus,
} from "@/app/lib/evidence/verdict-mapping";
import type { Verdict } from "@/app/lib/verdicts";

export const EXCLUSION_RESOLVER_ISSUER = "exclusion-resolver@1";

export type AssessmentBasis =
  | "names_service"
  | "names_other_concepts"
  | "express_override"
  | "carve_out"
  | "circumstantial"
  | "overlapping"
  | "unclassified"
  | "unmapped_service"
  | "scoped"
  | "caller_supplied";

export interface ExclusionAssessment {
  provisionId: string;
  status: ApplicabilityStatus;
  basis: AssessmentBasis;
}

export interface ExclusionResolution {
  kind: "exclusion-applicability";
  sessionId: string;
  documentId: string;
  documentSha256?: string;
  planId?: string;
  service: string;
  materialityMap: string;
  outcome: OutcomeStatus;
  /** Machine reason for the outcome (no display wording). */
  reason: string;
  inventory: { provisionIds: string[]; coverage: ExclusionCoverageState };
  assessments: ExclusionAssessment[];
  /** Benefit provisions of this document that name the service. */
  benefitProvisionIds: string[];
  /** Provisions the outcome rests on (cite these, verbatim, when rendering). */
  citedProvisionIds: string[];
}

/** A service question. `proposals` are non-authoritative hints (e.g. from a
 *  model or a client); every other field a caller might add is ignored. */
export interface ServiceQuestion {
  documentId: string;
  service: string;
  proposals?: unknown;
}

export interface ResolverContext {
  store: ProvisionStore;
  /** The SAME per-request authority the store seals with. */
  authority: EvidenceAuthority;
  map?: MaterialityMap;
}

const BENEFIT_KINDS = new Set(["benefit", "cost_share", "limit"]);

/** Most favourable → most conservative for a coverage conclusion. */
const CAUTION: Record<ApplicabilityStatus, number> = {
  unrelated: 0,
  not_applicable_verified: 1,
  not_applicable_conditional: 2,
  unresolved_material: 3,
  applies_verified: 4,
};

function moreCautious(a: ApplicabilityStatus, b: ApplicabilityStatus): ApplicabilityStatus {
  return CAUTION[a] >= CAUTION[b] ? a : b;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.;:!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function hasScope(p: SealedProvision): boolean {
  const s = p.scope ?? {};
  return !!(s.planTier || s.networkTier || (Array.isArray(s.conditions) && s.conditions.length > 0));
}

/** Classify ONE sealed exclusion against the service, from its own verbatim
 *  sealed text only. Exported for unit tests of individual rules. */
export function classifyExclusion(
  map: MaterialityMap,
  service: string,
  exclusion: SealedProvision,
): { status: ApplicabilityStatus; basis: AssessmentBasis } {
  if (!map.concepts.some((c) => c.id === service)) return { status: "unresolved_material", basis: "unmapped_service" };

  const serviceHits = (text: string) => conceptHits(map, text).filter((h) => h.conceptId === service);
  const named = (text: string) => serviceHits(text).some((h) => !h.shadowed);
  const shadowedOnly = (text: string) => {
    const hits = serviceHits(text);
    return hits.length > 0 && hits.every((h) => h.shadowed);
  };

  // Express override: a sentence of the sealed provision (claim or verbatim
  // evidence) that lifts the exclusion for the service, named after the marker.
  const sealedText = [exclusion.claim, ...exclusion.evidence.map((e) => e.quote)];
  const overrides = sealedText.flatMap(sentences).filter((s) => {
    const m = firstHit(s, map.expressOverrideMarkers);
    return m !== undefined && named(s.slice(m.end));
  });
  const claimSentences = sentences(exclusion.claim).filter((s) => !containsAny(s, map.expressOverrideMarkers));

  let namesService = false;
  let carveOutNamesService = false;
  let overlap = false;
  let carveOut = false;
  let circumstantial = false;
  let classified = false;
  for (const s of claimSentences) {
    const marker = firstHit(s, map.carveOutMarkers);
    const head = marker ? s.slice(0, marker.start) : s;
    const tail = marker ? s.slice(marker.start) : "";
    if (marker) carveOut = true;
    if (named(head)) namesService = true;
    else if (shadowedOnly(head)) overlap = true;
    if (tail && named(tail)) carveOutNamesService = true;
    if (containsAny(s, map.circumstantialMarkers)) circumstantial = true;
    if (conceptHits(map, s).some((h) => !h.shadowed)) classified = true;
  }

  if (overrides.length > 0) {
    const conditional = overrides.some((s) => containsAny(s, map.circumstantialMarkers));
    if (namesService && !conditional) return { status: "unresolved_material", basis: "overlapping" };
    return { status: conditional ? "not_applicable_conditional" : "not_applicable_verified", basis: "express_override" };
  }
  if (carveOutNamesService) {
    return namesService
      ? { status: "unresolved_material", basis: "overlapping" }
      : { status: "not_applicable_conditional", basis: "carve_out" };
  }
  if (namesService) {
    if (hasScope(exclusion)) return { status: "unresolved_material", basis: "scoped" };
    if (carveOut || circumstantial) return { status: "unresolved_material", basis: "circumstantial" };
    return { status: "applies_verified", basis: "names_service" };
  }
  if (overlap) return { status: "unresolved_material", basis: "overlapping" };
  if (!classified) return { status: "unresolved_material", basis: "unclassified" };
  return { status: "unrelated", basis: "names_other_concepts" };
}

/** Caller proposals: `{ provisionId, status }`. Never authority — a proposal
 *  that differs from the derived status can only raise it to
 *  `unresolved_material` (or leave a more cautious status unchanged); a
 *  proposal that names no inventory exclusion, or is malformed, makes the
 *  question unresolved. */
function proposalsByProvision(proposals: unknown, ids: ReadonlySet<string>): { byId: Map<string, unknown>; stray: boolean } {
  const byId = new Map<string, unknown>();
  if (proposals === undefined) return { byId, stray: false };
  if (!Array.isArray(proposals)) return { byId, stray: true };
  let stray = false;
  for (const p of proposals) {
    const id = p && typeof p === "object" ? (p as { provisionId?: unknown }).provisionId : undefined;
    const status = p && typeof p === "object" ? (p as { status?: unknown }).status : undefined;
    if (typeof id !== "string" || !ids.has(id) || !(APPLICABILITY_STATUSES as readonly unknown[]).includes(status)) {
      stray = true;
      continue;
    }
    byId.set(id, status);
  }
  return { byId, stray };
}

function benefitIsConditional(map: MaterialityMap, p: SealedProvision): boolean {
  return hasScope(p) || containsAny(p.claim, map.circumstantialMarkers) || containsAny(p.claim, map.carveOutMarkers);
}

/** Resolve a service question and issue the result. Always returns an
 *  issued resolution; anything that cannot be established is issued as
 *  `undetermined` or `cannot_be_confirmed`, never as an exclusion or a
 *  negative. */
export function resolveServiceQuestion(ctx: ResolverContext, question: ServiceQuestion): Issued<ExclusionResolution> {
  const { store, authority } = ctx;
  const map = ctx.map ?? HEALTH_MATERIALITY_MAP_V1;
  const mapCheck = checkMaterialityMap(map);
  if (!mapCheck.ok) throw new Error(`exclusion resolver: materiality map ${mapCheck.reason}`);

  // Only these two fields (and non-authoritative proposals) are read.
  const documentId = typeof question?.documentId === "string" ? question.documentId : "";
  const service = typeof question?.service === "string" ? question.service : "";
  const issue = (r: ExclusionResolution) =>
    issueResolution(authority, r, { sessionId: store.sessionId, issuer: EXCLUSION_RESOLVER_ISSUER });
  const base = { kind: "exclusion-applicability" as const, sessionId: store.sessionId, documentId, service, materialityMap: map.version };

  // EC-13 source binding: the inventory is derived here from the store and
  // the registry's coverage record — never taken from the question.
  const built = buildExclusionInventory(store, documentId);
  if (!built.ok) {
    return issue({
      ...base, outcome: "cannot_be_confirmed", reason: "document not registered",
      inventory: { provisionIds: [], coverage: "unknown" }, assessments: [], benefitProvisionIds: [], citedProvisionIds: [],
    });
  }
  const inventory = built.inventory;
  for (const p of inventory.exclusions) {
    if (!provisionSealIntact(authority, p)) throw new Error("exclusion resolver: authority is not the provision store's authority");
  }

  // Every exclusion in the inventory, retrieved or not.
  const ids = new Set(inventory.exclusions.map((p) => p.provisionId));
  const { byId: proposed, stray } = proposalsByProvision(question?.proposals, ids);
  const assessments: ExclusionAssessment[] = inventory.exclusions.map((p) => {
    const derived = classifyExclusion(map, service, p);
    const proposal = proposed.get(p.provisionId);
    if (proposal !== undefined && proposal !== derived.status) {
      const status = moreCautious(derived.status, "unresolved_material");
      return { provisionId: p.provisionId, status, basis: status === derived.status ? derived.basis : "caller_supplied" };
    }
    return { provisionId: p.provisionId, ...derived };
  });

  const benefits = store
    .listByDocument(documentId)
    .filter((p) => BENEFIT_KINDS.has(p.kind) && store.stillAdmissible(p))
    .filter((p) => conceptHits(map, p.claim).some((h) => h.conceptId === service && !h.shadowed));
  const benefitProvisionIds = benefits.map((p) => p.provisionId).sort();

  const applying = assessments.filter((a) => a.status === "applies_verified").map((a) => a.provisionId);
  const unresolved = assessments.filter((a) => a.status === "unresolved_material").map((a) => a.provisionId);
  const conditional = assessments.filter((a) => a.status === "not_applicable_conditional").map((a) => a.provisionId);

  let outcome: OutcomeStatus;
  let reason: string;
  let cited: string[];
  if (inventory.integrity !== "intact") {
    [outcome, reason, cited] = ["cannot_be_confirmed", "inventory integrity failed", []];
  } else if (applying.length > 0) {
    [outcome, reason, cited] = ["exclusion_applies", "verified exclusion names the service", applying];
  } else if (unresolved.length > 0) {
    [outcome, reason, cited] = ["undetermined", "exclusion applicability unresolved", unresolved];
  } else if (stray) {
    [outcome, reason, cited] = ["undetermined", "caller-supplied assessment not in inventory", []];
  } else if (inventory.coverage.state !== "complete") {
    // An unread page may hold an exclusion: never conclude past it.
    [outcome, reason, cited] = ["undetermined", `exclusion coverage ${inventory.coverage.state}`, []];
  } else if (benefits.length === 0) {
    [outcome, reason, cited] = ["not_found_in_read_pages", "benefit naming the service not found in read pages", []];
  } else if (conditional.length > 0 || benefits.every((b) => benefitIsConditional(map, b))) {
    [outcome, reason, cited] = ["conditional", "applies under stated conditions", [...benefitProvisionIds, ...conditional]];
  } else {
    [outcome, reason, cited] = ["verified", "benefit stated; every exclusion assessed as inapplicable", benefitProvisionIds];
  }

  return issue({
    ...base,
    documentSha256: inventory.documentSha256,
    ...(inventory.planId ? { planId: inventory.planId } : {}),
    outcome,
    reason,
    inventory: { provisionIds: [...ids], coverage: inventory.coverage.state },
    assessments,
    benefitProvisionIds,
    citedProvisionIds: cited,
  });
}

/** What a rendering surface shows for a resolution it was handed: re-check
 *  it (`checkIssued`), then map its outcome through the single C-1 table. */
export function displayIssuedResolution(
  authority: EvidenceAuthority,
  sessionId: string,
  candidate: unknown,
): { verdict: Verdict; confirmed: true; resolution: ExclusionResolution } | { verdict: Verdict; confirmed: false; label: typeof CANNOT_BE_CONFIRMED } {
  const check = checkIssued<ExclusionResolution>(authority, sessionId, candidate);
  if (check.status !== "confirmed" || check.meta.issuer !== EXCLUSION_RESOLVER_ISSUER) {
    return { verdict: displayVerdictFor("cannot_be_confirmed"), confirmed: false, label: CANNOT_BE_CONFIRMED };
  }
  return { verdict: displayVerdictFor(check.resolution.outcome), confirmed: true, resolution: check.resolution };
}
