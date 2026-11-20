// AT-C4 (evidence-core.md §4 C4 Authority): supersession only with a resolved
// proof — identity, period, basis, scope — citing verified evidence from both
// documents; otherwise conflicts_with. Synthetic documents only.
import { describe, expect, it } from "vitest";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { issueResolution } from "@/app/lib/evidence/issued";
import { quoteReverifies, spanIsBound } from "@/app/lib/evidence/source-span";
import { OUTCOME_TO_VERDICT } from "@/app/lib/evidence/verdict-mapping";
import {
  AUTHORITY_ISSUER,
  authorityOutcome,
  authorityVerdict,
  confirmScopeAuthority,
  groupForDocument,
  issueScopeAuthority,
  resolveScopeAuthority,
  type AuthorityRelation,
  type BasisCandidate,
  type ScopeAuthority,
  type ScopeQuery,
} from "@/app/lib/evidence/authority";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import {
  A,
  A_SPECIALIST,
  B,
  B_ER,
  B_SPECIALIST,
  B_TITLE,
  BASIS_A,
  BASIS_A_CANDIDATE,
  DEFAULT_PROVS,
  ER,
  PRIMARY,
  SESSION,
  SPECIALIST,
  amendSpec,
  baseSpec,
  basis,
  build,
  docId,
  scenario,
} from "@/tests/unit/helpers/m7f-authority-fixtures";

function resolve(store: ProvisionStore, scope: ScopeQuery = SPECIALIST, candidates: BasisCandidate[] = [BASIS_A_CANDIDATE]): ScopeAuthority {
  const res = resolveScopeAuthority(store, { sessionId: SESSION, scope, basisCandidates: candidates });
  if (!res.ok) throw new Error(`resolve refused: ${res.reason}`);
  return res.authority;
}

function pair(authority: ScopeAuthority, a: string, b: string): AuthorityRelation {
  const r = authority.relations.find((x) =>
    x.relation === "supersedes" ? [x.superseding, x.superseded].sort().join() === [a, b].sort().join() : [...x.documents].sort().join() === [a, b].sort().join(),
  );
  if (!r) throw new Error("no relation");
  return r;
}

/** Failure elements/details for one direction of a conflicts_with relation. */
function failuresFor(r: AuthorityRelation, s: string, t: string) {
  if (r.relation !== "conflicts_with") throw new Error(`expected conflicts_with, got ${r.relation}`);
  return r.reasons.filter((x) => x.direction?.[0] === s && x.direction?.[1] === t);
}

function expectConflict(authority: ScopeAuthority, element: string, detail?: string) {
  const r = pair(authority, A, B);
  expect(r.relation).toBe("conflicts_with");
  const f = failuresFor(r, A, B);
  expect(f.map((x) => x.element)).toEqual(f.map(() => element));
  expect(f.length).toBeGreaterThan(0);
  if (detail) expect(f.map((x) => x.detail)).toContain(detail);
  const group = groupForDocument(authority, A)!;
  expect(group.status).toBe("conflict");
  expect(authorityOutcome(group)).toBe("conflict");
  expect(authorityVerdict(group)).toBe("CONFLICTED");
  return f;
}

