// Phase-1 contracts for the evidence core: canonical seals, session document
// registry, sealed provisions + ProvisionStore, Issued<Resolution>, and the
// C-1 verdict mapping. Synthetic fixtures only (no real-PDF text).
import { describe, expect, it } from "vitest";
import { EvidenceAuthority, canonicalJson, sha256Hex } from "@/app/lib/evidence/canonical";
import { SessionDocumentRegistry, type VerifiedPlanIdentity } from "@/app/lib/evidence/registry";
import type { PageCoverageRecord } from "@/app/lib/evidence/page-coverage";
import { allPagesRead, readPages } from "@/app/lib/evidence/page-coverage";
import { sealProvision, provisionSealIntact, type ProvisionContent, type SealedProvision } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { CANNOT_BE_CONFIRMED, checkIssued, issueResolution } from "@/app/lib/evidence/issued";
import {
  ABSENCE_OUTCOMES,
  APPLICABILITY_STATUSES,
  OUTCOME_STATUSES,
  OUTCOME_TO_VERDICT,
  displayVerdictFor,
} from "@/app/lib/evidence/verdict-mapping";
import { VERDICTS } from "@/app/lib/verdicts";

const SESSION = "sess-m7b";
const DOC = `${SESSION}--doc1`;
const PAGE1 = "Plan name: Example Health Silver\nPlan year: January 1, 2026 through December 31, 2026\nIssued by Example Mutual";
const PAGE2 = "Exclusions\nCosmetic surgery is not covered.\nIn-network specialist visit: $40 copay after deductible.\nCoverage period: March 1, 2026 to June 30, 2026\nExtended period: March 1, 2026 to June 30, 2027";
const BYTES = new TextEncoder().encode("%PDF-synthetic-m7b");

function span(page: number, text: string) {
  const source = page === 1 ? PAGE1 : PAGE2;
  const start = source.indexOf(text);
  if (start < 0) throw new Error("fixture span missing");
  return { documentId: DOC, page, start, end: start + text.length, text };
}

function planIdentity(): VerifiedPlanIdentity {
  return {
    planId: "plan-example",
    name: { value: "Example Health Silver", span: span(1, "Plan name: Example Health Silver") },
    period: { start: "2026-01-01", end: "2026-12-31", span: span(1, "Plan year: January 1, 2026 through December 31, 2026") },
  };
}

function registry(options: ConstructorParameters<typeof SessionDocumentRegistry>[1] = {}) {
  const r = new SessionDocumentRegistry(SESSION, options);
  const res = r.register({ sessionId: SESSION, documentId: DOC, bytes: BYTES, pages: [PAGE1, PAGE2], plan: planIdentity() });
  expect(res.ok).toBe(true);
  return r;
}

function content(overrides: Partial<ProvisionContent> = {}): ProvisionContent {
  return {
    sessionId: SESSION,
    documentId: DOC,
    documentSha256: sha256Hex(BYTES),
    kind: "exclusion",
    claim: "Cosmetic surgery is not covered.",
    plan: { planId: "plan-example", name: "Example Health Silver", nameSpan: span(1, "Plan name: Example Health Silver") },
    scope: {},
    evidence: [{ documentId: DOC, page: 2, quote: "Cosmetic surgery is not covered." }],
    ...overrides,
  };
}

function setup() {
  const authority = new EvidenceAuthority();
  const reg = registry();
  const store = new ProvisionStore(SESSION, reg, authority);
  return { authority, reg, store };
}

describe("m7b canonical seals", () => {
  it("encodes deterministically regardless of key order and omits undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe(canonicalJson({ a: { d: 2 }, b: 1 }));
  });

  it("verifies only unchanged content under the issuing authority and purpose", () => {
    const a = new EvidenceAuthority();
    const seal = a.seal("provision", { x: 1 });
    expect(a.verify("provision", { x: 1 }, seal)).toBe(true);
    expect(a.verify("provision", { x: 2 }, seal)).toBe(false);
    expect(a.verify("resolution", { x: 1 }, seal)).toBe(false);
    expect(new EvidenceAuthority().verify("provision", { x: 1 }, seal)).toBe(false);
    expect(a.verify("provision", { x: 1 }, { ...seal, mac: "00" })).toBe(false);
  });
});

