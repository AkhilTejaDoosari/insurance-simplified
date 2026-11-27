// C4 authority per scope (AT-C4, AT-AUTH-ORDER).
//
// For one session and one provision scope: find each registered document's
// sealed provision for the scope (from the ProvisionStore only), relate every
// pair, keep the authority order acyclic, and report per connected group
// whether exactly one governing provision is proven. Request-scoped and pure:
// no module-global state; nothing a caller declares can create supersession.

import { clonePlain } from "@/app/lib/evidence/canonical";
import { isProvisionKind, type SealedProvision } from "@/app/lib/evidence/provision";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import type { RegisteredDocument } from "@/app/lib/evidence/registry";
import { identityOf, matchesScope, proveSupersession, squash } from "@/app/lib/evidence/authority/proof";
import type {
  AuthorityGroup,
  AuthorityInput,
  AuthorityRelation,
  BasisCandidate,
  ScopeAuthorityResult,
  ScopeQuery,
} from "@/app/lib/evidence/authority/types";

const INPUT_KEYS = ["sessionId", "scope", "basisCandidates"];
const SCOPE_KEYS = ["kind", "subject", "planTier", "networkTier", "conditions"];
const CANDIDATE_KEYS = ["statement", "target"];

function onlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return !!value && typeof value === "object" && Object.keys(value).every((k) => allowed.includes(k));
}

function validScope(q: unknown): q is ScopeQuery {
  if (!q || typeof q !== "object") return false;
  const s = q as ScopeQuery;
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!isProvisionKind(s.kind) || !str(s.subject)) return false;
  if (s.planTier !== undefined && !str(s.planTier)) return false;
  if (s.networkTier !== undefined && !str(s.networkTier)) return false;
  return s.conditions === undefined || (Array.isArray(s.conditions) && s.conditions.every(str));
}

/** Decide authority for one scope. Refuses (ok: false) on a foreign session
 *  or any caller-supplied field outside the proposal shape — there is no way
 *  to declare a supersession, a winner or a proof. */
export function resolveScopeAuthority(store: ProvisionStore, input: AuthorityInput): ScopeAuthorityResult {
  if (!onlyKeys(input, INPUT_KEYS)) return { ok: false, reason: "unexpected input fields" }; // G:input-keys
  const candidates: readonly BasisCandidate[] = input.basisCandidates ?? [];
  if (!Array.isArray(candidates)) return { ok: false, reason: "basisCandidates must be a list" };
  if (!onlyKeys(input.scope, SCOPE_KEYS) || candidates.some((c) => !onlyKeys(c, CANDIDATE_KEYS))) return { ok: false, reason: "unexpected input fields" }; // G:input-keys
  if (input.sessionId !== store.sessionId) return { ok: false, reason: "session mismatch" }; // G:session
  if (!validScope(input.scope)) return { ok: false, reason: "scope invalid" };
  const scope = input.scope;
  const registry = store.registry;

  const matches = new Map<string, SealedProvision[]>();
  for (const p of store.list()) {
    if (!matchesScope(p, scope)) continue;
    matches.set(p.documentId, [...(matches.get(p.documentId) ?? []), p]);
  }
  const docIds = [...matches.keys()].sort();
  const docs = new Map<string, RegisteredDocument>(docIds.map((id) => [id, registry.get(id)!]));
  const ambiguous = new Set(docIds.filter((id) => matches.get(id)!.length > 1));

  const relations: AuthorityRelation[] = [];
  for (let i = 0; i < docIds.length; i++) {
    for (let j = i + 1; j < docIds.length; j++) {
      relations.push(relate(docIds[i], docIds[j]));
    }
  }

  function relate(a: string, b: string): AuthorityRelation {
    const documents: [string, string] = [a, b];
    if (ambiguous.has(a) || ambiguous.has(b)) { // G:ambiguous
      return { relation: "conflicts_with", documents, reasons: [{ element: "ambiguous", detail: "more than one provision for this scope in one document" }] }; // G:ambiguous
    } // G:ambiguous
    const da = docs.get(a)!;
    const db = docs.get(b)!;
    const identity = identityOf(da, db);
    if (identity.kind === "independent") return { relation: "independent", documents };
    const pa = matches.get(a)![0];
    const pb = matches.get(b)![0];
    const others = registry.list().filter((d) => d.documentId !== a && d.documentId !== b);
    const ab = proveSupersession({ s: da, t: db, ps: pa, pt: pb, identity, others, candidates, scope });
    const ba = proveSupersession({ s: db, t: da, ps: pb, pt: pa, identity, others, candidates, scope });
    if (ab.ok && ba.ok) return { relation: "conflicts_with", documents, reasons: [{ element: "order", detail: "contradictory proofs: each document supersedes the other" }] }; // G:contradictory
    if (ab.ok) return { relation: "supersedes", superseding: a, superseded: b, proof: ab.proof };
    if (ba.ok) return { relation: "supersedes", superseding: b, superseded: a, proof: ba.proof };
    if (identity.kind === "same" && squash(pa.claim) === squash(pb.claim)) return { relation: "concordant", documents };
    return { relation: "conflicts_with", documents, reasons: [...(ab.ok ? [] : ab.failures), ...(ba.ok ? [] : ba.failures)] };
  }

  const ordered = breakCycles(relations);
  const groups = groupsOf(docIds, ordered, matches, ambiguous);
  const provisions = docIds.flatMap((documentId) => matches.get(documentId)!.map((p) => ({ documentId, provisionId: p.provisionId })));
  return { ok: true, authority: clonePlain({ sessionId: store.sessionId, scope, provisions, relations: ordered, groups }) };
}

