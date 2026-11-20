// M7 agent H: exclusion-inventory completeness (EC-2 / EC-13). A coverage
// conclusion ("verified"/"conditional") is possible only when the inventory
// provably holds every exclusion the document states. Synthetic, invented
// documents only.
import { describe, expect, it } from "vitest";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { sealProvision } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { registryForSession } from "@/app/lib/evidence/session-evidence";
import { readabilityCoverageSource } from "@/app/lib/evidence/registry";
import { buildExclusionInventory } from "@/app/lib/evidence/exclusions/inventory";
import { proposeExclusions, sealExclusionProposals } from "@/app/lib/evidence/proposer/exclusions";
import { displayIssuedResolution, resolveServiceQuestion } from "@/app/lib/evidence/resolver/exclusion-resolver";
import { surfacesFor } from "@/app/lib/evidence/surfaces";
import { classifyPage, type PageReadability } from "@/app/lib/pdf/page-readability";
import type { ExclusionInventoryView } from "@/app/lib/evidence/surface-types";
import type { SessionEvidence } from "@/app/lib/evidence/session-evidence";

const SID = "sess-m7h-complete";
const DOC = "doc-c";
const BENEFIT = "Chiropractic visits: $30 copay.";

function scenario(pages: string[], options: { readability?: PageReadability[]; seal?: "all" | "none" | "skip-first" } = {}) {
  const readability = options.readability ?? pages.map((t, i) => classifyPage(i + 1, t, false));
  const docs = [{ documentId: DOC, pageCount: pages.length, pages, readability }];
  const plan = { planId: "plan-c", name: "Invented Care Gold", sources: [{ documentId: DOC, page: 1, quote: "Plan name: Invented Care Gold" }] };
  const registry = registryForSession(SID, docs, [plan], { coverageSource: readabilityCoverageSource(docs) });
  const authority = new EvidenceAuthority();
  const store = new ProvisionStore(SID, registry, authority);
  const doc = registry.get(DOC)!;
  const benefitPage = pages.findIndex((p) => p.includes(BENEFIT)) + 1;
  const accepted = store.accept(sealProvision(authority, {
    sessionId: SID, documentId: DOC, documentSha256: doc.sha256, kind: "benefit", claim: BENEFIT,
    plan: { planId: "plan-c", name: doc.plan!.name.value, nameSpan: { ...doc.plan!.name.span } },
    scope: {}, evidence: [{ documentId: DOC, page: benefitPage, quote: BENEFIT }],
  }));
  if (!accepted.ok) throw new Error(accepted.reason);
  const mode = options.seal ?? "all";
  if (mode === "all") sealExclusionProposals(store, authority, { otherPlanNames: [] });
  if (mode === "skip-first") {
    const { proposals } = proposeExclusions(doc, { sessionId: SID, otherPlanNames: [] });
    for (const content of proposals.slice(1)) store.accept(sealProvision(authority, content));
  }
  const ask = (service: string) => resolveServiceQuestion({ store, authority }, { documentId: DOC, service });
  const inventory = () => {
    const built = buildExclusionInventory(store, DOC);
    if (!built.ok) throw new Error(built.reason);
    return built.inventory;
  };
  return { store, authority, ask, inventory };
}

const COMPLETE = [
  "Plan name: Invented Care Gold\nSummary of benefits",
  `Covered Services\n${BENEFIT}\nExclusions\n• Cosmetic surgery\n• Long-term care\nClaims\nSubmit claims within 90 days.`,
];