describe("m7b session document registry", () => {
  it("registers identity: sha256 of bytes, page count, plan bound to exact spans", () => {
    const doc = registry().get(DOC)!;
    expect(doc.sha256).toBe(sha256Hex(BYTES));
    expect(doc.pageCount).toBe(2);
    expect(doc.plan?.name.value).toBe("Example Health Silver");
    expect(Object.isFrozen(doc.plan?.name.span)).toBe(true);
  });

  it.each([
    ["foreign session", { sessionId: "other" }],
    ["sha256 not matching bytes", { sha256: "a".repeat(64) }],
    ["no sha256 or bytes", { bytes: undefined }],
    ["plan name span at wrong offsets", { plan: { ...planIdentity(), name: { value: "Example Health Silver", span: { ...span(1, "Plan name: Example Health Silver"), start: 1 } } } }],
    ["plan name not stated by its span", { plan: { ...planIdentity(), name: { value: "Other Plan Gold", span: span(1, "Plan name: Example Health Silver") } } }],
    ["fabricated span text", { plan: { ...planIdentity(), name: { value: "Fake Plan", span: { documentId: DOC, page: 1, start: 0, end: 20, text: "Plan name: Fake Plan" } } } }],
    ["period year not in its span", { plan: { ...planIdentity(), period: { start: "2027-01-01", end: "2027-12-31", span: span(1, "Plan year: January 1, 2026 through December 31, 2026") } } }],
  ])("refuses %s and stores nothing", (_name, override) => {
    const r = new SessionDocumentRegistry(SESSION);
    const res = r.register({ sessionId: SESSION, documentId: DOC, bytes: BYTES, pages: [PAGE1, PAGE2], plan: planIdentity(), ...override });
    expect(res.ok).toBe(false);
    expect(r.get(DOC)).toBeUndefined();
    expect(r.list()).toEqual([]);
  });

  it("attaches page coverage only through the adapter and only when consistent", () => {
    const record = (pages: PageCoverageRecord["pages"]): PageCoverageRecord => ({
      sessionId: SESSION, documentId: DOC, documentSha256: sha256Hex(BYTES), pageCount: 2, pages, producer: "test@1",
    });
    const good = registry({ coverageSource: { coverageFor: () => record([{ page: 1, status: "read" }, { page: 2, status: "unreadable", reason: "image" }]) } });
    expect(readPages(good.coverage(DOC))).toEqual([1]);
    expect(allPagesRead(good.coverage(DOC))).toBe(false);
    expect(allPagesRead(undefined)).toBe(false);

    const r = new SessionDocumentRegistry(SESSION, { coverageSource: { coverageFor: () => record([{ page: 1, status: "read" }]) } });
    expect(r.register({ sessionId: SESSION, documentId: DOC, bytes: BYTES, pages: [PAGE1, PAGE2] }).ok).toBe(false);
    const empty = new SessionDocumentRegistry(SESSION, { coverageSource: { coverageFor: () => record([{ page: 1, status: "read" }, { page: 2, status: "read" }]) } });
    expect(empty.register({ sessionId: SESSION, documentId: DOC, bytes: BYTES, pages: [PAGE1, "   "] }).ok).toBe(false);
  });
});

