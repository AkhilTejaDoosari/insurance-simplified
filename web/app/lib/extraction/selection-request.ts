// Shared, pure validation of a client-provided selection payload (chat and
// export both send the SAME shape — one contract, no competing state sources).
//
// A selection payload is an OPAQUE reference: the client names which verified
// plan/tier view it is looking at, but it never supplies facts. Validation
// runs against the server-side validated comparison table ONLY; planIds and
// tiers must exist in that table (a stale or foreign scope is rejected before
// any retrieval or report is generated). No fact content is trusted from the
// client.

import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { documentTiers } from "@/app/lib/extraction/tiers";
import type { ActiveView } from "@/app/lib/presentation/adaptive";

export interface SelectionRequest {
  /** Opaque validated result fingerprint returned by /api/extract. */
  resultFingerprint: string;
  /** Selected proven plan IDs (legacy tables: document IDs), at most three. */
  planIds: string[];
  /** Plan-scoped tier choice; null means All tiers. Legacy tier keys are document IDs. */
  tiers: Record<string, string | null>;
  /** Legacy document-scoped tier view (transitional V1 behaviour). */
  legacyTiersByDocument: Record<string, string>;
  /** Echo of the client's effective selection key; opaque, never parsed. */
  selectionKey?: string;
  viewMode?: "understand" | "compare";
  documentId?: string;
}

export type SelectionScopeError =
  | "malformed"
  | "stale-fingerprint"
  | "foreign-plan"
  | "foreign-document"
  | "unsupported-tier"
  | "too-many-plans";

export type SelectionScopeResult =
  | { ok: true; selection: SelectionRequest }
  | { ok: false; error: SelectionScopeError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTierMap(value: unknown): Record<string, string | null> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string | null> = {};
  for (const [key, tier] of Object.entries(value)) {
    if (typeof key !== "string" || !key.trim()) return undefined;
    if (tier !== null && typeof tier !== "string") return undefined;
    out[key] = tier;
  }
  return out;
}

/** Structural parse only — no table membership checks here. */
export function parseSelectionRequest(
  body: unknown,
): SelectionRequest | undefined {
  if (!isRecord(body)) return undefined;
  const {
    resultFingerprint,
    planIds,
    tiers,
    legacyTiersByDocument,
    selectionKey,
    viewMode,
    documentId,
  } = body;
  if (typeof resultFingerprint !== "string" || !resultFingerprint.trim())
    return undefined;
  if (
    viewMode !== undefined &&
    viewMode !== "understand" &&
    viewMode !== "compare"
  )
    return undefined;
  if (
    viewMode === "understand" &&
    (typeof documentId !== "string" || !documentId.trim())
  )
    return undefined;
  if (
    !Array.isArray(planIds) ||
    (planIds.length === 0 && viewMode !== "understand") ||
    planIds.length > 5
  )
    return undefined;
  if (!planIds.every((id) => typeof id === "string" && id.trim()))
    return undefined;
  if (new Set(planIds).size !== planIds.length) return undefined;
  const parsedTiers = asTierMap(tiers);
  if (!parsedTiers) return undefined;
  const parsedLegacies = asTierMap(legacyTiersByDocument) as
    Record<string, string | null> | undefined;
  if (
    !parsedLegacies ||
    !Object.entries(parsedLegacies).every(
      ([, tier]) => typeof tier === "string" && tier.trim(),
    )
  ) {
    return undefined;
  }
  if (
    selectionKey !== undefined &&
    (typeof selectionKey !== "string" || selectionKey.length > 512)
  ) {
    return undefined;
  }
  return {
    resultFingerprint: resultFingerprint.trim(),
    planIds: planIds.map((id) => (id as string).trim()),
    tiers: parsedTiers,
    legacyTiersByDocument: parsedLegacies as Record<string, string>,
    selectionKey:
      selectionKey === undefined ? undefined : (selectionKey as string),
    ...(viewMode ? { viewMode } : {}),
    ...(viewMode === "understand"
      ? { documentId: (documentId as string).trim() }
      : {}),
  };
}

