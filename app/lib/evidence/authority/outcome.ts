// Authority → outcomes, only through agent B's interfaces:
// `conflict` → CONFLICTED via verdict-mapping, and Issued<Resolution> via
// issueResolution / checkIssued (AT-PERSIST: anything altered, read back
// under another authority, issued by another resolver, or citing provisions
// this session's store does not hold is "cannot be confirmed").

import type { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { CANNOT_BE_CONFIRMED, checkIssued, issueResolution, type Issued, type IssuedCheck } from "@/app/lib/evidence/issued";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { displayVerdictFor, type OutcomeStatus } from "@/app/lib/evidence/verdict-mapping";
import type { Verdict } from "@/app/lib/verdicts";
import type { AuthorityGroup, ScopeAuthority } from "@/app/lib/evidence/authority/types";

export const AUTHORITY_ISSUER = "authority-resolver@1" as const;

/** The outcome status authority contributes for a group: "conflict" when no
 *  single governing provision is proven; undefined when resolved (the
 *  governing provision's own outcome then applies — authority adds none). */
export function authorityOutcome(group: AuthorityGroup): Extract<OutcomeStatus, "conflict"> | undefined {
  return group.status === "resolved" ? undefined : "conflict";
}

/** Display verdict for an unresolved group (always CONFLICTED via the one
 *  mapping table); undefined when the group is resolved. */
export function authorityVerdict(group: AuthorityGroup): Verdict | undefined {
  const outcome = authorityOutcome(group);
  return outcome === undefined ? undefined : displayVerdictFor(outcome);
}

/** The group a document belongs to in this scope, if it has a provision. */
export function groupForDocument(authority: ScopeAuthority, documentId: string): AuthorityGroup | undefined {
  return authority.groups.find((g) => g.documents.includes(documentId));
}

export function issueScopeAuthority(authority: EvidenceAuthority, result: ScopeAuthority): Issued<ScopeAuthority> {
  return issueResolution(authority, result, { sessionId: result.sessionId, issuer: AUTHORITY_ISSUER });
}

/** Gate every surface must use before rendering an authority result. */
export function confirmScopeAuthority(
  authority: EvidenceAuthority,
  store: ProvisionStore,
  candidate: unknown,
): IssuedCheck<ScopeAuthority> {
  const checked = checkIssued<ScopeAuthority>(authority, store.sessionId, candidate);
  if (checked.status !== "confirmed") return checked;
  const refuse = (reason: string): IssuedCheck<ScopeAuthority> => ({ status: "cannot_be_confirmed", label: CANNOT_BE_CONFIRMED, reason });
  if (checked.meta.issuer !== AUTHORITY_ISSUER) return refuse("not issued by the authority resolver"); // G:confirm-issuer
  const provisions = checked.resolution?.provisions;
  if (!Array.isArray(provisions)) return refuse("not an authority resolution");
  if (provisions.some((p) => !store.get(p.provisionId))) return refuse("cites a provision this session's store does not hold"); // G:confirm-store
  return checked;
}
