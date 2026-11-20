// ProvisionStore(sessionId, registry) — evidence-core.md §4, TB-1.
//
// Accepts ONLY provisions that (1) carry an intact seal from this store's
// authority, (2) belong to this session and a document registered in it,
// (3) cite that document's registered bytes, (4) are scoped to that
// document's verified plan (same planId, name and exact name span),
// (5) have every evidence quote re-verify verbatim on the stored pages,
// (6) have every scope value literally stated by its own re-verified evidence
// (EC-4), and (7) have any period bound to a real span inside the document's
// verified period. Everything else is refused, and a refusal stores nothing.
//
// Request-scoped and in-process: the store is never a module global and is
// never read back from the database as authority (AT-PERSIST — persisted
// provisions are re-derived and re-accepted, or carry a store-side seal under
// a durable authority key).

import { clonePlain, deepFreeze, type EvidenceAuthority } from "@/app/lib/evidence/canonical";
import {
  isProvisionKind,
  provisionSealIntact,
  type ProvisionKind,
  type ScopeQualifier,
  type SealedProvision,
} from "@/app/lib/evidence/provision";
import type { RegisteredDocument, SessionDocumentRegistry } from "@/app/lib/evidence/registry";
import { literallyStates, quoteReverifies, spanIsBound, type SourceSpan } from "@/app/lib/evidence/source-span";

export type AcceptResult =
  | { ok: true; provision: Readonly<SealedProvision> }
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sameSpan(a: SourceSpan, b: SourceSpan): boolean {
  return a.documentId === b.documentId && a.page === b.page && a.start === b.start && a.end === b.end && a.text === b.text;
}

/** All admission checks; pure, no mutation. Exported so tests can prove each
 *  guard independently. */
export function admissionCheck(
  authority: EvidenceAuthority,
  sessionId: string,
  registry: SessionDocumentRegistry,
  candidate: unknown,
): { ok: true; provision: SealedProvision; document: RegisteredDocument } | { ok: false; reason: string } {
  if (!provisionSealIntact(authority, candidate)) return { ok: false, reason: "not sealed or altered after sealing" };
  const p = candidate;
  if (p.sessionId !== sessionId || registry.sessionId !== sessionId) return { ok: false, reason: "session mismatch" };
  if (!isProvisionKind(p.kind)) return { ok: false, reason: "unknown provision kind" };
  const doc = registry.get(p.documentId);
  if (!doc) return { ok: false, reason: "document not registered in this session" };
  if (p.documentSha256 !== doc.sha256) return { ok: false, reason: "evidence does not cite the registered document bytes" };

  // Plan scope: must be the document's own verified plan, bound to the same span.
  const plan = doc.plan;
  if (!plan) return { ok: false, reason: "document has no verified plan identity" };
  if (!p.plan || p.plan.planId !== plan.planId || p.plan.name !== plan.name.value) {
    return { ok: false, reason: "provision not scoped to the document's verified plan" };
  }
  if (!p.plan.nameSpan || !sameSpan(p.plan.nameSpan, plan.name.span) || !spanIsBound(doc, p.plan.nameSpan)) {
    return { ok: false, reason: "plan-name evidence not bound to the registered source span" };
  }

  // Admissible evidence.
  if (typeof p.claim !== "string" || !p.claim.trim()) return { ok: false, reason: "claim required" };
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) return { ok: false, reason: "evidence required" };
  for (const e of p.evidence) {
    if (!quoteReverifies(doc, e)) return { ok: false, reason: "evidence does not re-verify on the registered page" };
  }
  if (p.kind === "exclusion" && !p.evidence.some((e) => literallyStates(e.quote, p.claim))) {
    return { ok: false, reason: "exclusion claim is not verbatim source text" };
  }

  // Scope (EC-4).
  const scope = p.scope ?? {};
  if (typeof scope !== "object") return { ok: false, reason: "scope malformed" };
  const qualifiers: ScopeQualifier[] = [
    ...(scope.planTier ? [scope.planTier] : []),
    ...(scope.networkTier ? [scope.networkTier] : []),
    ...(Array.isArray(scope.conditions) ? scope.conditions : []),
  ];
  if (scope.conditions !== undefined && !Array.isArray(scope.conditions)) return { ok: false, reason: "scope malformed" };
  for (const q of qualifiers) {
    if (!q || typeof q.value !== "string" || !q.value.trim()) return { ok: false, reason: "scope value empty" };
    if (!quoteReverifies(doc, q.evidence)) return { ok: false, reason: "scope evidence does not re-verify" };
    if (!literallyStates(q.evidence.quote, q.value)) return { ok: false, reason: "scope value not stated by its evidence" };
  }

  // Period: real span, inside the document's verified period.
  if (p.period !== undefined) {
    const { start, end, span } = p.period;
    if (!ISO_DATE.test(start ?? "") || !ISO_DATE.test(end ?? "") || start > end) return { ok: false, reason: "period invalid" };
    if (!span || !spanIsBound(doc, span)) return { ok: false, reason: "period evidence not bound to a source span" };
    if (!span.text.includes(start.slice(0, 4)) || !span.text.includes(end.slice(0, 4))) {
      return { ok: false, reason: "period not stated by its span" };
    }
    if (!plan.period) return { ok: false, reason: "document has no verified period" };
    if (start < plan.period.start || end > plan.period.end) return { ok: false, reason: "period outside the document's period" };
  }
  return { ok: true, provision: p, document: doc };
}

