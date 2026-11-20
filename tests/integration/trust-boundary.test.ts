// Required trust-boundary acceptance tests TB-1..TB-4 (docs/evidence-core.md §5).
// They stay `it.todo` until roadmap M7 builds the exclusion inventory,
// applicability resolver and sealed provision store in application code.
// The ADR-003.2 reference implementation does NOT satisfy them. When made
// real, each must run against application code, and each must also fail
// when its guard is removed. Titles carry the exact "Attack" and
// "Must hold" text from the specification; do not paraphrase them.
import { describe, it } from "vitest";

describe("trust boundary (evidence-core.md §5, INV-EC-09 source binding)", () => {
  it.todo(
    "TB-1 — Attack: Provision with plan-name and period evidence not bound to real source blocks — Must hold: Persisting it is refused; nothing is stored",
  );
  it(
    'TB-2 — Attack: Caller-built "not applicable" assessment for an exclusion that names the service — Must hold: Conclusion is never covered',
    async ({ expect }) => {
      const { exclusionScenario } = await import("./m7d-trust-fixtures");
      const { resolveServiceQuestion, displayIssuedResolution } = await import("@/app/lib/evidence/resolver/exclusion-resolver");
      const { issueResolution } = await import("@/app/lib/evidence/issued");
      const { EvidenceAuthority } = await import("@/app/lib/evidence/canonical");
      const { store, authority, sessionId, documentId } = exclusionScenario({ coverage: "complete" });
      const naming = store.listByKind("exclusion", { documentId }).find((p) => p.claim === "Acupuncture is not covered.")!;
      expect(naming).toBeDefined();
      const covered = (outcome: string, verdict: string) =>
        outcome === "verified" || outcome === "conditional" || verdict === "SUPPORTED";

      // Attack A: caller-built "not applicable" assessments handed to the resolver.
      for (const status of ["not_applicable_verified", "not_applicable_conditional", "unrelated"]) {
        const issued = resolveServiceQuestion({ store, authority }, {
          documentId, service: "acupuncture", proposals: [{ provisionId: naming.provisionId, status }],
        });
        const shown = displayIssuedResolution(authority, sessionId, issued);
        expect(shown.confirmed).toBe(true);
        expect(covered(issued.resolution.outcome, shown.verdict)).toBe(false);
        expect(issued.resolution.outcome).toBe("exclusion_applies");
        expect(issued.resolution.assessments.find((a) => a.provisionId === naming.provisionId)?.status).toBe("applies_verified");
      }

      // Attack B: a caller-built resolution presented to a rendering surface.
      const genuine = resolveServiceQuestion({ store, authority }, { documentId, service: "acupuncture" });
      const notApplicable = {
        ...genuine.resolution,
        outcome: "verified",
        assessments: genuine.resolution.assessments.map((a) => ({ ...a, status: "not_applicable_verified" })),
      };
      for (const forged of [
        { ...genuine, resolution: notApplicable },
        notApplicable,
        issueResolution(new EvidenceAuthority(), notApplicable, genuine.meta),
        JSON.parse(JSON.stringify(issueResolution(new EvidenceAuthority(), notApplicable, genuine.meta))),
      ]) {
        const shown = displayIssuedResolution(authority, sessionId, forged);
        expect(shown.confirmed).toBe(false);
        expect(shown.verdict).not.toBe("SUPPORTED");
      }
    },
  );
  it.todo(
    'TB-3 — Attack: Resolution altered after issue, shown on comparison view, chat answer and export — Must hold: Each surface shows "cannot be confirmed"',
  );
  it(
    "TB-4 — Attack: Exclusion coverage declared complete with an empty or partial exclusion list, while verified evidence contains an exclusion naming the service — Must hold: Conclusion is never covered; the inventory equals the sealed exclusion provisions",
    async ({ expect }) => {
      const { exclusionScenario } = await import("./m7d-trust-fixtures");
      const { resolveServiceQuestion, displayIssuedResolution } = await import("@/app/lib/evidence/resolver/exclusion-resolver");
      const { buildExclusionInventory } = await import("@/app/lib/evidence/exclusions/inventory");
      type Question = Parameters<typeof resolveServiceQuestion>[1];
      for (const coverage of ["complete", "partial", "none"] as const) {
        const { store, authority, sessionId, documentId } = exclusionScenario({ coverage });
        const sealed = store.listByKind("exclusion", { documentId }).map((p) => p.provisionId).sort();
        const naming = store.listByKind("exclusion", { documentId }).find((p) => p.claim === "Acupuncture is not covered.")!;
        const other = sealed.filter((id) => id !== naming.provisionId);
        expect(sealed).toHaveLength(2);
        const declarations = [
          { exclusionIds: [], exclusionCoverageComplete: true },
          { exclusionIds: other, exclusionCoverageComplete: true },
          { inventory: { documentId, exclusions: [], coverage: { state: "complete", readPages: [1, 2, 3], unreadPages: [] }, integrity: "intact" } },
          { inventory: { documentId, exclusions: store.list().filter((p) => other.includes(p.provisionId)), coverage: { state: "complete", readPages: [1, 2, 3], unreadPages: [] }, integrity: "intact" } },
        ];
        for (const declaration of declarations) {
          const question = { documentId, service: "acupuncture", ...declaration } as unknown as Question;
          const issued = resolveServiceQuestion({ store, authority }, question);
          const shown = displayIssuedResolution(authority, sessionId, issued);
          expect(shown.confirmed).toBe(true);
          expect(["verified", "conditional"]).not.toContain(issued.resolution.outcome);
          expect(shown.verdict).not.toBe("SUPPORTED");
          expect(issued.resolution.outcome).toBe("exclusion_applies");
          expect([...issued.resolution.inventory.provisionIds].sort()).toEqual(sealed);
          // Inventory builder ignores any declaration passed alongside.
          const built = (buildExclusionInventory as (...a: unknown[]) => ReturnType<typeof buildExclusionInventory>)(store, documentId, declaration);
          expect(built.ok && built.inventory.exclusions.map((p) => p.provisionId).sort()).toEqual(sealed);
          expect(built.ok && built.inventory.coverage.state).toBe(coverage === "none" ? "unknown" : coverage);
          // Coverage cannot be declared complete: without a complete record,
          // a service no exclusion names is still never concluded as covered.
          const chiro = resolveServiceQuestion({ store, authority }, { ...question, service: "chiropractic-care" } as Question);
          if (coverage === "complete") expect(chiro.resolution.outcome).toBe("verified");
          else expect(chiro.resolution.outcome).toBe("undetermined");
        }
      }
    },
  );
});
