// M7 agent D: exclusion inventory (EC-13) and C2 applicability resolver.
// Synthetic text only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { buildExclusionInventory } from "@/app/lib/evidence/exclusions/inventory";
import type { SealedProvision } from "@/app/lib/evidence/provision";
import {
  EXCLUSION_RESOLVER_ISSUER,
  classifyExclusion,
  displayIssuedResolution,
  resolveServiceQuestion,
} from "@/app/lib/evidence/resolver/exclusion-resolver";
import { HEALTH_MATERIALITY_MAP_V1 } from "@/app/lib/evidence/resolver/health-materiality";
import { checkMaterialityMap, type MaterialityMap } from "@/app/lib/evidence/resolver/materiality";
import { displayVerdictFor } from "@/app/lib/evidence/verdict-mapping";
import { M7D_PAGES, exclusionScenario, provisionContent } from "../integration/m7d-trust-fixtures";

const MAP = HEALTH_MATERIALITY_MAP_V1;
const exclusion = (claim: string, extra: Partial<SealedProvision> = {}): SealedProvision =>
  ({ ...provisionContent("exclusion", 3, claim), provisionId: "prov-x", seal: { v: 1, purpose: "provision", digest: "", mac: "" }, ...extra }) as SealedProvision;
const classify = (service: string, claim: string, extra: Partial<SealedProvision> = {}) =>
  classifyExclusion(MAP, service, exclusion(claim, extra));

