// Pairwise supersession proof (C4). Pure: reads only registered page texts,
// the registry's verified plan identities and sealed, admitted provisions.
// Never reads filenames, upload order, file dates or text proximity.
//
// Guard lines carry a `G:<name>` tag so the m7f guard-removal check can find
// them; each tag has a test in tests/unit/m7f-*.test.ts that fails without it.

import { canonicalJson } from "@/app/lib/evidence/canonical";
import type { SealedProvision } from "@/app/lib/evidence/provision";
import type { RegisteredDocument } from "@/app/lib/evidence/registry";
import { literallyStates, quoteReverifies, type EvidenceQuote, type SourceSpan } from "@/app/lib/evidence/source-span";
import { normalizeForMatch } from "@/app/lib/pdf/text-match";
import type { AuthorityFailure, BasisCandidate, ScopeQuery, SupersessionProof } from "@/app/lib/evidence/authority/types";

export function squash(s: string): string {
  return normalizeForMatch(s).trim().toLowerCase();
}

// Closed basis grammar: a single self-referencing sentence of the superseding
// document with an amend/replace verb, naming the superseded document after
// the verb. Hedged, negated, conditional or illustrative wording is refused.
const BASIS_GRAMMAR = /^this (amendment|endorsement|rider|notice|document|version|revision|schedule)\b.*?\b(amends|replaces|supersedes|modifies)\b/;
const BASIS_HEDGE = /\b(not|no longer|never|unless|except|if|may|might|proposed|draft|example|illustration|hypothetical|sample)\b/;
const ENTIRETY = /\bin (its|their) entirety\b/;

export type Identity =
  | { kind: "independent" }
  | { kind: "same"; planId: string; spans: Map<string, SourceSpan[]> }
  | { kind: "unresolved"; detail: string };

function identitySpans(doc: RegisteredDocument): SourceSpan[] {
  const p = doc.plan!;
  return [p.name.span, ...(p.issuer ? [p.issuer.span] : []), ...(p.policyNumber ? [p.policyNumber.span] : [])];
}

/** Symmetric identity check from the registry's verified plans. Different
 *  plan ids AND different names → independent plans. Any partial match or
 *  one-sided field → unresolved (never assumed the same plan). */
export function identityOf(a: RegisteredDocument, b: RegisteredDocument): Identity {
  const pa = a.plan;
  const pb = b.plan;
  if (!pa || !pb) return { kind: "unresolved", detail: "verified plan identity missing" };
  const sameId = pa.planId === pb.planId;
  const sameName = squash(pa.name.value) === squash(pb.name.value);
  if (!sameId && !sameName) return { kind: "independent" };
  if (!sameId) return { kind: "unresolved", detail: "same plan name under different plan ids" }; // G:identity-planid
  if (!sameName) return { kind: "unresolved", detail: "plan name differs" }; // G:identity-name
  for (const field of ["issuer", "policyNumber"] as const) {
    const fa = pa[field];
    const fb = pb[field];
    if (!fa !== !fb) return { kind: "unresolved", detail: `${field} stated by only one document` }; // G:identity-one-sided
    if (fa && fb && squash(fa.value) !== squash(fb.value)) return { kind: "unresolved", detail: `${field} differs` }; // G:identity-field-differs
  }
  return { kind: "same", planId: pa.planId, spans: new Map([[a.documentId, identitySpans(a)], [b.documentId, identitySpans(b)]]) };
}

/** Exact scope match for one provision (EC-4: scope travels with the claim). */
export function matchesScope(p: SealedProvision, q: ScopeQuery): boolean {
  if (p.kind !== q.kind) return false;
  if (!p.evidence.some((e) => literallyStates(e.quote, q.subject))) return false;
  if (!qualifiersMatch(p, q)) return false; // G:scope-qualifiers
  return true;
}

function sameValue(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return squash(a) === squash(b);
}

function qualifiersMatch(p: SealedProvision, q: ScopeQuery): boolean {
  const scope = p.scope ?? {};
  if (!sameValue(scope.planTier?.value, q.planTier) || !sameValue(scope.networkTier?.value, q.networkTier)) return false;
  const have = (scope.conditions ?? []).map((c) => squash(c.value)).sort();
  const want = (q.conditions ?? []).map(squash).sort();
  return have.length === want.length && have.every((v, i) => v === want[i]);
}

function subjectEvidence(p: SealedProvision, subject: string): EvidenceQuote {
  return p.evidence.find((e) => literallyStates(e.quote, subject))!;
}

function singleSentence(quote: string): boolean {
  return !/[.;!?]\s+\S/.test(quote.trim());
}

