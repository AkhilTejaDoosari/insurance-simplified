// Browser-only view state over validated source facts. Never rewrites the table.
import type { ComparisonTable } from "@/app/lib/extraction/types";
import { documentTiers } from "@/app/lib/extraction/tiers";

export type Section =
  "My Fit" | "My Costs" | "Coverage" | "Limits & Risks" | "Evidence & Actions";

export interface EffectiveSelection {
  resultFingerprint: string;
  contextVersion: number;
  section: Section;
  planByDocument: Record<string, string>;
  /** null means All tiers, not an inferred purchased tier. */
  tiers: Record<string, string | null>;
  /** Transitional V1 document tier view; not evidence of a plan mapping. */
  legacyTiersByDocument: Record<string, string>;
  legacySection?: string;
  /** User-selected shortlist of up to three proven plans to display side by side. */
  selectedPlanIds: string[];
}

const MAX_SELECTED_PLANS = 3;
const ALL_TIERS = "__all__";

function availablePlans(table: ComparisonTable, documentId: string): string[] {
  return (
    table.plans
      ?.filter((p) => p.sources.some((s) => s.documentId === documentId))
      .map((p) => p.planId) ?? []
  );
}

export function planDocuments(
  table: ComparisonTable,
  planId: string,
): string[] {
  const plan = table.plans?.find((p) => p.planId === planId);
  if (!plan) return [];
  return [...new Set(plan.sources.map((s) => s.documentId))];
}

export function planTiers(table: ComparisonTable, planId: string): string[] {
  const tiers: string[] = [];
  const key = (t: string) => t.trim().toLowerCase();
  for (const row of table.rows) {
    for (const v of row.values) {
      if (v.planId !== planId) continue;
      const tier = v.qualifiers.planTier?.trim();
      if (!tier) continue;
      if (!tiers.some((t) => key(t) === key(tier))) tiers.push(tier);
    }
  }
  return tiers;
}

function defaultSelectedPlanIds(table: ComparisonTable): string[] {
  if ((table.plans ?? []).length > 0) {
    return alphabeticalPlanIds(table).slice(0, MAX_SELECTED_PLANS);
  }
  // Legacy tables without proven plans: each document is its own synthetic plan view.
  return table.documents.slice(0, MAX_SELECTED_PLANS).map((d) => d.documentId);
}

/** Default comparison order: proven plans sorted A–Z by their verified
 *  declared name. Legacy tables without proven plans have no verifiable
 *  names, so upload order is kept (see plan-names.ts). */
export function alphabeticalPlanIds(table: ComparisonTable): string[] {
  const plans = table.plans ?? [];
  if (plans.length === 0) return table.documents.map((d) => d.documentId);
  return [...plans]
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((p) => p.planId);
}

/** Swap a selected plan with its left or right neighbour, preserving every
 *  other selection. Users may reorder any selected plan; the shortlist limit
 *  and plan set never change. */
export function moveSelectedPlan(
  prior: EffectiveSelection,
  planId: string,
  direction: "left" | "right",
): EffectiveSelection {
  const order = [...prior.selectedPlanIds];
  const index = order.indexOf(planId);
  if (index === -1) return prior;
  const target = direction === "left" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return prior;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...prior, selectedPlanIds: order };
}

/** Restore the verified alphabetical (or legacy upload) default order for the
 *  currently selected plans, keeping the selected plan set unchanged. */
export function resetPlanOrder(
  prior: EffectiveSelection,
  table: ComparisonTable,
): EffectiveSelection {
  const selected = new Set(
    prior.selectedPlanIds.length > 0
      ? prior.selectedPlanIds
      : defaultSelectedPlanIds(table),
  );
  const ordered = alphabeticalPlanIds(table).filter((id) => selected.has(id));
  return {
    ...prior,
    selectedPlanIds:
      ordered.length > 0 ? ordered : defaultSelectedPlanIds(table),
  };
}

export function createSelection(
  table: ComparisonTable,
  resultFingerprint: string,
): EffectiveSelection {
  const planByDocument: Record<string, string> = {};
  const hasProvenPlans = (table.plans ?? []).length > 0;
  for (const document of table.documents) {
    const plans = availablePlans(table, document.documentId);
    if (plans.length === 1) {
      planByDocument[document.documentId] = plans[0];
    } else if (!hasProvenPlans) {
      // Legacy tables without proven plans: each document is its own synthetic plan view.
      planByDocument[document.documentId] = document.documentId;
    }
  }
  return {
    resultFingerprint,
    contextVersion: 0,
    section: "My Fit",
    planByDocument,
    tiers: {},
    legacyTiersByDocument: {},
    selectedPlanIds: defaultSelectedPlanIds(table),
  };
}