/** AT-AUTH-ORDER: a supersedes edge that lies on a cycle is never a pick —
 *  every such edge becomes conflicts_with. */
function breakCycles(relations: AuthorityRelation[]): AuthorityRelation[] {
  const edges = relations.filter((r): r is Extract<AuthorityRelation, { relation: "supersedes" }> => r.relation === "supersedes");
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const e of edges) if (e.superseding === n) stack.push(e.superseded);
    }
    return false;
  };
  return relations.map((r) => {
    if (r.relation !== "supersedes") return r;
    if (!reaches(r.superseded, r.superseding)) return r;
    return { relation: "conflicts_with", documents: [r.superseding, r.superseded], reasons: [{ element: "order", detail: "cycle in authority order" }] }; // G:cycle
  });
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function groupsOf(
  docIds: string[],
  relations: AuthorityRelation[],
  matches: Map<string, SealedProvision[]>,
  ambiguous: Set<string>,
): AuthorityGroup[] {
  const parent = new Map(docIds.map((d) => [d, d]));
  const find = (d: string): string => (parent.get(d) === d ? d : find(parent.get(d)!));
  const byPair = new Map<string, AuthorityRelation>();
  for (const r of relations) {
    const [a, b] = r.relation === "supersedes" ? [r.superseding, r.superseded] : r.documents;
    byPair.set(pairKey(a, b), r);
    if (r.relation !== "independent") parent.set(find(a), find(b));
  }
  const components = new Map<string, string[]>();
  for (const d of docIds) components.set(find(d), [...(components.get(find(d)) ?? []), d]);

  return [...components.values()].map((documents) => {
    const superseded = new Set(relations.flatMap((r) => (r.relation === "supersedes" && documents.includes(r.superseded) ? [r.superseded] : [])));
    const governingDocs = documents.filter((d) => !superseded.has(d));
    let conflict = false;
    if (documents.some((d) => ambiguous.has(d))) conflict = true; // G:ambiguous
    for (let i = 0; i < governingDocs.length; i++) {
      for (let j = i + 1; j < governingDocs.length; j++) {
        if (byPair.get(pairKey(governingDocs[i], governingDocs[j]))?.relation !== "concordant") conflict = true; // G:governing-concordant
      }
    }
    return {
      documents,
      status: conflict ? "conflict" : "resolved",
      governing: governingDocs.flatMap((d) => matches.get(d)!.map((p) => p.provisionId)),
    } satisfies AuthorityGroup;
  });
}