describe("AT-C4 valid supersession", () => {
  it("supersedes only with identity, period, basis and scope cited from both documents", () => {
    const { store, registry } = scenario();
    const authority = resolve(store);
    const r = pair(authority, A, B);
    expect(r.relation).toBe("supersedes");
    if (r.relation !== "supersedes") return;
    expect([r.superseding, r.superseded]).toEqual([A, B]);
    const { proof } = r;
    const docA = registry.get(A)!;
    const docB = registry.get(B)!;
    // Identity: verified plan spans bound in each document.
    expect(proof.identity.planId).toBe("plan-silver");
    expect(proof.identity.superseding.every((s) => s.documentId === A && spanIsBound(docA, s))).toBe(true);
    expect(proof.identity.superseded.every((s) => s.documentId === B && spanIsBound(docB, s))).toBe(true);
    // Period: both verified, effective in the overlap window.
    expect(spanIsBound(docA, proof.period.superseding)).toBe(true);
    expect(spanIsBound(docB, proof.period.superseded)).toBe(true);
    expect(proof.period.effective).toEqual({ start: "2026-07-01", end: "2026-12-31" });
    // Basis: statement re-verifies in A, target re-verifies in B.
    expect(quoteReverifies(docA, proof.basis.statement)).toBe(true);
    expect(quoteReverifies(docB, proof.basis.target)).toBe(true);
    expect(proof.basis.statement.quote).toBe(BASIS_A);
    // Scope: one sealed provision per document, evidence re-verifies.
    expect(store.get(proof.scope.supersedingProvisionId)?.documentId).toBe(A);
    expect(store.get(proof.scope.supersededProvisionId)?.documentId).toBe(B);
    expect(quoteReverifies(docA, proof.scope.supersedingEvidence)).toBe(true);
    expect(quoteReverifies(docB, proof.scope.supersededEvidence)).toBe(true);

    const group = groupForDocument(authority, B)!;
    expect(group.status).toBe("resolved");
    expect(group.governing).toEqual([proof.scope.supersedingProvisionId]);
    expect(authorityOutcome(group)).toBeUndefined();
    expect(authorityVerdict(group)).toBeUndefined();
  });

  it("a whole-document basis ('in its entirety') covers every shared scope", () => {
    const entire = `This amendment replaces ${B_TITLE} in its entirety.`;
    const { store } = scenario({ amend: { extra: [entire] } });
    const authority = resolve(store, PRIMARY, [basis(A, entire, B, B_TITLE)]);
    expect(pair(authority, A, B).relation).toBe("supersedes");
  });
});

describe("AT-C4 missing identity → conflicts_with", () => {
  it.each([
    ["issuer stated by only one document", { amend: { issuer: null } }, "issuer stated by only one document"],
    ["issuer differs", { amend: { issuer: "Other Mutual" } }, "issuer differs"],
    ["plan name differs under the same plan id", { amend: { name: "Example Health Gold" } }, "plan name differs"],
    ["same plan name under a different plan id", { amend: { planId: "plan-other" } }, "same plan name under different plan ids"],
  ] as const)("%s", (_n, over, detail) => {
    const { store } = scenario(over);
    expectConflict(resolve(store), "identity", detail);
  });

  it("different verified plans are independent, not conflicted (different plan values ≠ CONFLICTED)", () => {
    const { store } = scenario({ amend: { planId: "plan-gold", name: "Example Health Gold" } });
    const authority = resolve(store);
    expect(pair(authority, A, B).relation).toBe("independent");
    expect(authority.groups.map((g) => g.status)).toEqual(["resolved", "resolved"]);
  });
});

describe("AT-C4 missing period → conflicts_with", () => {
  it.each([
    ["superseding document has no verified period", { amend: { period: null } }, "both documents need a verified period"],
    ["superseded document has no verified period", { base: { period: null } }, "both documents need a verified period"],
    [
      "superseding period starts before the superseded period",
      { amend: { period: { start: "2025-07-01", end: "2026-12-31", line: "Effective period: July 1, 2025 through December 31, 2026" } } },
      "superseding period starts before the superseded period",
    ],
    [
      "periods do not overlap",
      { amend: { period: { start: "2027-01-01", end: "2027-12-31", line: "Effective period: January 1, 2027 through December 31, 2027" } } },
      "periods do not overlap",
    ],
  ] as const)("%s", (_n, over, detail) => {
    const { store } = scenario(over);
    expectConflict(resolve(store), "period", detail);
  });
});

describe("AT-C4 missing basis → conflicts_with", () => {
  it("never infers supersession from a later period, later registration or document order", () => {
    const { store } = scenario();
    const authority = resolve(store, SPECIALIST, []);
    expectConflict(authority, "basis", "no statement that this document amends or replaces the other");
  });

  it.each([
    ["conditional", `This amendment replaces the specialist visit cost share in ${B_TITLE} if approved.`, B_TITLE, "statement is hedged, negated, conditional or illustrative"],
    ["outside the closed grammar", `We hereby replace the specialist visit cost share in ${B_TITLE}.`, B_TITLE, "statement does not say this document amends or replaces another"],
    ["does not name the target", "This amendment replaces the specialist visit cost share.", B_TITLE, "statement does not name the target after its verb"],
    ["more than one sentence", `This amendment replaces the specialist visit cost share. See ${B_TITLE}.`, B_TITLE, "statement is not a single sentence"],
    ["target does not state the superseded plan", BASIS_A, "Schedule of Benefits Version B", "target does not state the superseded plan name"],
  ])("refuses a basis that is %s", (_n, statement, target, detail) => {
    const { store } = scenario({ amend: { extra: [statement] } });
    const f = expectConflict(resolve(store, SPECIALIST, [basis(A, statement, B, target)]), "basis", detail);
    expect(f.map((x) => x.detail)).toEqual([detail]);
  });

  it("refuses a target that also identifies another registered document (ambiguous reference)", () => {
    const notice = { id: docId("notice"), title: "Example Health Silver Member Notice", extra: [`Refer to ${B_TITLE} for details.`], benefits: ["General information only."] };
    const { store } = build([baseSpec(), amendSpec(), notice], DEFAULT_PROVS);
    expectConflict(resolve(store), "basis", "target also identifies another document");
  });
});

