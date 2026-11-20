// Complete uploaded-document inventory for plan comparison (P0-01).
//
// Every uploaded document appears exactly once, in upload order, whether or
// not a plan identity was verified for it. Identities are never inferred here:
// `table.plans` (already verified) is the only source of plan ids, and a
// document without one is listed as unresolved with the reason recorded at
// verification time.
import type { ComparisonTable, PlanInventoryEntry, ProvenPlan } from "@/app/lib/extraction/types";

/** User-facing explanation for a document that cannot be compared as a plan. */
export const UNRESOLVED_PLAN_REASON: Record<Exclude<PlanInventoryEntry["status"], "verified-plan">, string> = {
  "no-verified-plan-name":
    "No plan name could be verified on this document's pages, so it can't be compared as a plan. You can still read it on its own.",
  "plan-source-unverified":
    "A plan name was proposed for this document, but it could not be found on the cited page, so it can't be compared as a plan. You can still read it on its own.",
};

export function buildPlanInventory(
  documents: readonly { documentId: string }[],
  plans: readonly ProvenPlan[] | undefined,
  unverifiedSourceDocumentIds: ReadonlySet<string> = new Set(),
): PlanInventoryEntry[] {
  return documents.map(({ documentId }) => {
    const planIds = (plans ?? [])
      .filter((plan) => plan.sources.some((source) => source.documentId === documentId))
      .map((plan) => plan.planId);
    if (planIds.length > 0) return { documentId, planIds, status: "verified-plan" as const };
    return {
      documentId,
      planIds: [],
      status: unverifiedSourceDocumentIds.has(documentId)
        ? ("plan-source-unverified" as const)
        : ("no-verified-plan-name" as const),
    };
  });
}

/** Inventory for rendering. Rebuilt from the table's documents and verified
 *  plans every time, so it is complete and consistent with `table.plans` even
 *  for legacy or restored results; the server record only contributes the
 *  unresolved reason for documents that still have no plan. */
export function planInventoryOf(table: Pick<ComparisonTable, "documents" | "plans" | "planInventory">): PlanInventoryEntry[] {
  const unverified = new Set(
    (table.planInventory ?? [])
      .filter((entry) => entry.status === "plan-source-unverified")
      .map((entry) => entry.documentId),
  );
  return buildPlanInventory(table.documents, table.plans, unverified);
}
