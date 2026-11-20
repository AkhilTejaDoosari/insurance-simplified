// C4 Authority types (evidence-core.md §4, AT-C4 / AT-AUTH-ORDER).
//
// Supersession is a relation between two registered documents of ONE session
// for ONE provision scope. It holds only with a resolved proof — identity,
// period, basis, scope — whose every element cites verified evidence from
// BOTH documents. Anything else is `conflicts_with` (never a silent winner),
// except two documents of different verified plans, which are `independent`
// (different plan values are not a conflict).

import type { ProvisionKind } from "@/app/lib/evidence/provision";
import type { EvidenceQuote, SourceSpan } from "@/app/lib/evidence/source-span";

/** The provision scope authority is decided for. `subject` must be literally
 *  stated by the provision's own verified evidence; qualifiers must equal the
 *  provision's sealed scope values exactly (absent = absent). */
export interface ScopeQuery {
  kind: ProvisionKind;
  subject: string;
  planTier?: string;
  networkTier?: string;
  conditions?: string[];
}

/** A PROPOSED basis (e.g. from an extractor or model — EC-9): a statement in
 *  the superseding document that it amends/replaces the superseded one, and a
 *  quote of the superseded document that the statement names. Both are
 *  re-verified verbatim here; a proposal is never authority by itself. */
export interface BasisCandidate {
  statement: EvidenceQuote;
  target: EvidenceQuote;
}

export interface AuthorityInput {
  sessionId: string;
  scope: ScopeQuery;
  basisCandidates?: readonly BasisCandidate[];
}

export type ProofElement = "identity" | "period" | "basis" | "scope";

export interface AuthorityFailure {
  element: ProofElement | "ambiguous" | "order";
  detail: string;
  /** [superseding candidate, superseded candidate] for directional checks. */
  direction?: [string, string];
}

export interface SupersessionProof {
  identity: { planId: string; superseding: SourceSpan[]; superseded: SourceSpan[] };
  period: {
    superseding: SourceSpan;
    superseded: SourceSpan;
    /** Window in which the superseding provision governs (ISO, inclusive). */
    effective: { start: string; end: string };
  };
  basis: { statement: EvidenceQuote; target: EvidenceQuote };
  scope: {
    supersedingProvisionId: string;
    supersededProvisionId: string;
    supersedingEvidence: EvidenceQuote;
    supersededEvidence: EvidenceQuote;
  };
}

export type AuthorityRelation =
  | { relation: "supersedes"; superseding: string; superseded: string; proof: SupersessionProof }
  | { relation: "conflicts_with"; documents: [string, string]; reasons: AuthorityFailure[] }
  /** Same verified plan, same normalized claim: no conflict, no winner. */
  | { relation: "concordant"; documents: [string, string] }
  /** Different verified plans: no authority relation and no conflict. */
  | { relation: "independent"; documents: [string, string] };

/** Documents connected by any non-independent relation in this scope. */
export interface AuthorityGroup {
  documents: string[];
  status: "resolved" | "conflict";
  /** Provision ids not superseded in this scope. Exactly one (or several
   *  concordant ones) when resolved. */
  governing: string[];
}

export interface ScopeAuthority {
  sessionId: string;
  scope: ScopeQuery;
  provisions: { documentId: string; provisionId: string }[];
  relations: AuthorityRelation[];
  groups: AuthorityGroup[];
}

export type ScopeAuthorityResult = { ok: true; authority: ScopeAuthority } | { ok: false; reason: string };