describe("AT-C4 missing scope → conflicts_with", () => {
  it("a basis scoped to one subject does not supersede another shared subject", () => {
    const { store } = scenario();
    expectConflict(resolve(store, PRIMARY), "scope", "basis does not cover this scope");
  });

  it("scope qualifiers must match exactly: another network tier is a different scope", () => {
    const outOfNetwork = "Out-of-network specialist visit: $80 copay after deductible.";
    const { store } = scenario({
      base: { benefits: [B_SPECIALIST, outOfNetwork] },
      provs: [...DEFAULT_PROVS.filter((p) => p.line !== "In-network primary care visit: $20 copay." && p.line !== B_ER), { doc: B, line: outOfNetwork, networkTier: "Out-of-network" }],
    });
    const authority = resolve(store);
    expect(pair(authority, A, B).relation).toBe("supersedes");
    expect(authority.provisions.map((p) => p.documentId).sort()).toEqual([A, B].sort());
  });

  it("two provisions for the same scope in one document are ambiguous → conflict", () => {
    const second = "In-network specialist visit: $45 copay for telehealth.";
    const { store } = scenario({
      base: { benefits: [B_SPECIALIST, second] },
      provs: [{ doc: B, line: B_SPECIALIST, networkTier: "In-network" }, { doc: B, line: second, networkTier: "In-network" }, { doc: A, line: A_SPECIALIST, networkTier: "In-network" }],
    });
    const authority = resolve(store);
    const r = pair(authority, A, B);
    expect(r).toMatchObject({ relation: "conflicts_with", reasons: [{ element: "ambiguous" }] });
    expect(authority.groups[0].status).toBe("conflict");

    const alone = build([baseSpec({ benefits: [B_SPECIALIST, second] })], [{ doc: B, line: B_SPECIALIST, networkTier: "In-network" }, { doc: B, line: second, networkTier: "In-network" }]);
    const single = resolve(alone.store);
    expect(single.groups).toHaveLength(1);
    expect(single.groups[0].status).toBe("conflict");
  });
});

