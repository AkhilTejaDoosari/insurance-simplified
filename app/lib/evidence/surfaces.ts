// Producer of the evidence surfaces (app/lib/evidence/surface-types.ts).
//
// Views are built ONLY from the request's sealed ProvisionStore:
//   - ExclusionInventoryView per document from buildExclusionInventory
//     (sealed exclusion provisions + the registry's page-coverage record);
//   - AuthorityView per multi-document group from resolveScopeAuthority,
//     for sessions with 2+ registered documents.
// Each view is issued with issueResolution under the request's
// EvidenceAuthority and rendered only through `renderIssuedSurfaces`, which
// re-checks every issue (checkIssued) and the view's own consistency; any
// failure becomes a SurfaceCannotBeConfirmed marker (never a partial view).
// Read-back (`rederiveSurfaces`) re-derives from stored page text under the
// current request's authority; a stored view that does not re-derive
// exactly cannot be confirmed. Request-scoped; no module-global state.

import { canonicalJson, type EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { CANNOT_BE_CONFIRMED, checkIssued, issueResolution, type Issued } from "@/app/lib/evidence/issued";
import { buildExclusionInventory } from "@/app/lib/evidence/exclusions/inventory";
import {
  authorityVerdict,
  confirmScopeAuthority,
  issueScopeAuthority,
  resolveScopeAuthority,
  type AuthorityRelation,
  type ScopeQuery,
} from "@/app/lib/evidence/authority";
import type { SessionEvidence } from "@/app/lib/evidence/session-evidence";
import type { ConfirmedResult } from "@/app/lib/evidence/read-back";
import type { ComparisonResultRecord } from "@/app/lib/comparison-result-db";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { EvidenceQuote } from "@/app/lib/evidence/source-span";
import {
  SURFACES_SCHEMA,
  type AuthorityView,
  type EvidenceSurfaces,
  type ExclusionInventoryView,
  type SurfaceCannotBeConfirmed,
  type SurfaceEvidence,
} from "@/app/lib/evidence/surface-types";

export const SURFACES_ISSUER = "evidence-surfaces@1" as const;

type ViewKind = SurfaceCannotBeConfirmed["of"];

export interface IssuedSurfaces {
  exclusions: Issued<ExclusionInventoryView>[];
  authority: Issued<AuthorityView>[];
}

function surfaceEvidence(e: EvidenceQuote): SurfaceEvidence {
  return { documentId: e.documentId, page: e.page, quote: e.quote, evidenceId: evidenceIdFor(e.documentId, e.page, e.quote) };
}

function cannotBeConfirmed(of: ViewKind): SurfaceCannotBeConfirmed {
  return { kind: "cannot-be-confirmed", of, label: CANNOT_BE_CONFIRMED };
}

/** Exclusion inventory views: one per registered document with a verified
 *  plan and at least one sealed exclusion. A document without sealed
 *  exclusions gets no view (an empty list must never read as "none"). */
export function exclusionInventoryViews(evidence: SessionEvidence): (ExclusionInventoryView | SurfaceCannotBeConfirmed)[] {
  const out: (ExclusionInventoryView | SurfaceCannotBeConfirmed)[] = [];
  for (const doc of evidence.registry.list()) {
    if (!doc.plan) continue;
    const built = buildExclusionInventory(evidence.store, doc.documentId);
    if (!built.ok) continue;
    const inv = built.inventory;
    if (inv.exclusions.length === 0) continue;
    if (inv.integrity !== "intact") { out.push(cannotBeConfirmed("exclusion-inventory")); continue; }
    out.push({
      kind: "exclusion-inventory",
      documentId: doc.documentId,
      planId: doc.plan.planId,
      planName: doc.plan.name.value,
      coverage: inv.coverage.state,
      pagesNotRead: inv.coverage.state === "unknown" ? [] : [...inv.coverage.unreadPages],
      exclusions: inv.exclusions.map((p) => ({
        provisionId: p.provisionId,
        claim: p.claim,
        evidence: p.evidence.map(surfaceEvidence),
      })),
    });
  }
  return out;
}

function scopeLabel(q: ScopeQuery): string {
  const parts = [q.planTier, q.networkTier, ...(q.conditions ?? [])].filter((v): v is string => !!v);
  return parts.length ? `${q.subject} (${parts.join(", ")})` : q.subject;
}

/** Authority scopes: one per (kind, table-cell subject, sealed scope values)
 *  held by provisions of 2+ documents. */
function authorityScopes(evidence: SessionEvidence): ScopeQuery[] {
  const byKey = new Map<string, { query: ScopeQuery; docs: Set<string> }>();
  for (const p of evidence.store.list()) {
    const subject = evidence.provisionSubjects[p.provisionId];
    if (!subject) continue;
    const s = p.scope ?? {};
    const query: ScopeQuery = {
      kind: p.kind,
      subject,
      ...(s.planTier ? { planTier: s.planTier.value } : {}),
      ...(s.networkTier ? { networkTier: s.networkTier.value } : {}),
      ...(s.conditions?.length ? { conditions: s.conditions.map((c) => c.value) } : {}),
    };
    const key = canonicalJson(query);
    const entry = byKey.get(key) ?? { query, docs: new Set<string>() };
    entry.docs.add(p.documentId);
    byKey.set(key, entry);
  }
  return [...byKey.values()].filter((e) => e.docs.size >= 2).map((e) => e.query).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
}

/** Authority views for sessions with 2+ registered documents. */
export function authorityViews(evidence: SessionEvidence, sessionId: string): (AuthorityView | SurfaceCannotBeConfirmed)[] {
  if (evidence.registry.list().length < 2) return [];
  const out: (AuthorityView | SurfaceCannotBeConfirmed)[] = [];
  for (const scope of authorityScopes(evidence)) {
    const result = resolveScopeAuthority(evidence.store, { sessionId, scope });
    if (!result.ok) continue;
    const confirmed = confirmScopeAuthority(evidence.authority, evidence.store, issueScopeAuthority(evidence.authority, result.authority));
    if (confirmed.status !== "confirmed") { out.push(cannotBeConfirmed("authority")); continue; }
    const auth = confirmed.resolution;
    const provisionOf = new Map(auth.provisions.map((p) => [p.documentId, p.provisionId]));
    const quoteOf = (documentId: string): SurfaceEvidence[] => {
      const id = provisionOf.get(documentId);
      const p = id ? evidence.store.get(id) : undefined;
      return p?.evidence[0] ? [surfaceEvidence(p.evidence[0])] : [];
    };
    for (const group of auth.groups) {
      if (group.documents.length < 2) continue;
      const inGroup = (r: AuthorityRelation) => {
        const [a, b] = r.relation === "supersedes" ? [r.superseding, r.superseded] : r.documents;
        return group.documents.includes(a) && group.documents.includes(b);
      };
      const relations: AuthorityView["relations"] = [];
      let broken = false;
      for (const r of auth.relations.filter(inGroup)) {
        if (r.relation === "independent") continue;
        if (r.relation === "supersedes") {
          const ev = [surfaceEvidence(r.proof.basis.statement), surfaceEvidence(r.proof.basis.target)];
          relations.push({ from: r.superseding, to: r.superseded, relation: "supersedes", evidence: ev });
          continue;
        }
        const [from, to] = r.documents;
        const ev = [...quoteOf(from), ...quoteOf(to)];
        if (ev.length === 0) broken = true;
        relations.push({
          from, to, relation: r.relation, evidence: ev,
          ...(r.relation === "conflicts_with" ? { reasons: [...new Set(r.reasons.map((x) => x.element))] } : {}),
        });
      }
      const verdict = authorityVerdict(group);
      const consistent = !broken && (group.status === "conflict" ? verdict !== undefined : verdict === undefined);
      if (!consistent) { out.push(cannotBeConfirmed("authority")); continue; }
      out.push({
        kind: "authority",
        scopeLabel: scopeLabel(scope),
        status: group.status,
        ...(verdict ? { verdict } : {}),
        governing: group.governing.flatMap((provisionId) => {
          const p = evidence.store.get(provisionId);
          return p ? [{ documentId: p.documentId, provisionId }] : [];
        }),
        relations,
      });
    }
  }
  return out;
}

/** Build and issue every view under the request's authority. Views that are
 *  already markers are carried as unissued (they render as markers). */
export function issueSurfaces(evidence: SessionEvidence, sessionId: string): { issued: IssuedSurfaces; markers: { exclusions: number; authority: number } } {
  const meta = { sessionId, issuer: SURFACES_ISSUER };
  const ex = exclusionInventoryViews(evidence);
  const au = authorityViews(evidence, sessionId);
  return {
    issued: {
      exclusions: ex.filter((v): v is ExclusionInventoryView => v.kind === "exclusion-inventory").map((v) => issueResolution(evidence.authority, v, meta)),
      authority: au.filter((v): v is AuthorityView => v.kind === "authority").map((v) => issueResolution(evidence.authority, v, meta)),
    },
    markers: {
      exclusions: ex.filter((v) => v.kind === "cannot-be-confirmed").length,
      authority: au.filter((v) => v.kind === "cannot-be-confirmed").length,
    },
  };
}

/** A view whose own fields contradict each other is never shown. */
function selfConsistent(view: unknown, of: ViewKind): boolean {
  if (!view || typeof view !== "object") return false;
  const v = view as Record<string, unknown>;
  if (v.kind !== of) return false;
  if (of === "exclusion-inventory") {
    const inv = view as ExclusionInventoryView;
    if (!["complete", "partial", "unknown"].includes(inv.coverage) || !Array.isArray(inv.pagesNotRead) || !Array.isArray(inv.exclusions)) return false;
    if (inv.coverage === "complete" && inv.pagesNotRead.length > 0) return false;
    if (inv.coverage === "partial" && inv.pagesNotRead.length === 0) return false;
    return inv.exclusions.every((e) => typeof e?.claim === "string" && Array.isArray(e.evidence) && e.evidence.length > 0);
  }
  const a = view as AuthorityView;
  if (a.status !== "resolved" && a.status !== "conflict") return false;
  if (a.status === "resolved" && a.verdict === "CONFLICTED") return false;
  if (a.status === "conflict" && a.verdict !== "CONFLICTED") return false;
  return Array.isArray(a.relations) && a.relations.every((r) => r && Array.isArray(r.evidence) && (r.relation !== "supersedes" || r.evidence.length > 0));
}

function gate<V>(authority: EvidenceAuthority, sessionId: string, of: ViewKind, candidate: unknown): V | SurfaceCannotBeConfirmed {
  const check = checkIssued<V>(authority, sessionId, candidate);
  if (check.status !== "confirmed" || check.meta.issuer !== SURFACES_ISSUER || !selfConsistent(check.resolution, of)) {
    return cannotBeConfirmed(of);
  }
  return check.resolution;
}

/** The single render gate for surfaces. Anything altered after issue, issued
 *  under another authority/session/issuer, or self-contradicting is shown as
 *  "cannot be confirmed". */
export function renderIssuedSurfaces(
  authority: EvidenceAuthority,
  sessionId: string,
  issued: { exclusions?: readonly unknown[]; authority?: readonly unknown[] },
  markers: { exclusions?: number; authority?: number } = {},
): EvidenceSurfaces {
  return {
    schema: SURFACES_SCHEMA,
    exclusions: [
      ...(issued.exclusions ?? []).map((c) => gate<ExclusionInventoryView>(authority, sessionId, "exclusion-inventory", c)),
      ...Array.from({ length: markers.exclusions ?? 0 }, () => cannotBeConfirmed("exclusion-inventory")),
    ],
    authority: [
      ...(issued.authority ?? []).map((c) => gate<AuthorityView>(authority, sessionId, "authority", c)),
      ...Array.from({ length: markers.authority ?? 0 }, () => cannotBeConfirmed("authority")),
    ],
  };
}

/** Build, issue and render the surfaces for one request. */
export function surfacesFor(evidence: SessionEvidence, sessionId: string): EvidenceSurfaces {
  const { issued, markers } = issueSurfaces(evidence, sessionId);
  return renderIssuedSurfaces(evidence.authority, sessionId, issued, markers);
}

/** Every quote a surface shows (to register as session evidence). */
export function surfaceQuotes(surfaces: EvidenceSurfaces): { documentId: string; page: number; quote: string }[] {
  const views = [...surfaces.exclusions, ...surfaces.authority];
  return views.flatMap((v) => {
    if (v.kind === "exclusion-inventory") return v.exclusions.flatMap((e) => e.evidence);
    if (v.kind === "authority") return v.relations.flatMap((r) => r.evidence);
    return [];
  }).map(({ documentId, page, quote }) => ({ documentId, page, quote }));
}

function storedViews(record: ComparisonResultRecord, key: "exclusions" | "authority"): unknown[] | undefined {
  const s = (record.payload as { surfaces?: unknown }).surfaces as { schema?: unknown; exclusions?: unknown; authority?: unknown } | undefined;
  if (!s || typeof s !== "object" || s.schema !== SURFACES_SCHEMA) return undefined;
  return Array.isArray(s[key]) ? (s[key] as unknown[]) : [];
}

/** AT-PERSIST read-back by re-derivation. `confirmed` is the result of
 *  `confirmStoredResult` for the same session, documents and record (its
 *  `.evidence` holds the re-derived store under THIS request's authority).
 *  Each STORED view is shown only when it equals a view re-derived now from
 *  the stored page text; otherwise it is "cannot be confirmed". Returns
 *  null when the record carries no surfaces. */
export function rederiveSurfaces(input: {
  sessionId: string;
  documents?: readonly unknown[];
  record: ComparisonResultRecord;
  confirmed: Pick<ConfirmedResult, "evidence">;
}): EvidenceSurfaces | null {
  const storedEx = storedViews(input.record, "exclusions");
  const storedAu = storedViews(input.record, "authority");
  if (storedEx === undefined || storedAu === undefined) return null;
  const evidence = input.confirmed.evidence;
  if (!evidence || input.record.sessionId !== input.sessionId) {
    return {
      schema: SURFACES_SCHEMA,
      exclusions: storedEx.map(() => cannotBeConfirmed("exclusion-inventory")),
      authority: storedAu.map(() => cannotBeConfirmed("authority")),
    };
  }
  const { issued } = issueSurfaces(evidence, input.sessionId);
  const match = (stored: unknown, pool: readonly Issued<unknown>[]) => {
    let key: string | undefined;
    try { key = canonicalJson(stored); } catch { key = undefined; }
    const hit = key === undefined ? undefined : pool.find((i) => canonicalJson(i.resolution) === key);
    // Render the STORED view under the re-derived seal: equal → confirmed.
    return hit ? { resolution: stored, meta: hit.meta, seal: hit.seal } : { resolution: stored };
  };
  return renderIssuedSurfaces(evidence.authority, input.sessionId, {
    exclusions: storedEx.map((v) => match(v, issued.exclusions)),
    authority: storedAu.map((v) => match(v, issued.authority)),
  });
}
