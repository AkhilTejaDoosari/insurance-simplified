// Wiring between the verification boundary (verify-table output) and the
// evidence core: build the session registry from the authorized session's
// stored documents, seal provisions from verified values, and admit them to
// a ProvisionStore. Request-scoped; nothing here is a module global.

import { createHash } from "node:crypto";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { sealProvision, type ProvisionContent, type ProvisionKind, type ScopeQualifier } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { readabilityCoverageSource, SessionDocumentRegistry, type VerifiedPlanIdentity } from "@/app/lib/evidence/registry";
import { sealExclusionProposals, type ExclusionProposalReport } from "@/app/lib/evidence/proposer/exclusions";
import type { PageReadability } from "@/app/lib/pdf/page-readability";
import { literallyStates, type EvidenceQuote } from "@/app/lib/evidence/source-span";
import type { PageCoverageSource } from "@/app/lib/evidence/page-coverage";
import { scopedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
import type { CellValue, ComparisonTable, ProvenPlan, TableRow } from "@/app/lib/extraction/types";

export interface RegistrableDocument {
  documentId: string;
  pageCount: number;
  pages: readonly string[];
  /** Hex sha256 of the original bytes when known (durable uploads). */
  sha256?: string;
  /** Per-page readability record (feeds the registry's page coverage). */
  readability?: readonly PageReadability[];
}

/** Adapter data (health domain): which fact rows are which provision kind. */
const FACT_PROVISION_KIND: Readonly<Record<string, ProvisionKind>> = {
  "material-exclusions": "exclusion",
  "pre-existing-conditions": "exclusion",
  "annual-deductible": "cost_share",
  "per-illness-deductible": "cost_share",
  "coinsurance": "cost_share",
  "out-of-pocket-maximum": "limit",
  "policy-limit": "limit",
  "eligibility": "eligibility",
  "student-eligibility": "eligibility",
  "age-limits": "eligibility",
  "preauthorization": "requirement",
  "referral-requirement": "requirement",
  "waiting-period": "requirement",
  "claims-filing-deadline": "requirement",
};

export function provisionKindForFact(factName: string): ProvisionKind {
  return FACT_PROVISION_KIND[factName] ?? "benefit";
}

/** Document version id: the stored sha256 of the bytes, else a digest of the
 *  stored page text (legacy/tmpdir documents without byte identity). */
function documentVersion(doc: RegistrableDocument): string {
  if (doc.sha256 && /^[0-9a-f]{64}$/i.test(doc.sha256)) return doc.sha256.toLowerCase();
  return createHash("sha256").update(doc.pages.join("\u0000"), "utf8").digest("hex");
}

/** A verified plan identity for one document: only when exactly one verified
 *  plan names this document and its source line sits at one exact span. */
function planIdentityFor(doc: RegistrableDocument, plans: readonly ProvenPlan[]): VerifiedPlanIdentity | undefined {
  const own = plans.filter((p) => p.sources.some((s) => s.documentId === doc.documentId));
  if (own.length !== 1) return undefined;
  const plan = own[0];
  const source = plan.sources.find((s) => s.documentId === doc.documentId)!;
  const page = doc.pages[source.page - 1];
  if (typeof page !== "string") return undefined;
  const start = page.indexOf(source.quote);
  if (start < 0 || page.indexOf(source.quote, start + 1) >= 0) return undefined;
  return {
    planId: plan.planId,
    name: { value: plan.name, span: { documentId: doc.documentId, page: source.page, start, end: start + source.quote.length, text: source.quote } },
  };
}

/** Build the registry for one session from its stored documents and the
 *  plans that survived verification. Documents that do not register are
 *  simply absent (fail closed: no provisions can cite them). */
export function registryForSession(
  sessionId: string,
  documents: readonly RegistrableDocument[],
  plans: readonly ProvenPlan[] = [],
  options: { coverageSource?: PageCoverageSource } = {},
): SessionDocumentRegistry {
  const registry = new SessionDocumentRegistry(sessionId, options);
  for (const doc of documents) {
    const plan = planIdentityFor(doc, plans);
    const res = registry.register({ sessionId, documentId: doc.documentId, sha256: documentVersion(doc), pages: doc.pages, ...(plan ? { plan } : {}) });
    if (!res.ok && plan) {
      // Plan identity did not bind: register the document without one.
      registry.register({ sessionId, documentId: doc.documentId, sha256: documentVersion(doc), pages: doc.pages });
    }
  }
  return registry;
}

function scopeQualifier(value: string | undefined, evidence: readonly EvidenceQuote[]): ScopeQualifier | null | undefined {
  if (value === undefined) return undefined;
  const quote = evidence.find((e) => literallyStates(e.quote, value));
  return quote ? { value, evidence: { ...quote } } : null;
}

/** Provision content for one verified value, or undefined when it cannot be
 *  a provision: no verified plan, or a scope value its own evidence does not
 *  state (never widened by dropping scope — EC-4). */
export function provisionContentFor(
  sessionId: string,
  registry: SessionDocumentRegistry,
  factName: string,
  value: CellValue,
): ProvisionContent | undefined {
  const doc = registry.get(value.documentId);
  if (!doc?.plan || !value.planId || value.planId !== doc.plan.planId) return undefined;
  const scoped = scopedQualifiers(value);
  const planTier = scopeQualifier(scoped.planTier, value.evidence);
  const networkTier = scopeQualifier(scoped.networkTier, value.evidence);
  const conditions = scopeQualifier(scoped.conditions, value.evidence);
  if (planTier === null || networkTier === null || conditions === null) return undefined;
  const kind = provisionKindForFact(factName);
  // Exclusions carry verbatim source text (EC-7): the display when its own
  // evidence states it, else the cited passage itself.
  const claim = kind === "exclusion"
    ? (value.evidence.some((e) => literallyStates(e.quote, value.display)) ? value.display : value.evidence[0]?.quote)
    : value.display;
  if (!claim) return undefined;
  return {
    sessionId,
    documentId: doc.documentId,
    documentSha256: doc.sha256,
    kind,
    claim,
    plan: { planId: doc.plan.planId, name: doc.plan.name.value, nameSpan: { ...doc.plan.name.span } },
    scope: {
      ...(planTier ? { planTier } : {}),
      ...(networkTier ? { networkTier } : {}),
      ...(conditions ? { conditions: [conditions] } : {}),
    },
    evidence: value.evidence.map((e) => ({ documentId: e.documentId, page: e.page, quote: e.quote })),
  };
}

export interface SessionEvidence {
  authority: EvidenceAuthority;
  registry: SessionDocumentRegistry;
  store: ProvisionStore;
  /** Admitted provision ids per row (same order as `table.rows`). */
  provisionIdsByRow: string[][];
  /** The verified rows the provisions were sealed from. */
  rows: readonly TableRow[];
  /** Table-cell subject (row label) of each admitted row provision, used to
   *  name authority scopes; only labels literally stated by the anchor. */
  provisionSubjects: Record<string, string>;
  /** C1 exclusion proposer outcome per registered document (counts only). */
  exclusionProposals: ExclusionProposalReport[];
}

/** Seal every provable verified value of a verified table and admit it.
 *  A value whose provision is refused simply has no provision. */
export function sealVerifiedTable(
  sessionId: string,
  documents: readonly RegistrableDocument[],
  table: ComparisonTable,
  options: { authority?: EvidenceAuthority; coverageSource?: PageCoverageSource } = {},
): SessionEvidence {
  const authority = options.authority ?? new EvidenceAuthority();
  const coverageSource = options.coverageSource ?? readabilityCoverageSource(documents);
  const registry = registryForSession(sessionId, documents, table.plans ?? [], { coverageSource });
  const store = new ProvisionStore(sessionId, registry, authority);
  const provisionSubjects: Record<string, string> = {};
  const scopeTerms = new Map<string, Set<string>>();
  const provisionIdsByRow = table.rows.map((row) => {
    const ids: string[] = [];
    for (const value of row.values) {
      if (value.planId && value.qualifiers?.planTier) {
        const terms = scopeTerms.get(value.documentId) ?? new Set<string>();
        terms.add(value.qualifiers.planTier);
        scopeTerms.set(value.documentId, terms);
      }
      const content = provisionContentFor(sessionId, registry, row.factName, value);
      if (!content) continue;
      const res = store.accept(sealProvision(authority, content));
      if (!res.ok) continue;
      if (!ids.includes(res.provision.provisionId)) ids.push(res.provision.provisionId);
      const label = value.anchor?.kind === "table-cell" ? value.anchor.label : undefined;
      if (typeof label === "string" && label.trim()) provisionSubjects[res.provision.provisionId] = label.trim();
    }
    return ids;
  });
  // C1 proposer: exclusion sections by document structure, sealed and
  // admitted through the same store gate.
  const exclusionProposals = sealExclusionProposals(store, authority, {
    otherPlanNames: (table.plans ?? []).map((p) => p.name),
    scopeTermsFor: (documentId) => [...(scopeTerms.get(documentId) ?? [])],
  });
  return { authority, registry, store, provisionIdsByRow, rows: table.rows, provisionSubjects, exclusionProposals };
}