describe("AT-C4 caller-declared supersession is refused", () => {
  it("refuses any input field outside the proposal shape", () => {
    const { store } = scenario();
    const declared = { sessionId: SESSION, scope: SPECIALIST, basisCandidates: [], supersedes: [{ superseding: A, superseded: B }] };
    expect(resolveScopeAuthority(store, declared as never)).toEqual({ ok: false, reason: "unexpected input fields" });
    const flagged = { sessionId: SESSION, scope: SPECIALIST, basisCandidates: [{ ...BASIS_A_CANDIDATE, verified: true }] };
    expect(resolveScopeAuthority(store, flagged as never)).toEqual({ ok: false, reason: "unexpected input fields" });
    const winner = { sessionId: SESSION, scope: { ...SPECIALIST, governing: A }, basisCandidates: [] };
    expect(resolveScopeAuthority(store, winner as never)).toEqual({ ok: false, reason: "unexpected input fields" });
  });

  it("refuses a foreign session id (session scope before any read)", () => {
    const { store } = scenario();
    expect(resolveScopeAuthority(store, { sessionId: "sess-other", scope: SPECIALIST, basisCandidates: [BASIS_A_CANDIDATE] })).toEqual({ ok: false, reason: "session mismatch" });
  });

  it("a caller-built authority result is never confirmed by any surface", () => {
    const { store, authority: key } = scenario();
    const forged: ScopeAuthority = {
      sessionId: SESSION,
      scope: SPECIALIST,
      provisions: store.list().map((p) => ({ documentId: p.documentId, provisionId: p.provisionId })),
      relations: [],
      groups: [{ documents: [A, B], status: "resolved", governing: [store.listByDocument(A)[0].provisionId] }],
    };
    const fakeSeal = { v: 1, purpose: "resolution", digest: "0".repeat(64), mac: "0".repeat(64) };
    expect(confirmScopeAuthority(key, store, { resolution: forged, meta: { sessionId: SESSION, issuer: AUTHORITY_ISSUER }, seal: fakeSeal })).toMatchObject({ status: "cannot_be_confirmed", label: "cannot be confirmed" });
    // Issued under the right key but by another resolver.
    expect(confirmScopeAuthority(key, store, issueResolution(key, forged, { sessionId: SESSION, issuer: "exclusion-resolver@1" }))).toMatchObject({
      status: "cannot_be_confirmed",
      reason: "not issued by the authority resolver",
    });
  });

  it("an issued result is confirmed unaltered, and refused when altered, read back under another key, or checked against another store", () => {
    const { store, authority: key } = scenario();
    const issued = issueScopeAuthority(key, resolve(store));
    expect(confirmScopeAuthority(key, store, issued).status).toBe("confirmed");

    const altered = JSON.parse(JSON.stringify(issued));
    altered.resolution.groups[0].status = "conflict";
    expect(confirmScopeAuthority(key, store, altered).status).toBe("cannot_be_confirmed");
    expect(confirmScopeAuthority(new EvidenceAuthority(), store, JSON.parse(JSON.stringify(issued))).status).toBe("cannot_be_confirmed");

    const empty = build([baseSpec()], [], { authority: key });
    expect(confirmScopeAuthority(key, empty.store, issued)).toMatchObject({
      status: "cannot_be_confirmed",
      reason: "cites a provision this session's store does not hold",
    });
  });
});

describe("AT-C4 evidence that does not re-verify is refused", () => {
  it.each([
    ["a paraphrased statement", basis(A, `This amendment replaces the specialist cost share in ${B_TITLE}.`, B, B_TITLE), "statement does not re-verify in the superseding document"],
    ["a statement cited on the wrong page", basis(A, BASIS_A, B, B_TITLE, 2), "statement does not re-verify in the superseding document"],
    ["superseded-document text attributed to the superseding document", basis(A, B_SPECIALIST, B, B_TITLE), "statement does not re-verify in the superseding document"],
    ["a fabricated target", basis(A, BASIS_A, B, `${B_TITLE} (revised)`), "target does not re-verify in the superseded document"],
  ])("%s", (_n, candidate, detail) => {
    const { store } = scenario();
    expectConflict(resolve(store, SPECIALIST, [candidate as BasisCandidate]), "basis", detail);
  });
});

describe("AT-C4 relations without a winner", () => {
  it("identical claims of the same verified plan are concordant, not conflicted", () => {
    const { store } = scenario({ amend: { benefits: [B_SPECIALIST], extra: [] }, provs: [{ doc: B, line: B_SPECIALIST, networkTier: "In-network" }, { doc: A, line: B_SPECIALIST, networkTier: "In-network" }] });
    const authority = resolve(store, SPECIALIST, []);
    expect(pair(authority, A, B).relation).toBe("concordant");
    expect(authority.groups[0].status).toBe("resolved");
    expect(authority.groups[0].governing).toHaveLength(2);
  });

  it("is independent of registration order and candidate order", () => {
    const forward = build([baseSpec(), amendSpec()], DEFAULT_PROVS);
    const backward = build([amendSpec(), baseSpec()], [...DEFAULT_PROVS].reverse());
    const extra = basis(A, BASIS_A, B, "Plan name: Example Health Silver");
    for (const scope of [SPECIALIST, PRIMARY, ER]) {
      const f = resolve(forward.store, scope, [BASIS_A_CANDIDATE, extra]);
      const b = resolve(backward.store, scope, [extra, BASIS_A_CANDIDATE]);
      expect(JSON.stringify(b)).toBe(JSON.stringify(f));
    }
  });

  it("maps a conflict only through the one verdict table", () => {
    const { store } = scenario();
    const group = groupForDocument(resolve(store, SPECIALIST, []), B)!;
    expect(authorityVerdict(group)).toBe(OUTCOME_TO_VERDICT.conflict);
  });
});
