// Sealed provisions (evidence-core.md §4, C1 → provision store).
//
// A provision is one claim a plan document makes (a benefit, a cost share, an
// exclusion, …) with its scope and its admissible evidence. The verifier seals
// it; any later change — to the claim, scope, evidence, or by adding a field —
// breaks the seal, and the store refuses it.
//
// Provision kinds are adapter data for the health domain; the sealing and
// store rules below do not depend on which kinds exist.

import { contentDigest, type EvidenceAuthority, type Seal } from "@/app/lib/evidence/canonical";
import type { EvidenceQuote, SourceSpan } from "@/app/lib/evidence/source-span";

export const PROVISION_KINDS = [
  "benefit",
  "cost_share",
  "limit",
  "exclusion",
  "eligibility",
  "requirement",
  "definition",
  "other",
] as const;
export type ProvisionKind = (typeof PROVISION_KINDS)[number];

export function isProvisionKind(value: unknown): value is ProvisionKind {
  return typeof value === "string" && (PROVISION_KINDS as readonly string[]).includes(value);
}

/** A scope value (EC-4): kept only when literally stated in its evidence. */
export interface ScopeQualifier {
  value: string;
  evidence: EvidenceQuote;
}

export interface ProvisionScope {
  planTier?: ScopeQualifier;
  networkTier?: ScopeQualifier;
  conditions?: ScopeQualifier[];
}

/** The provision's plan: must equal the registry's verified identity for
 *  the document, including the exact span that states the plan name. */
export interface ProvisionPlanBinding {
  planId: string;
  name: string;
  nameSpan: SourceSpan;
}

/** Optional provision-specific period (ISO dates, inclusive). Must be bound
 *  to a source span and lie inside the document's verified period. */
export interface ProvisionPeriod {
  start: string;
  end: string;
  span: SourceSpan;
}

/** Everything the seal covers. */
export interface ProvisionContent {
  sessionId: string;
  documentId: string;
  /** sha256 of the registered document bytes the evidence cites. */
  documentSha256: string;
  kind: ProvisionKind;
  /** The claim. For `exclusion` it must be verbatim source text stated by
   *  its evidence (EC-7); other kinds carry the verifier's display. */
  claim: string;
  plan: ProvisionPlanBinding;
  scope: ProvisionScope;
  /** ≥1 verbatim quotes that re-verify on the registered pages. */
  evidence: EvidenceQuote[];
  period?: ProvisionPeriod;
}

export interface SealedProvision extends ProvisionContent {
  /** Derived from the content digest; cannot be chosen by a caller. */
  provisionId: string;
  seal: Seal;
}

/** Content covered by the seal: every own field except id and seal, so an
 *  added field also breaks it. */
export function provisionContent(provision: SealedProvision): Record<string, unknown> {
  const { provisionId: _id, seal: _seal, ...content } = provision;
  return content;
}

export function provisionIdFor(content: unknown): string {
  return `prov-${contentDigest(content).slice(0, 32)}`;
}

/** Seal verifier output. Sealing does NOT check evidence — the store does,
 *  at acceptance, against the registry (TB-1). */
export function sealProvision(authority: EvidenceAuthority, content: ProvisionContent): SealedProvision {
  const copy = structuredClone(content);
  return { ...copy, provisionId: provisionIdFor(copy), seal: authority.seal("provision", copy) };
}

/** True only when the provision was sealed by `authority` and is unchanged. */
export function provisionSealIntact(authority: EvidenceAuthority, provision: unknown): provision is SealedProvision {
  if (!provision || typeof provision !== "object") return false;
  const p = provision as SealedProvision;
  let content: Record<string, unknown>;
  try {
    content = provisionContent(p);
    if (p.provisionId !== provisionIdFor(content)) return false;
  } catch {
    return false;
  }
  return authority.verify("provision", content, p.seal);
}