describe("m7b ProvisionStore admission (TB-1 contract)", () => {
  it("accepts a sealed, unchanged, re-verifying provision and lists it by document and kind", () => {
    const { authority, store } = setup();
    const res = store.accept(sealProvision(authority, content()));
    expect(res.ok).toBe(true);
    expect(store.listByDocument(DOC)).toHaveLength(1);
    expect(store.listByKind("exclusion")).toHaveLength(1);
    expect(store.listByKind("exclusion", { documentId: "nope" })).toHaveLength(0);
    expect(store.listByKind("benefit")).toHaveLength(0);
    expect(Object.isFrozen(store.list()[0].evidence[0])).toBe(true);
  });

  it("accepts scope values and a period that are source-bound", () => {
    const { authority, store } = setup();
    const res = store.accept(sealProvision(authority, content({
      kind: "cost_share",
      claim: "In-network specialist visit: $40 copay after deductible.",
      evidence: [{ documentId: DOC, page: 2, quote: "In-network specialist visit: $40 copay after deductible." }],
      scope: { networkTier: { value: "In-network", evidence: { documentId: DOC, page: 2, quote: "In-network specialist visit: $40 copay after deductible." } } },
      period: { start: "2026-03-01", end: "2026-06-30", span: span(2, "Coverage period: March 1, 2026 to June 30, 2026") },
    })));
    expect(res).toMatchObject({ ok: true });
  });

  const seal = (a: EvidenceAuthority, o: Partial<ProvisionContent>) => sealProvision(a, content(o));
  const refusals: [string, string, (a: EvidenceAuthority) => unknown][] = [
    ["unsealed draft", "not sealed", () => content()],
    ["sealed by another authority", "not sealed", () => sealProvision(new EvidenceAuthority(), content())],
    ["claim altered after sealing", "altered", (a) => ({ ...sealProvision(a, content()), claim: "Cosmetic surgery is covered." })],
    ["field added after sealing", "altered", (a) => ({ ...sealProvision(a, content()), verdict: "SUPPORTED" })],
    ["provisionId changed", "altered", (a) => ({ ...sealProvision(a, content()), provisionId: "prov-chosen" })],
    ["foreign session", "session mismatch", (a) => seal(a, { sessionId: "other" })],
    ["unregistered document", "not registered", (a) => seal(a, { documentId: "other--doc" })],
    ["different document bytes", "registered document bytes", (a) => seal(a, { documentSha256: "b".repeat(64) })],
    ["another plan id", "verified plan", (a) => seal(a, { plan: { ...content().plan, planId: "plan-other" } })],
    ["plan-name evidence not bound to a real source block", "plan-name evidence not bound", (a) => seal(a, { plan: { planId: "plan-example", name: "Example Health Silver", nameSpan: { documentId: DOC, page: 2, start: 0, end: 21, text: "Example Health Silver" } } })],
    ["evidence quote not on its page", "re-verify", (a) => seal(a, { evidence: [{ documentId: DOC, page: 1, quote: "Cosmetic surgery is not covered." }] })],
    ["paraphrased evidence", "re-verify", (a) => seal(a, { evidence: [{ documentId: DOC, page: 2, quote: "Cosmetic surgery isn't covered." }] })],
    ["no evidence", "evidence required", (a) => seal(a, { evidence: [] })],
    ["exclusion claim not verbatim", "not verbatim", (a) => seal(a, { claim: "Cosmetic procedures excluded." })],
    ["scope value not stated by its evidence", "scope value not stated", (a) => seal(a, { scope: { planTier: { value: "Gold", evidence: { documentId: DOC, page: 2, quote: "Cosmetic surgery is not covered." } } } })],
    ["period evidence not bound to a real source block", "period evidence not bound", (a) => seal(a, { period: { start: "2026-03-01", end: "2026-06-30", span: { documentId: DOC, page: 2, start: 0, end: 10, text: "March 2026" } } })],
    ["period outside the document period", "outside the document", (a) => seal(a, { period: { start: "2026-03-01", end: "2027-06-30", span: span(2, "Extended period: March 1, 2026 to June 30, 2027") } })],
  ];

  it.each(refusals)("refuses %s (%s) and stores nothing", (_name, reason, build) => {
    const { authority, store } = setup();
    const res = store.accept(build(authority));
    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? "" : res.reason).toContain(reason);
    expect(store.list()).toEqual([]);
  });

  it("acceptAll is atomic: one bad provision stores none", () => {
    const { authority, store } = setup();
    const res = store.acceptAll([sealProvision(authority, content()), { ...sealProvision(authority, content()), claim: "x" }]);
    expect(res).toMatchObject({ ok: false, index: 1 });
    expect(store.list()).toEqual([]);
  });

  it("stored copies are isolated from later caller mutation", () => {
    const { authority, store } = setup();
    const sealed = sealProvision(authority, content()) as SealedProvision;
    store.accept(sealed);
    sealed.evidence[0].quote = "changed";
    expect(store.list()[0].evidence[0].quote).toBe("Cosmetic surgery is not covered.");
    expect(provisionSealIntact(authority, sealed)).toBe(false);
  });

  it("issuesUnder confirms only the store's own authority", () => {
    const { authority, store } = setup();
    expect(store.issuesUnder(authority)).toBe(true);
    expect(store.issuesUnder(new EvidenceAuthority())).toBe(false);
  });

  it("refuses a registry from another session", () => {
    expect(() => new ProvisionStore("other", registry(), new EvidenceAuthority())).toThrow();
  });
});

