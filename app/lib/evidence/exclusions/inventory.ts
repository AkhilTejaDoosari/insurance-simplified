// Exclusion inventory — EC-13 / INV-EC-09 source binding (evidence-core.md §1, §5).
//
// A document version's exclusion inventory is DERIVED, never declared:
//   - the exclusion list comes ONLY from sealed exclusion provisions admitted
//     to the request's ProvisionStore (`store.listByKind("exclusion", …)`);
//   - the "exclusion sections read" state comes ONLY from the registry's
//     page-coverage record for that document version
//     (`store.registry.coverage(documentId)`).
// The builder takes no list, id set or completeness flag, so no caller, API
// input or registry write can declare them. Missing coverage is "unknown",
// and unknown or partial coverage is never "complete".
//
// Request-scoped: build it from the request's store; never cache it in a
// module global, and never read one back from storage as authority.

import { clonePlain, deepFreeze } from "@/app/lib/evidence/canonical";
import { allPagesRead } from "@/app/lib/evidence/page-coverage";
import type { SealedProvision } from "@/app/lib/evidence/provision";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import type { RegisteredDocument } from "@/app/lib/evidence/registry";
import { proposeExclusions } from "@/app/lib/evidence/proposer/exclusions";

export type ExclusionCoverageState = "complete" | "partial" | "unknown";

export interface ExclusionCoverage {
  /** complete = every page of this document version was read ·
   *  partial = some page unreadable or not read · unknown = no record. */
  state: ExclusionCoverageState;
  readPages: number[];
  /** Pages recorded as unreadable or not read (empty when unknown). */
  unreadPages: number[];
}

/** Whether the inventory provably holds EVERY exclusion the document states
 *  (EC-2 / EC-13). Derived only from the registered page text (the same
 *  structural proposer that seals exclusions), the store's sealed exclusion
 *  provisions and the page-coverage record — never from a caller.
 *    complete — an exclusion section was found, every candidate item in it
 *               is sealed in the store, and every page was read;
 *    partial  — a section was found but a candidate was dropped or not
 *               sealed, or a page was not fully read (`pages` names them);
 *    unknown  — no verified plan, unknown coverage, a framed/unbound
 *               document, or no exclusion section found. */
export interface ExclusionCompleteness {
  state: ExclusionCoverageState;
  reason: string;
  /** Pages where exclusions may be missing (partial only), sorted. */
  pages: number[];
}

export interface ExclusionInventory {
  sessionId: string;
  documentId: string;
  /** Registered document version the inventory describes. */
  documentSha256: string;
  planId?: string;
  /** Every sealed exclusion provision of this document, ordered by id. */
  exclusions: SealedProvision[];
  coverage: ExclusionCoverage;
  completeness: ExclusionCompleteness;
  /** "failed" when a listed provision no longer passes store admission. Such
   *  a provision is still listed (an exclusion is never dropped), and the
   *  resolver cannot conclude on this inventory. */
  integrity: "intact" | "failed";
}

export type InventoryResult =
  | { ok: true; inventory: Readonly<ExclusionInventory> }
  | { ok: false; reason: string };

/** Derive the inventory for one registered document of the store's session.
 *  Deliberately takes nothing but the store and the document id. */
export function buildExclusionInventory(store: ProvisionStore, documentId: string): InventoryResult {
  const document = store.registry.get(documentId);
  if (!document || document.sessionId !== store.sessionId) {
    return { ok: false, reason: "document not registered in this session" };
  }
  const sealed = store.listByKind("exclusion", { documentId });
  const integrity = sealed.every((p) => p.documentSha256 === document.sha256 && store.stillAdmissible(p))
    ? "intact"
    : "failed";
  const exclusions = sealed
    .map((p) => clonePlain(p) as SealedProvision)
    .sort((a, b) => (a.provisionId < b.provisionId ? -1 : a.provisionId > b.provisionId ? 1 : 0));

  const record = store.registry.coverage(documentId);
  let coverage: ExclusionCoverage;
  if (!record || record.documentSha256 !== document.sha256 || record.pageCount !== document.pageCount) {
    coverage = { state: "unknown", readPages: [], unreadPages: [] };
  } else {
    const readPages = record.pages.filter((p) => p.status === "read").map((p) => p.page);
    const unreadPages = record.pages.filter((p) => p.status !== "read").map((p) => p.page);
    coverage = { state: allPagesRead(record) ? "complete" : "partial", readPages, unreadPages };
  }

  const completeness = completenessOf(store, document, sealed, coverage);
  const inventory: ExclusionInventory = {
    sessionId: store.sessionId,
    documentId,
    documentSha256: document.sha256,
    ...(document.plan ? { planId: document.plan.planId } : {}),
    exclusions,
    coverage,
    completeness,
    integrity,
  };
  return { ok: true, inventory: deepFreeze(inventory) };
}

function completenessOf(
  store: ProvisionStore,
  document: RegisteredDocument,
  sealed: readonly SealedProvision[],
  coverage: ExclusionCoverage,
): ExclusionCompleteness {
  const unknown = (reason: string): ExclusionCompleteness => ({ state: "unknown", reason, pages: [] });
  if (!document.plan) return unknown("no verified plan");
  if (coverage.state === "unknown") return unknown("page coverage unknown");
  // Re-derive the structural candidates from the registered page text.
  const otherPlanNames = store.registry.list()
    .filter((d) => d.documentId !== document.documentId && d.plan)
    .map((d) => d.plan!.name.value);
  const { proposals, report } = proposeExclusions(document, { sessionId: store.sessionId, otherPlanNames });
  if (report.unbound) return unknown(`exclusion sections not bound: ${report.unbound}`); // G:completeness-unbound
  if (report.sectionsFound === 0) return unknown("no exclusion section found"); // G:completeness-no-section
  const held = new Set(sealed.flatMap((p) => p.evidence.map((e) => `${e.page}\u0000${e.quote}`)));
  const pages = new Set<number>(report.droppedPages); // G:completeness-dropped
  for (const p of proposals) {
    for (const e of p.evidence) if (!held.has(`${e.page}\u0000${e.quote}`)) pages.add(e.page); // G:completeness-unsealed
  }
  for (const page of coverage.unreadPages) pages.add(page); // G:completeness-unread
  if (pages.size > 0) {
    return { state: "partial", reason: "exclusion candidates not sealed or pages not fully read", pages: [...pages].sort((a, b) => a - b) };
  }
  return { state: "complete", reason: "every exclusion candidate sealed and every page read", pages: [] };
}

/** Provision ids of an inventory (for resolutions and source-binding checks). */
export function inventoryProvisionIds(inventory: Readonly<ExclusionInventory>): string[] {
  return inventory.exclusions.map((p) => p.provisionId);
}