describe("m7h inventory completeness", () => {
  it("fully sealed section + every page read → complete; a service no exclusion names, with a verified benefit, is verified", () => {
    const { ask, inventory, authority } = scenario(COMPLETE);
    expect(inventory().completeness).toEqual({ state: "complete", reason: expect.any(String), pages: [] });
    const issued = ask("chiropractic-care");
    expect(issued.resolution.outcome).toBe("verified");
    expect(displayIssuedResolution(authority, SID, issued).verdict).toBe("SUPPORTED");
  });

  it("a dropped candidate (cut by a page break) → partial naming its page → never covered", () => {
    const pages = [
      "Plan name: Invented Care Gold\nSummary of benefits",
      `Covered Services\n${BENEFIT}\nExclusions\n(1) Cosmetic surgery\n(2) Charges for treatment of the`,
      "conditions before coverage\n(3) Long-term care\nClaims\nSubmit claims within 90 days.",
    ];
    const { ask, inventory } = scenario(pages);
    const inv = inventory();
    expect(inv.completeness.state).toBe("partial");
    expect(inv.completeness.pages).toEqual([2]);
    expect(inv.exclusions.length).toBe(2);
    const outcome = ask("chiropractic-care").resolution.outcome;
    expect(["verified", "conditional"]).not.toContain(outcome);
    expect(outcome).toBe("undetermined");
  });

  it("a candidate the store does not hold → partial naming its page → never covered", () => {
    const { ask, inventory } = scenario(COMPLETE, { seal: "skip-first" });
    expect(inventory().completeness).toMatchObject({ state: "partial", pages: [2] });
    expect(ask("chiropractic-care").resolution.outcome).toBe("undetermined");
  });

  it("every candidate sealed but a page only partly read → partial naming that page → never covered", () => {
    const readability = COMPLETE.map((t, i) => classifyPage(i + 1, t, false));
    readability[0] = classifyPage(1, COMPLETE[0], true); // sparse page with images
    const { ask, inventory } = scenario(COMPLETE, { readability });
    expect(inventory().completeness).toMatchObject({ state: "partial", pages: [1] });
    expect(ask("chiropractic-care").resolution.outcome).toBe("undetermined");
  });

  it("no exclusion section found → unknown → never covered", () => {
    const pages = ["Plan name: Invented Care Gold\nSummary of benefits", `Covered Services\n${BENEFIT}\nClaims\nSubmit claims within 90 days.`];
    const { ask, inventory } = scenario(pages);
    expect(inventory().completeness).toMatchObject({ state: "unknown", pages: [] });
    expect(ask("chiropractic-care").resolution.outcome).toBe("undetermined");
  });

  it("a document that declares another plan → unknown (exclusions not bound) → never covered", () => {
    const { ask, inventory } = scenario([...COMPLETE, "Plan name: Invented Care Platinum\nRates"]);
    expect(inventory().exclusions).toHaveLength(0);
    expect(inventory().completeness.state).toBe("unknown");
    expect(ask("chiropractic-care").resolution.outcome).toBe("undetermined");
  });

  it("an applying sealed exclusion still concludes exclusion_applies on a partial inventory", () => {
    const { ask, inventory } = scenario(COMPLETE, { seal: "skip-first" });
    expect(inventory().completeness.state).toBe("partial");
    expect(ask("long-term-care").resolution.outcome).toBe("exclusion_applies");
  });

  it("completeness cannot be declared by a caller", () => {
    const { store, authority, ask } = scenario(COMPLETE, { seal: "skip-first" });
    const declared = { completeness: { state: "complete", reason: "caller", pages: [] } };
    const built = (buildExclusionInventory as (...a: unknown[]) => ReturnType<typeof buildExclusionInventory>)(store, DOC, declared);
    expect(built.ok && built.inventory.completeness.state).toBe("partial");
    const question = { documentId: DOC, service: "chiropractic-care", ...declared } as unknown as Parameters<typeof resolveServiceQuestion>[1];
    expect(resolveServiceQuestion({ store, authority }, question).resolution.outcome).not.toBe("verified");
    expect(ask("chiropractic-care").resolution.outcome).toBe("undetermined");
  });

  it("the surface shows a partial inventory with the affected page named", () => {
    const { store, authority } = scenario(COMPLETE, { seal: "skip-first" });
    const evidence = { authority, registry: store.registry, store, provisionIdsByRow: [], rows: [], provisionSubjects: {}, exclusionProposals: [] } as unknown as SessionEvidence;
    const view = surfacesFor(evidence, SID).exclusions[0] as ExclusionInventoryView;
    expect(view).toMatchObject({ kind: "exclusion-inventory", coverage: "partial", pagesNotRead: [2], itemsNotSealedPages: [2] });
  });
});