describe("m7b Issued<Resolution> (AT-PERSIST contract)", () => {
  const resolution = { outcome: "exclusion_applies", provisionIds: ["prov-1"] };

  it("confirms an unaltered resolution issued for this session", () => {
    const a = new EvidenceAuthority();
    const issued = issueResolution(a, resolution, { sessionId: SESSION, issuer: "test@1" });
    expect(checkIssued(a, SESSION, issued)).toMatchObject({ status: "confirmed", resolution });
    expect(checkIssued(a, SESSION, JSON.parse(JSON.stringify(issued)))).toMatchObject({ status: "confirmed" });
  });

  it.each<[string, (a: EvidenceAuthority) => unknown]>([
    ["altered resolution", (a) => { const i = issueResolution(a, resolution, { sessionId: SESSION, issuer: "t" }); return { ...i, resolution: { ...i.resolution, outcome: "verified" } }; }],
    ["altered meta", (a) => { const i = issueResolution(a, resolution, { sessionId: SESSION, issuer: "t" }); return { ...i, meta: { ...i.meta, issuer: "x" } }; }],
    ["other session", (a) => issueResolution(a, resolution, { sessionId: "other", issuer: "t" })],
    ["read back under another authority", () => JSON.parse(JSON.stringify(issueResolution(new EvidenceAuthority(), resolution, { sessionId: SESSION, issuer: "t" })))],
    ["extra field", (a) => ({ ...issueResolution(a, resolution, { sessionId: SESSION, issuer: "t" }), verdict: "SUPPORTED" })],
    ["never issued", () => ({ resolution, meta: { sessionId: SESSION, issuer: "t" }, seal: { v: 1, purpose: "resolution", digest: "", mac: "" } })],
    ["not an object", () => "SUPPORTED"],
  ])("shows %s as cannot be confirmed", (_name, build) => {
    const a = new EvidenceAuthority();
    const check = checkIssued(a, SESSION, build(a));
    expect(check.status).toBe("cannot_be_confirmed");
    expect(check).toMatchObject({ label: CANNOT_BE_CONFIRMED });
    expect(CANNOT_BE_CONFIRMED).toBe("cannot be confirmed");
  });

  it("caller mutation of the source object after issue does not alter the issued copy", () => {
    const a = new EvidenceAuthority();
    const src = { outcome: "verified" };
    const issued = issueResolution(a, src, { sessionId: SESSION, issuer: "t" });
    src.outcome = "conflict";
    expect(checkIssued(a, SESSION, issued)).toMatchObject({ status: "confirmed", resolution: { outcome: "verified" } });
  });
});

describe("m7b C-1 verdict mapping (one table)", () => {
  it("maps every internal outcome status to one of the five display verdicts", () => {
    expect(Object.keys(OUTCOME_TO_VERDICT).sort()).toEqual([...OUTCOME_STATUSES].sort());
    for (const s of OUTCOME_STATUSES) expect(VERDICTS).toContain(displayVerdictFor(s));
  });

  it("never maps absence or unconfirmable outcomes to a negative verdict", () => {
    for (const s of ABSENCE_OUTCOMES) {
      expect(displayVerdictFor(s)).not.toBe("DOES NOT APPEAR TO FIT");
      expect(["NOT STATED", "NEEDS VERIFICATION"]).toContain(displayVerdictFor(s));
    }
    expect(displayVerdictFor("not_found_in_read_pages")).toBe("NOT STATED");
    expect(displayVerdictFor("cannot_be_confirmed")).toBe("NEEDS VERIFICATION");
  });

  it("fails closed for unknown values and raw applicability statuses", () => {
    for (const s of [...APPLICABILITY_STATUSES, "no", "not_covered", "excluded", undefined, null]) {
      expect(displayVerdictFor(s)).toBe("NEEDS VERIFICATION");
    }
  });

  it("uses no forbidden display words", () => {
    for (const v of Object.values(OUTCOME_TO_VERDICT)) {
      expect(v).not.toMatch(/^(yes|no)$|not covered|not eligible|excluded/i);
    }
  });
});