/** Basis checks for one candidate; empty array = the candidate is a basis. */
function basisFailures(s: RegisteredDocument, t: RegisteredDocument, others: readonly RegisteredDocument[], c: BasisCandidate): string[] {
  if (!quoteReverifies(s, c.statement)) return ["statement does not re-verify in the superseding document"]; // G:basis-statement-verifies
  if (!quoteReverifies(t, c.target)) return ["target does not re-verify in the superseded document"]; // G:basis-target-verifies
  const st = squash(c.statement.quote);
  const failures: string[] = [];
  if (!singleSentence(c.statement.quote)) failures.push("statement is not a single sentence"); // G:basis-sentence
  const grammar = BASIS_GRAMMAR.exec(st);
  if (!grammar) failures.push("statement does not say this document amends or replaces another"); // G:basis-grammar
  // The named target and the verified plan names quote documents; judge only
  // the statement's own wording for hedges (a plan name may contain "example").
  const quoted = [c.target.quote, t.plan?.name.value, s.plan?.name.value].filter((q): q is string => !!q).map(squash);
  const ownWording = quoted.reduce((acc, q) => acc.split(q).join(" "), st);
  if (BASIS_HEDGE.test(ownWording)) failures.push("statement is hedged, negated, conditional or illustrative"); // G:basis-hedge
  const targetAt = st.indexOf(squash(c.target.quote));
  const verbEnd = grammar ? grammar.index + grammar[0].length : 0;
  if (targetAt < verbEnd) failures.push("statement does not name the target after its verb"); // G:basis-names-target
  if (!literallyStates(c.target.quote, t.plan?.name.value ?? "")) failures.push("target does not state the superseded plan name"); // G:basis-target-plan
  if (others.some((d) => literallyStates(d.pages.join("\n"), c.target.quote))) failures.push("target also identifies another document"); // G:basis-target-unique
  return failures;
}

export type ProofResult = { ok: true; proof: SupersessionProof } | { ok: false; failures: AuthorityFailure[] };

/** Try to prove that `s` supersedes `t` in this scope. Every element is
 *  checked and every failure reported; any failure means no supersession. */
export function proveSupersession(args: {
  s: RegisteredDocument;
  t: RegisteredDocument;
  ps: SealedProvision;
  pt: SealedProvision;
  identity: Identity;
  others: readonly RegisteredDocument[];
  candidates: readonly BasisCandidate[];
  scope: ScopeQuery;
}): ProofResult {
  const { s, t, ps, pt, identity, others, candidates, scope } = args;
  const direction: [string, string] = [s.documentId, t.documentId];
  const failures: AuthorityFailure[] = [];
  const fail = (element: AuthorityFailure["element"], detail: string) => failures.push({ element, detail, direction });

  // Identity: the registry's verified plan, bound in both documents.
  if (identity.kind !== "same") fail("identity", identity.kind === "unresolved" ? identity.detail : "different plans");

  // Period: both verified, the superseding one starting no earlier, overlapping.
  const sp = s.plan?.period;
  const tp = t.plan?.period;
  if (!sp || !tp) fail("period", "both documents need a verified period"); // G:period-present
  if (sp && tp && sp.start < tp.start) fail("period", "superseding period starts before the superseded period"); // G:period-order
  if (sp && tp && sp.start > tp.end) fail("period", "periods do not overlap"); // G:period-overlap

  // Basis: a re-verified statement in s naming a re-verified quote of t.
  const mine = candidates
    .filter((c) => c?.statement?.documentId === s.documentId && c?.target?.documentId === t.documentId)
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const valid = mine.filter((c) => basisFailures(s, t, others, c).length === 0);
  if (mine.length === 0) fail("basis", "no statement that this document amends or replaces the other");
  else if (valid.length === 0) for (const d of new Set(mine.flatMap((c) => basisFailures(s, t, others, c)))) fail("basis", d);

  // Scope: both provisions match the query (caller selection), and the basis
  // itself covers the scope subject or the whole document.
  const covering = valid.filter((c) => literallyStates(c.statement.quote, scope.subject) || ENTIRETY.test(squash(c.statement.quote)));
  if (valid.length > 0 && covering.length === 0) fail("scope", "basis does not cover this scope"); // G:scope-basis-covers

  const basis = covering[0] ?? valid[0];
  if (failures.length > 0 || identity.kind !== "same" || !sp || !tp || !basis) return { ok: false, failures };
  return {
    ok: true,
    proof: {
      identity: { planId: identity.planId, superseding: identity.spans.get(s.documentId)!, superseded: identity.spans.get(t.documentId)! },
      period: { superseding: sp.span, superseded: tp.span, effective: { start: sp.start, end: sp.end < tp.end ? sp.end : tp.end } },
      basis: { statement: basis.statement, target: basis.target },
      scope: {
        supersedingProvisionId: ps.provisionId,
        supersededProvisionId: pt.provisionId,
        supersedingEvidence: subjectEvidence(ps, scope.subject),
        supersededEvidence: subjectEvidence(pt, scope.subject),
      },
    },
  };
}
