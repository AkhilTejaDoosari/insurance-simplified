// Surface adapter for exclusion/applicability outcomes (TB-2, TB-3).
//
// A surface never renders an exclusion resolution directly: it passes what it
// holds through D's `displayIssuedResolution`, which re-checks the issue seal
// and maps the outcome through the single C-1 table. Anything altered after
// issue, or issued under another authority, shows "cannot be confirmed".

import type { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { CANNOT_BE_CONFIRMED, type Issued } from "@/app/lib/evidence/issued";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import {
  displayIssuedResolution,
  resolveServiceQuestion,
  type ExclusionResolution,
} from "@/app/lib/evidence/resolver/exclusion-resolver";
import { HEALTH_MATERIALITY_MAP_V1 } from "@/app/lib/evidence/resolver/health-materiality";
import { conceptHits } from "@/app/lib/evidence/resolver/materiality";
import type { Verdict } from "@/app/lib/verdicts";

/** Service concepts a question names (versioned materiality map; adapter data). */
export function servicesNamedIn(text: string): string[] {
  const ids = conceptHits(HEALTH_MATERIALITY_MAP_V1, text).filter((h) => !h.shadowed).map((h) => h.conceptId);
  return [...new Set(ids)];
}

/** Resolve every named service against every registered document that has a
 *  verified plan and is in the caller's scope (P0-04: the chat selection —
 *  a document outside it never contributes an outcome). Refuses to issue
 *  under an authority the store does not seal with. */
export function resolveExclusionOutcomes(
  store: ProvisionStore,
  authority: EvidenceAuthority,
  question: string,
  scope: { documentIds: readonly string[] },
): Issued<ExclusionResolution>[] {
  if (!store.issuesUnder(authority)) throw new Error("exclusion outcomes: authority is not the store's authority");
  const services = servicesNamedIn(question);
  if (services.length === 0) return [];
  return store.registry
    .list()
    .filter((doc) => doc.plan && scope.documentIds.includes(doc.documentId))
    .flatMap((doc) => services.map((service) => resolveServiceQuestion({ store, authority }, { documentId: doc.documentId, service })));
}

export interface ExclusionOutcomeView {
  documentId?: string;
  service?: string;
  verdict: Verdict;
  status: "confirmed" | typeof CANNOT_BE_CONFIRMED;
  /** Provisions the confirmed outcome rests on (cite verbatim). */
  citedProvisionIds: string[];
}

/** The ONLY way a surface turns exclusion resolutions into display data. */
export function exclusionOutcomeViews(
  authority: EvidenceAuthority,
  sessionId: string,
  issued: readonly unknown[],
): ExclusionOutcomeView[] {
  return issued.map((candidate) => {
    const shown = displayIssuedResolution(authority, sessionId, candidate);
    if (!shown.confirmed) return { verdict: shown.verdict, status: CANNOT_BE_CONFIRMED, citedProvisionIds: [] };
    return {
      documentId: shown.resolution.documentId,
      service: shown.resolution.service,
      verdict: shown.verdict,
      status: "confirmed",
      citedProvisionIds: [...shown.resolution.citedProvisionIds],
    };
  });
}