export function reconcileSelection(
  prior: EffectiveSelection,
  table: ComparisonTable,
  resultFingerprint: string,
  options: { contextOnly?: boolean } = {},
): EffectiveSelection {
  if (prior.resultFingerprint !== resultFingerprint && !options.contextOnly)
    return createSelection(table, resultFingerprint);
  const next = createSelection(table, resultFingerprint);
  for (const doc of table.documents) {
    const id = prior.planByDocument[doc.documentId];
    if (id && availablePlans(table, doc.documentId).includes(id))
      next.planByDocument[doc.documentId] = id;
  }
  for (const [planId, tier] of Object.entries(prior.tiers)) {
    if (
      !table.plans?.some((plan) => plan.planId === planId) &&
      !Object.values(next.planByDocument).includes(planId)
    )
      continue;
    if (
      tier === null ||
      table.rows.some((r) =>
        r.values.some(
          (v) => v.planId === planId && v.qualifiers.planTier === tier,
        ),
      )
    ) {
      next.tiers[planId] = tier;
    }
  }
  const available = documentTiers(table);
  for (const [doc, tier] of Object.entries(prior.legacyTiersByDocument)) {
    if (available.get(doc)?.includes(tier))
      next.legacyTiersByDocument[doc] = tier;
  }
  const validPlanIds = new Set(alphabeticalPlanIds(table));
  const selectedPlanIds = prior.selectedPlanIds.filter((id) =>
    validPlanIds.has(id),
  );
  next.selectedPlanIds =
    selectedPlanIds.length > 0
      ? selectedPlanIds.slice(0, MAX_SELECTED_PLANS)
      : defaultSelectedPlanIds(table);
  return {
    ...next,
    section: prior.section,
    legacySection: prior.legacySection,
    contextVersion: prior.contextVersion,
  };
}

export function selectDocumentTier(
  prior: EffectiveSelection,
  table: ComparisonTable,
  documentId: string,
  tier: string | null,
): EffectiveSelection {
  const available = documentTiers(table).get(documentId);
  if (!available || (tier !== null && !available.includes(tier)))
    throw new Error("Unsupported document tier");
  const legacyTiersByDocument = { ...prior.legacyTiersByDocument };
  if (tier === null) delete legacyTiersByDocument[documentId];
  else legacyTiersByDocument[documentId] = tier;
  const tiers = { ...prior.tiers };
  const plans = availablePlans(table, documentId);
  if (
    plans.length === 1 &&
    prior.planByDocument[documentId] === plans[0] &&
    (tier === null ||
      table.rows.some((row) =>
        row.values.some(
          (value) =>
            value.documentId === documentId &&
            value.planId === plans[0] &&
            value.qualifiers.planTier === tier,
        ),
      ))
  ) {
    tiers[plans[0]] = tier;
  }
  // Legacy tables without proven plans use the documentId as its synthetic planId.
  if (plans.length === 0 && prior.planByDocument[documentId] === documentId) {
    if (tier === null) delete tiers[documentId];
    else tiers[documentId] = tier;
  }
  return { ...prior, tiers, legacyTiersByDocument };
}

export function selectPlan(
  prior: EffectiveSelection,
  table: ComparisonTable,
  documentId: string,
  planId: string,
): EffectiveSelection {
  if (!availablePlans(table, documentId).includes(planId))
    throw new Error("Unsupported plan for document");
  const planByDocument: Record<string, string> = {};
  for (const document of table.documents) {
    const id =
      document.documentId === documentId
        ? planId
        : prior.planByDocument[document.documentId];
    if (id) planByDocument[document.documentId] = id;
  }
  const tiers = { ...prior.tiers };
  for (const old of Object.values(prior.planByDocument)) {
    if (!Object.values(planByDocument).includes(old)) delete tiers[old];
  }
  const legacyTiersByDocument = { ...prior.legacyTiersByDocument };
  delete legacyTiersByDocument[documentId];
  return { ...prior, planByDocument, tiers, legacyTiersByDocument };
}

export function selectTier(
  prior: EffectiveSelection,
  table: ComparisonTable,
  planId: string,
  tier: string | null,
): EffectiveSelection {
  if (
    !prior.selectedPlanIds.includes(planId) &&
    !Object.values(prior.planByDocument).includes(planId)
  )
    throw new Error("Unsupported plan selection");
  const hasProvenPlans = (table.plans ?? []).length > 0;
  const isLegacyPlan =
    !hasProvenPlans && table.documents.some((d) => d.documentId === planId);
  if (isLegacyPlan) {
    return selectDocumentTier(prior, table, planId, tier);
  }
  if (
    tier !== null &&
    !table.rows.some((r) =>
      r.values.some(
        (v) => v.planId === planId && v.qualifiers.planTier === tier,
      ),
    )
  ) {
    throw new Error("Unsupported tier for plan");
  }
  return { ...prior, tiers: { ...prior.tiers, [planId]: tier } };
}

export function setSelectedPlanIds(
  prior: EffectiveSelection,
  table: ComparisonTable,
  planIds: string[],
): EffectiveSelection {
  if (planIds.length > MAX_SELECTED_PLANS)
    throw new Error(`At most ${MAX_SELECTED_PLANS} plans can be selected`);
  const valid = new Set(alphabeticalPlanIds(table));
  for (const id of planIds) {
    if (!valid.has(id)) throw new Error("Selected plan is not a proven plan");
  }
  return { ...prior, selectedPlanIds: [...planIds] };
}

export function setSection(
  prior: EffectiveSelection,
  section: Section,
): EffectiveSelection {
  return { ...prior, section };
}

/** A proven plan supported by several PDFs still occupies one logical view. */
export function selectedPlanIds(selection: EffectiveSelection): string[] {
  return [...new Set(Object.values(selection.planByDocument))];
}

export function selectionKey(selection: EffectiveSelection): string {
  return JSON.stringify([
    selection.resultFingerprint,
    selection.contextVersion,
    selection.section,
    selection.legacySection,
    Object.entries(selection.planByDocument).sort(),
    Object.entries(selection.tiers).sort(),
    Object.entries(selection.legacyTiersByDocument).sort(),
    selection.selectedPlanIds.slice().sort(),
  ]);
}
