// AT-AUTH-ORDER (evidence-core.md §4/§5): the authority relation is acyclic
// per scope; a cycle or contradictory proofs are a conflict, never a pick.
// Synthetic documents only.
import { describe, expect, it } from "vitest";
import { OUTCOME_TO_VERDICT } from "@/app/lib/evidence/verdict-mapping";
import {
  authorityVerdict,
  groupForDocument,
  resolveScopeAuthority,
  type AuthorityRelation,
  type BasisCandidate,
  type ScopeAuthority,
  type ScopeQuery,
} from "@/app/lib/evidence/authority";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import {
  A,
  B,
  BASIS_A_CANDIDATE,
  ER,
  PRIMARY,
  SESSION,
  SPECIALIST,
  basis,
  build,
  docId,
  scenario,
  type DocSpec,
} from "@/tests/unit/helpers/m7f-authority-fixtures";

function resolve(store: ProvisionStore, scope: ScopeQuery, candidates: BasisCandidate[]): ScopeAuthority {
  const res = resolveScopeAuthority(store, { sessionId: SESSION, scope, basisCandidates: candidates });
  if (!res.ok) throw new Error(`resolve refused: ${res.reason}`);
  return res.authority;
}

function supersedes(authority: ScopeAuthority): [string, string][] {
  return authority.relations.flatMap((r) => (r.relation === "supersedes" ? [[r.superseding, r.superseded] as [string, string]] : []));
}

function orderReasons(r: AuthorityRelation): string[] {
  return r.relation === "conflicts_with" ? r.reasons.filter((x) => x.element === "order").map((x) => x.detail) : [];
}

const title = (v: string) => `Example Health Silver Schedule Version ${v}`;
const statement = (target: string) => `This revision replaces the specialist visit cost share in ${title(target)}.`;
const line = (amount: number) => `In-network specialist visit: $${amount} copay after deductible.`;
const PCP = "In-network primary care visit: $20 copay.";

function versionDoc(v: string, replaces: string | undefined, amount: number, period?: DocSpec["period"], benefits?: string[]): DocSpec {
  return {
    id: docId(`v${v.toLowerCase()}`),
    title: title(v),
    ...(period ? { period } : {}),
    extra: replaces ? [statement(replaces)] : [],
    benefits: benefits ?? [line(amount)],
  };
}

function cand(from: string, to: string): BasisCandidate {
  return basis(docId(`v${from.toLowerCase()}`), statement(to), docId(`v${to.toLowerCase()}`), title(to));
}

describe("AT-AUTH-ORDER", () => {
  it("contradictory proofs (each document supersedes the other) are a conflict, never a pick", () => {
    const docs = [versionDoc("P", "Q", 40), versionDoc("Q", "P", 50)];
    const { store } = build(docs, docs.map((d, i) => ({ doc: d.id, line: line(i ? 50 : 40), networkTier: "In-network" })));
    const authority = resolve(store, SPECIALIST, [cand("P", "Q"), cand("Q", "P")]);
    expect(supersedes(authority)).toEqual([]);
    expect(authority.relations).toHaveLength(1);
    expect(orderReasons(authority.relations[0])).toEqual(["contradictory proofs: each document supersedes the other"]);
    expect(authority.groups[0].status).toBe("conflict");
    expect(authorityVerdict(authority.groups[0])).toBe(OUTCOME_TO_VERDICT.conflict);
  });

  it("a cycle X → Y → Z → X is a conflict on every edge, never a pick", () => {
    const docs = [versionDoc("X", "Y", 40), versionDoc("Y", "Z", 50), versionDoc("Z", "X", 60)];
    const { store } = build(docs, docs.map((d, i) => ({ doc: d.id, line: line(40 + 10 * i), networkTier: "In-network" })));
    const authority = resolve(store, SPECIALIST, [cand("X", "Y"), cand("Y", "Z"), cand("Z", "X")]);
    expect(supersedes(authority)).toEqual([]);
    expect(authority.relations.map(orderReasons).filter((r) => r.length)).toEqual([
      ["cycle in authority order"],
      ["cycle in authority order"],
      ["cycle in authority order"],
    ]);
    expect(authority.groups).toHaveLength(1);
    expect(authority.groups[0].status).toBe("conflict");
    expect(authority.groups[0].governing).toHaveLength(3);
    expect(authorityVerdict(authority.groups[0])).toBe("CONFLICTED");
  });

  it("an acyclic chain resolves to its one governing provision", () => {
    const q3 = { start: "2026-07-01", end: "2026-12-31", line: "Effective period: July 1, 2026 through December 31, 2026" };
    const q4 = { start: "2026-10-01", end: "2026-12-31", line: "Effective period: October 1, 2026 through December 31, 2026" };
    const docs = [versionDoc("X", "Y", 60, q4), versionDoc("Y", "Z", 50, q3), versionDoc("Z", undefined, 40)];
    const { store } = build(docs, docs.map((d, i) => ({ doc: d.id, line: line(60 - 10 * i), networkTier: "In-network" })));
    const authority = resolve(store, SPECIALIST, [cand("X", "Y"), cand("Y", "Z")]);
    expect(supersedes(authority).sort()).toEqual([[docId("vx"), docId("vy")], [docId("vy"), docId("vz")]]);
    const group = authority.groups[0];
    expect(group.status).toBe("resolved");
    expect(group.governing).toEqual(store.listByDocument(docId("vx")).map((p) => p.provisionId));
  });

  it("order is per scope: one document can govern one scope and not another", () => {
    const { store } = scenario();
    const candidates = [BASIS_A_CANDIDATE];
    const specialist = resolve(store, SPECIALIST, candidates);
    expect(supersedes(specialist)).toEqual([[A, B]]);
    expect(groupForDocument(specialist, A)!.governing).toEqual(store.listByDocument(A).filter((p) => p.claim.includes("specialist")).map((p) => p.provisionId));

    const primary = resolve(store, PRIMARY, candidates);
    expect(supersedes(primary)).toEqual([]);
    expect(groupForDocument(primary, A)!.status).toBe("conflict");

    const er = resolve(store, ER, candidates);
    expect(er.provisions.map((p) => p.documentId)).toEqual([B]);
    expect(er.groups).toEqual([{ documents: [B], status: "resolved", governing: [er.provisions[0].provisionId] }]);
  });

  it("a cycle in one scope does not decide or disturb another scope", () => {
    const docs = [versionDoc("X", "Y", 40, undefined, [line(40), PCP]), versionDoc("Y", "Z", 50), versionDoc("Z", "X", 60)];
    const provs = [
      ...docs.map((d, i) => ({ doc: d.id, line: line(40 + 10 * i), networkTier: "In-network" })),
      { doc: docs[0].id, line: PCP, networkTier: "In-network" },
    ];
    const { store } = build(docs, provs);
    const candidates = [cand("X", "Y"), cand("Y", "Z"), cand("Z", "X")];
    expect(resolve(store, SPECIALIST, candidates).groups[0].status).toBe("conflict");
    const primary = resolve(store, PRIMARY, candidates);
    expect(primary.groups).toHaveLength(1);
    expect(primary.groups[0]).toMatchObject({ documents: [docId("vx")], status: "resolved" });
  });
});