export function hasProvenPlans(table: RegisteredComparisonTable): boolean {
  return (table.plans ?? []).length > 0;
}

/** Validate a parsed selection against the validated comparison table:
 *  every plan must be a proven plan (legacy: an uploaded document) and every
 *  non-null tier must be evidenced by that plan's validated rows. Fail-closed:
 *  any foreign or unsupported scope is an error before retrieval/export. */
export function validateSelectionScope(
  selection: SelectionRequest,
  table: RegisteredComparisonTable,
): SelectionScopeError | undefined {
  if (selection.viewMode === "understand") {
    if (selection.planIds.length > 1) return "malformed";
    if (!table.documents.some((d) => d.documentId === selection.documentId))
      return "foreign-document";
    if (
      selection.planIds.some((id) =>
        hasProvenPlans(table)
          ? !table.plans?.some(
              (p) =>
                p.planId === id &&
                p.sources.some((s) => s.documentId === selection.documentId),
            )
          : id !== selection.documentId,
      )
    )
      return "foreign-plan";
    const documentTier = selection.tiers[selection.documentId!];
    if (
      documentTier &&
      !documentTiers(table).get(selection.documentId!)?.includes(documentTier)
    )
      return "unsupported-tier";
  }
  if (
    selection.viewMode === "compare" &&
    (selection.planIds.length < 2 || selection.planIds.length > 3)
  )
    return "malformed";
  if (hasProvenPlans(table)) {
    // The three-column shortlist limit is part of the validated scope for
    // proven plans (product rule: at most three comparison columns).
    if (selection.planIds.length > 3) return "too-many-plans";
    const planIds = new Set((table.plans ?? []).map((p) => p.planId));
    for (const id of selection.planIds) {
      if (!planIds.has(id)) return "foreign-plan";
    }
    for (const [planId, tier] of Object.entries(selection.tiers)) {
      if (!selection.planIds.includes(planId)) continue; // tier outside scope plays no role
      if (tier === null) continue;
      const supported = table.rows.some((row) =>
        row.values.some(
          (value) =>
            value.planId === planId &&
            value.qualifiers.planTier?.trim() === tier,
        ),
      );
      if (!supported) return "unsupported-tier";
    }
    return undefined;
  }
  // Legacy representation: each document is its own synthetic plan view.
  const documentIds = new Set(table.documents.map((d) => d.documentId));
  for (const id of selection.planIds) {
    if (!documentIds.has(id)) return "foreign-plan";
  }
  for (const [documentId, tier] of Object.entries(
    selection.legacyTiersByDocument,
  )) {
    if (!selection.planIds.includes(documentId)) continue;
    if (!documentTiers(table).get(documentId)?.includes(tier))
      return "unsupported-tier";
  }
  // Legacy document tiers may also travel in the plan-scoped tier map.
  for (const [documentId, tier] of Object.entries(selection.tiers)) {
    if (!selection.planIds.includes(documentId)) continue;
    if (tier === null) continue;
    if (!documentTiers(table).get(documentId)?.includes(tier))
      return "unsupported-tier";
  }
  return undefined;
}

/** The stored result fingerprint is the server-side anchor for "am I still
 *  looking at the result this selection talks about?". undefined stored value
 *  (legacy dev record) defers to the document fingerprint check. */
export function selectionMatchesResultFingerprint(
  selection: SelectionRequest,
  storedFingerprint: string | undefined,
): boolean {
  if (!storedFingerprint) return true;
  return selection.resultFingerprint === storedFingerprint;
}

export function activeViewFromSelection(
  selection: SelectionRequest,
): ActiveView | undefined {
  return selection.viewMode
    ? {
        mode: selection.viewMode,
        ...(selection.viewMode === "understand"
          ? { documentId: selection.documentId }
          : {}),
        planIds: [...selection.planIds],
        tiers: { ...selection.legacyTiersByDocument, ...selection.tiers },
      }
    : undefined;
}