export class ProvisionStore {
  readonly sessionId: string;
  readonly #registry: SessionDocumentRegistry;
  readonly #authority: EvidenceAuthority;
  readonly #byId = new Map<string, Readonly<SealedProvision>>();

  constructor(sessionId: string, registry: SessionDocumentRegistry, authority: EvidenceAuthority) {
    if (registry.sessionId !== sessionId) throw new Error("ProvisionStore: registry belongs to another session");
    this.sessionId = sessionId;
    this.#registry = registry;
    this.#authority = authority;
  }

  /** Admit one sealed provision. Idempotent for the identical provision;
   *  stores nothing on refusal. */
  accept(candidate: unknown): AcceptResult {
    const check = admissionCheck(this.#authority, this.sessionId, this.#registry, candidate);
    if (!check.ok) return check;
    const existing = this.#byId.get(check.provision.provisionId);
    if (existing) return { ok: true, provision: existing };
    const stored = deepFreeze(clonePlain(check.provision));
    this.#byId.set(stored.provisionId, stored);
    return { ok: true, provision: stored };
  }

  /** Admit a batch atomically: all are stored or none are. */
  acceptAll(candidates: readonly unknown[]): { ok: true; provisions: Readonly<SealedProvision>[] } | { ok: false; index: number; reason: string } {
    const checked: SealedProvision[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const check = admissionCheck(this.#authority, this.sessionId, this.#registry, candidate);
      if (!check.ok) return { ok: false, index, reason: check.reason };
      checked.push(check.provision);
    }
    return { ok: true, provisions: checked.map((p) => this.accept(p)).map((r) => (r as { provision: Readonly<SealedProvision> }).provision) };
  }

  get(provisionId: string): Readonly<SealedProvision> | undefined {
    return this.#byId.get(provisionId);
  }

  list(): Readonly<SealedProvision>[] {
    return [...this.#byId.values()];
  }

  listByDocument(documentId: string): Readonly<SealedProvision>[] {
    return this.list().filter((p) => p.documentId === documentId);
  }

  listByKind(kind: ProvisionKind, options: { documentId?: string } = {}): Readonly<SealedProvision>[] {
    return this.list().filter((p) => p.kind === kind && (options.documentId === undefined || p.documentId === options.documentId));
  }

  /** Re-check a stored provision still verifies (defence in depth for
   *  consumers that hold references across steps). */
  stillAdmissible(provision: unknown): boolean {
    return admissionCheck(this.#authority, this.sessionId, this.#registry, provision).ok;
  }

  /** True only for the exact authority this store seals and admits under.
   *  A resolver checks it before issuing, so no resolution (including one
   *  over an empty inventory) is issued under a foreign authority. */
  issuesUnder(authority: EvidenceAuthority): boolean {
    return authority === this.#authority;
  }

  get registry(): SessionDocumentRegistry {
    return this.#registry;
  }
}