describe("m7d exclusion inventory (EC-13 source binding)", () => {
  it("lists exactly the sealed exclusion provisions of the document, ordered, frozen", () => {
    const { store, documentId } = exclusionScenario();
    const res = buildExclusionInventory(store, documentId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sealed = store.listByKind("exclusion", { documentId }).map((p) => p.provisionId).sort();
    expect(res.inventory.exclusions.map((p) => p.provisionId)).toEqual(sealed);
    expect(res.inventory.exclusions.every((p) => p.kind === "exclusion")).toBe(true);
    expect(res.inventory.integrity).toBe("intact");
    expect(res.inventory.planId).toBe("plan-sample");
    expect(Object.isFrozen(res.inventory)).toBe(true);
    expect(Object.isFrozen(res.inventory.exclusions)).toBe(true);
  });

  it.each([
    ["complete", "complete", [1, 2, 3], []],
    ["partial", "partial", [1, 2], [3]],
    ["none", "unknown", [], []],
  ] as const)("coverage %s → %s (only from the registry record)", (mode, state, read, unread) => {
    const { store, documentId } = exclusionScenario({ coverage: mode });
    const res = buildExclusionInventory(store, documentId);
    expect(res.ok && res.inventory.coverage).toEqual({ state, readPages: read, unreadPages: unread });
  });

  it("refuses an unregistered document and lists nothing from other documents", () => {
    const { store } = exclusionScenario();
    expect(buildExclusionInventory(store, "sess-m7d--other")).toMatchObject({ ok: false });
  });

  it("an empty store yields an empty inventory, never a complete 'no exclusions' claim by itself", () => {
    const { store, authority, documentId } = exclusionScenario({ coverage: "none", provisions: [] });
    const res = buildExclusionInventory(store, documentId);
    expect(res.ok && res.inventory.exclusions).toEqual([]);
    expect(res.ok && res.inventory.coverage.state).toBe("unknown");
    const issued = resolveServiceQuestion({ store, authority }, { documentId, service: "acupuncture" });
    expect(issued.resolution.outcome).toBe("undetermined");
  });
});

describe("m7d exclusion classification (materiality map rules)", () => {
  it.each<[string, string, string, string]>([
    ["acupuncture", "Acupuncture is not covered.", "applies_verified", "names_service"],
    ["chiropractic-care", "Acupuncture is not covered.", "unrelated", "names_other_concepts"],
    ["acupuncture", "Services that are not medically necessary are not covered.", "unresolved_material", "unclassified"],
    ["acupuncture", "Acupuncture is not covered when performed for weight loss.", "unresolved_material", "circumstantial"],
    ["hearing-aids", "Hearing aids are not covered beyond one pair every three years.", "unresolved_material", "circumstantial"],
    ["cosmetic-surgery", "Cosmetic surgery is not covered, except reconstructive surgery.", "unresolved_material", "circumstantial"],
    ["reconstructive-surgery", "Cosmetic surgery is not covered, except reconstructive surgery.", "not_applicable_conditional", "carve_out"],
    ["surgery", "Cosmetic surgery is not covered.", "unresolved_material", "overlapping"],
    ["reconstructive-surgery", "Cosmetic surgery is not covered. This exclusion does not apply to reconstructive surgery.", "not_applicable_verified", "express_override"],
    ["reconstructive-surgery", "Cosmetic surgery is not covered. This exclusion does not apply to reconstructive surgery after an accident.", "not_applicable_conditional", "express_override"],
    ["acupuncture", "Acupuncture is not covered. This exclusion does not apply to acupuncture.", "unresolved_material", "overlapping"],
    ["teleportation", "Acupuncture is not covered.", "unresolved_material", "unmapped_service"],
  ])("%s vs %j → %s (%s)", (service, claim, status, basis) => {
    expect(classify(service, claim)).toEqual({ status, basis });
  });

  it("an exclusion scoped to a tier never applies outright", () => {
    const scoped = { scope: { planTier: { value: "Bronze", evidence: { documentId: "d", page: 1, quote: "Bronze" } } } };
    expect(classify("acupuncture", "Acupuncture is not covered.", scoped)).toEqual({ status: "unresolved_material", basis: "scoped" });
  });

  it("an override counts only when stated in the sealed provision's own text", () => {
    // Override phrase absent from claim and evidence → the exclusion applies.
    expect(classify("acupuncture", "Acupuncture is not covered.").status).toBe("applies_verified");
    // Override present in the sealed evidence quote (verbatim) → honoured.
    const withNote = exclusion("Cosmetic surgery is not covered.", {
      evidence: [{ documentId: "d", page: 3, quote: "Cosmetic surgery is not covered. This exclusion does not apply to reconstructive surgery." }],
    });
    expect(classifyExclusion(MAP, "reconstructive-surgery", withNote).basis).toBe("express_override");
  });
});

describe("m7d applicability resolver outcomes", () => {
  it("considers every inventory exclusion and issues under the request authority", () => {
    const { store, authority, sessionId, documentId } = exclusionScenario();
    const issued = resolveServiceQuestion({ store, authority }, { documentId, service: "chiropractic-care" });
    expect(issued.meta).toEqual({ sessionId, issuer: EXCLUSION_RESOLVER_ISSUER });
    expect(issued.resolution.assessments.map((a) => a.provisionId).sort())
      .toEqual(store.listByKind("exclusion", { documentId }).map((p) => p.provisionId).sort());
    expect(issued.resolution.outcome).toBe("verified");
    expect(issued.resolution.materialityMap).toBe(MAP.version);
    expect(displayIssuedResolution(authority, sessionId, issued)).toMatchObject({ confirmed: true, verdict: "SUPPORTED" });
  });

  it("an applying exclusion maps through the single table only", () => {
    const { store, authority, sessionId, documentId } = exclusionScenario();
    const issued = resolveServiceQuestion({ store, authority }, { documentId, service: "acupuncture" });
    expect(issued.resolution.outcome).toBe("exclusion_applies");
    expect(issued.resolution.citedProvisionIds).toHaveLength(1);
    expect(displayIssuedResolution(authority, sessionId, issued).verdict).toBe(displayVerdictFor("exclusion_applies"));
  });

  it("one unclassified exclusion makes every question undetermined (fail closed)", () => {
    const { store, authority, documentId } = exclusionScenario({
      provisions: [
        provisionContent("benefit", 2, "Chiropractic visits: $30 copay."),
        provisionContent("exclusion", 3, "Services that are not medically necessary are not covered."),
      ],
    });
    const issued = resolveServiceQuestion({ store, authority }, { documentId, service: "chiropractic-care" });
    expect(issued.resolution.outcome).toBe("undetermined");
  });

  it.each(["partial", "none"] as const)("coverage %s: no conclusion past unread pages", (coverage) => {
    const { store, authority, documentId } = exclusionScenario({ coverage });
    expect(resolveServiceQuestion({ store, authority }, { documentId, service: "chiropractic-care" }).resolution.outcome).toBe("undetermined");
  });

  it("no benefit naming the service with every page read → not found in read pages (NOT STATED)", () => {
    const { store, authority, sessionId, documentId } = exclusionScenario();
    const issued = resolveServiceQuestion({ store, authority }, { documentId, service: "hearing-aids" });
    expect(issued.resolution.outcome).toBe("not_found_in_read_pages");
    expect(displayIssuedResolution(authority, sessionId, issued).verdict).toBe("NOT STATED");
  });

  it("a missing exclusion never produces a negative verdict or wording on any layer", () => {
    for (const coverage of ["complete", "partial", "none"] as const) {
      const { store, authority, sessionId, documentId } = exclusionScenario({
        coverage,
        provisions: [provisionContent("benefit", 2, "Chiropractic visits: $30 copay.")],
      });
      for (const service of ["chiropractic-care", "hearing-aids", "acupuncture", "teleportation"]) {
        const issued = resolveServiceQuestion({ store, authority }, { documentId, service });
        expect(issued.resolution.outcome).not.toBe("exclusion_applies");
        const shown = displayIssuedResolution(authority, sessionId, issued);
        expect(shown.verdict).not.toBe("DOES NOT APPEAR TO FIT");
        expect(JSON.stringify(issued.resolution)).not.toMatch(/\bno\b|not covered|not eligible|excluded/i);
      }
    }
  });

  it("caller proposals can only make an assessment more cautious", () => {
    const { store, authority, documentId } = exclusionScenario();
    const cosmetic = store.listByKind("exclusion", { documentId }).find((p) => p.claim.startsWith("Cosmetic"))!;
    const marked = resolveServiceQuestion({ store, authority }, {
      documentId, service: "chiropractic-care", proposals: [{ provisionId: cosmetic.provisionId, status: "applies_verified" }],
    });
    expect(marked.resolution.assessments.find((a) => a.provisionId === cosmetic.provisionId))
      .toEqual({ provisionId: cosmetic.provisionId, status: "unresolved_material", basis: "caller_supplied" });
    expect(marked.resolution.outcome).toBe("undetermined");
    for (const proposals of [[{ provisionId: "prov-invented", status: "unrelated" }], "unrelated", [null]]) {
      expect(resolveServiceQuestion({ store, authority }, { documentId, service: "chiropractic-care", proposals }).resolution.outcome)
        .toBe("undetermined");
    }
  });

  it("an unregistered document is issued as cannot be confirmed", () => {
    const { store, authority, sessionId } = exclusionScenario();
    const issued = resolveServiceQuestion({ store, authority }, { documentId: "sess-m7d--ghost", service: "acupuncture" });
    expect(issued.resolution.outcome).toBe("cannot_be_confirmed");
    expect(displayIssuedResolution(authority, sessionId, issued).verdict).toBe("NEEDS VERIFICATION");
  });

  it("refuses to issue under an authority that is not the store's", () => {
    const { store, documentId } = exclusionScenario();
    expect(() => resolveServiceQuestion({ store, authority: new EvidenceAuthority() }, { documentId, service: "acupuncture" })).toThrow(/authority/);
  });

  it("a resolution from another resolver is not rendered as a conclusion", async () => {
    const { issueResolution } = await import("@/app/lib/evidence/issued");
    const { store, authority, sessionId, documentId } = exclusionScenario();
    const genuine = resolveServiceQuestion({ store, authority }, { documentId, service: "chiropractic-care" });
    const other = issueResolution(authority, genuine.resolution, { sessionId, issuer: "other@1" });
    expect(displayIssuedResolution(authority, sessionId, other)).toMatchObject({ confirmed: false, verdict: "NEEDS VERIFICATION" });
  });
});

describe("m7d materiality map is versioned adapter data", () => {
  it("the default map validates and malformed maps are refused", () => {
    expect(checkMaterialityMap(MAP)).toEqual({ ok: true });
    const bad: MaterialityMap = { ...MAP, concepts: [...MAP.concepts, { id: "acupuncture", terms: ["x"] }] };
    expect(checkMaterialityMap(bad).ok).toBe(false);
    expect(checkMaterialityMap({ ...MAP, version: "" }).ok).toBe(false);
    const { store, authority, documentId } = exclusionScenario();
    expect(() => resolveServiceQuestion({ store, authority, map: bad }, { documentId, service: "acupuncture" })).toThrow();
  });

  it("the core resolver, matcher and inventory carry no domain word lists", () => {
    const core = ["app/lib/evidence/resolver/exclusion-resolver.ts", "app/lib/evidence/resolver/materiality.ts", "app/lib/evidence/exclusions/inventory.ts"]
      .map((f) => readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""))
      .join("\n");
    for (const term of MAP.concepts.flatMap((c) => c.terms)) expect(core.toLowerCase()).not.toContain(`"${term.toLowerCase()}"`);
    expect(M7D_PAGES.join(" ")).toContain("Acupuncture");
  });

  it("another domain's map works through the same core", () => {
    const petMap: MaterialityMap = {
      version: "pet-test@1",
      concepts: [{ id: "grooming", terms: ["grooming"] }],
      carveOutMarkers: ["except"],
      circumstantialMarkers: ["if"],
      expressOverrideMarkers: ["does not apply to"],
    };
    expect(classifyExclusion(petMap, "grooming", exclusion("Grooming is not covered."))).toEqual({ status: "applies_verified", basis: "names_service" });
  });
});
