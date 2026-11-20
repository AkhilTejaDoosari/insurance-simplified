// M7 agent H: C1 exclusion proposer (document structure only). Synthetic,
// invented documents — no real-document content.
import { describe, expect, it } from "vitest";
import { sealVerifiedTable, type RegistrableDocument } from "@/app/lib/evidence/session-evidence";
import { scanExclusionSections } from "@/app/lib/evidence/proposer/exclusion-sections";
import { proposeExclusions } from "@/app/lib/evidence/proposer/exclusions";
import type { ComparisonTable, ProvenPlan } from "@/app/lib/extraction/types";

const SID = "sess-m7h";

function doc(id: string, pages: string[]): RegistrableDocument {
  return { documentId: id, pageCount: pages.length, pages };
}

function plan(name: string, ...docIds: string[]): ProvenPlan {
  return { planId: `plan-${name.toLowerCase().replace(/\W+/g, "-")}`, name, sources: docIds.map((documentId) => ({ documentId, page: 1, quote: `Plan name: ${name}` })) };
}

function table(docs: RegistrableDocument[], plans: ProvenPlan[]): ComparisonTable {
  return {
    schemaVersion: "v1",
    factListVersion: "test",
    documents: docs.map((d) => ({ documentId: d.documentId, filename: "synthetic.pdf", pageCount: d.pageCount })),
    plans,
    rows: [],
  } as unknown as ComparisonTable;
}

function sealed(docs: RegistrableDocument[], plans: ProvenPlan[]) {
  const ev = sealVerifiedTable(SID, docs, table(docs, plans));
  return { ev, exclusions: ev.store.listByKind("exclusion") };
}

const BULLETS = [
  "Plan name: Invented Care Gold\nSummary of benefits",
  "Covered services\nPhysical therapy: $20 copay\nServices Your Plan Generally Does NOT Cover (Check your plan document for more information.)\n• Cosmetic surgery\n• Long-term care\n• Weight loss programs that are\nnot medically supervised\n• Routine foot care\nOther Covered Services (Limitations may apply.)\n• Acupuncture\n• Hearing aids",
];

describe("m7h exclusion proposer: section by heading, items verbatim", () => {
  it("seals every bulleted item of the section, verbatim, and nothing after the next heading", () => {
    const d = doc("d1", BULLETS);
    const { ev, exclusions } = sealed([d], [plan("Invented Care Gold", "d1")]);
    expect(exclusions.map((p) => p.claim).sort()).toEqual(["Cosmetic surgery", "Long-term care", "Routine foot care", "Weight loss programs that are not medically supervised"]);
    for (const p of exclusions) {
      expect(p.evidence).toHaveLength(1);
      const e = p.evidence[0];
      expect(e.page).toBe(2);
      expect(BULLETS[1].includes(e.quote)).toBe(true);
      expect(p.claim).toBe(e.quote.replace(/\s+/g, " "));
      expect(p.plan.planId).toBe("plan-invented-care-gold");
    }
    expect(exclusions.some((p) => /Acupuncture|Hearing/.test(p.claim))).toBe(false);
    expect(ev.exclusionProposals[0]).toMatchObject({ sectionsFound: 1, proposed: 4, accepted: 4, refused: 0 });
  });

  it("reads an inline enumerated section across a page break with a running footer; a cut item is dropped and counted", () => {
    const footer = "Invented Mutual policy form 12";
    const pages = [
      `Plan name: Invented Travel Plus\nCertificate wording\n${footer.replace("12", "1")}`,
      `Q. EXCLUSIONS: Except as stated in the schedule, the following are excluded from coverage:\n(1) Charges for cosmetic treatment\n(2) Charges for dental care unless caused by an accident\n(3) Charges for the treatment of\n${footer.replace("12", "2")}`,
      `${footer.replace("12", "3")}\nconditions arising before coverage\n(4) Charges for experimental treatment\n(5) Charges for custodial care\nR. GENERAL PROVISIONS\nThe policy is governed by the law of the state.`,
      `${footer.replace("12", "4")}\nEnd of document.`,
    ];
    const d = doc("d2", pages);
    const { ev, exclusions } = sealed([d], [plan("Invented Travel Plus", "d2")]);
    expect(exclusions.map((p) => p.claim).sort()).toEqual([
      "Charges for cosmetic treatment",
      "Charges for custodial care",
      "Charges for dental care unless caused by an accident",
      "Charges for experimental treatment",
    ]);
    expect(ev.exclusionProposals[0].dropped["cut-by-page-break"]).toBe(1);
    expect(exclusions.some((p) => /governed/.test(p.claim))).toBe(false);
  });

  it("splits an unenumerated section into complete sentences only", () => {
    const pages = [
      "Plan name: Invented Basic\nPlan year 2026",
      "Exclusions\nAcupuncture is not covered.\nCosmetic surgery is not covered. Services that are not medically\nnecessary are not covered.\nCovered Services\nOffice visits are covered.",
    ];
    const { exclusions } = sealed([doc("d3", pages)], [plan("Invented Basic", "d3")]);
    expect(exclusions.map((p) => p.claim).sort()).toEqual([
      "Acupuncture is not covered.",
      "Cosmetic surgery is not covered.",
      "Services that are not medically necessary are not covered.",
    ]);
  });
});

describe("m7h exclusion proposer: framing and plan binding (EC-3, EC-6)", () => {
  const withSection = (heading: string, before = "") =>
    ["Plan name: Invented Care Gold\nSummary", `${before}${heading}\n• Cosmetic surgery\n• Long-term care\nCovered Services\nOffice visits`];

  it("a heading that is itself framing yields nothing", () => {
    for (const heading of ["Sample Exclusions", "Exclusions (example)", "Exclusions of Another Plan"]) {
      const { exclusions } = sealed([doc("f1", withSection(heading))], [plan("Invented Care Gold", "f1")]);
      expect(exclusions, heading).toHaveLength(0);
    }
  });

  it("an exclusion heading inside an example region yields nothing", () => {
    const { exclusions, ev } = sealed([doc("f2", withSection("Exclusions", "Coverage Example\nIn this scenario the member pays $40.\n"))], [plan("Invented Care Gold", "f2")]);
    expect(exclusions).toHaveLength(0);
    expect(ev.exclusionProposals[0].framedSections).toBe(1);
  });

  it("an exclusion heading below framing prose on its page yields nothing", () => {
    const before = "This page shows an example of what a member might pay in a year.\nCost Sharing\n";
    const { exclusions } = sealed([doc("f5", withSection("Exclusions", before))], [plan("Invented Care Gold", "f5")]);
    expect(exclusions).toHaveLength(0);
    // A line that only points to examples elsewhere does not frame.
    const pointer = "To see an example of costs, see the next section.\n";
    expect(sealed([doc("f6", withSection("Exclusions", pointer))], [plan("Invented Care Gold", "f6")]).exclusions).toHaveLength(2);
  });

  it("a running header/footer with a framing word frames the whole document", () => {
    const pages = ["Plan name: Invented Care Gold\nSPECIMEN", "Exclusions\n• Cosmetic surgery\nSPECIMEN", "Other text\nSPECIMEN"];
    expect(scanExclusionSections(pages).documentFramed).toBe(true);
    const { exclusions, ev } = sealed([doc("f3", pages)], [plan("Invented Care Gold", "f3")]);
    expect(exclusions).toHaveLength(0);
    expect(ev.exclusionProposals[0].unbound).toBe("framed-document");
  });

  it("an item with a framing word is dropped and counted", () => {
    const pages = ["Plan name: Invented Care Gold\nSummary", "Exclusions\n• Cosmetic surgery\n• Dental care, for example implants\nCovered Services\nOffice visits"];
    const { exclusions, ev } = sealed([doc("f4", pages)], [plan("Invented Care Gold", "f4")]);
    expect(exclusions.map((p) => p.claim)).toEqual(["Cosmetic surgery"]);
    expect(ev.exclusionProposals[0].dropped.framing).toBe(1);
  });

  it("a document covered by two verified plans proposes nothing (no plan binding)", () => {
    const pages = withSection("Exclusions");
    const { exclusions, ev } = sealed([doc("m1", pages)], [plan("Invented Care Gold", "m1"), plan("Invented Care Silver", "m1")]);
    expect(exclusions).toHaveLength(0);
    expect(ev.exclusionProposals[0].unbound).toBe("no-verified-plan");
  });

  it("a document that declares another plan on any page proposes nothing", () => {
    const pages = [...withSection("Exclusions"), "Plan name: Invented Care Platinum\nRates"];
    const { exclusions, ev } = sealed([doc("m2", pages)], [plan("Invented Care Gold", "m2")]);
    expect(exclusions).toHaveLength(0);
    expect(ev.exclusionProposals[0].unbound).toBe("declares-other-plan");
  });

  it("a section naming another verified plan of the session is not proposed", () => {
    const a = doc("m3", ["Plan name: Invented Care Gold\nSummary", "Exclusions\n• Cosmetic surgery, unlike Invented Care Silver\n• Long-term care\nCovered Services\nOffice"]);
    const b = doc("m4", ["Plan name: Invented Care Silver\nSummary", "Benefits\nOffice visits"]);
    const { exclusions, ev } = sealed([a, b], [plan("Invented Care Gold", "m3"), plan("Invented Care Silver", "m4")]);
    expect(exclusions).toHaveLength(0);
    expect(ev.exclusionProposals.find((r) => r.documentId === "m3")!.dropped["other-plan"]).toBe(2);
  });

  it("never binds by filename, proximity or mention: no verified plan → nothing", () => {
    const d = doc("n1", ["Invented Care Gold brochure\nSummary", "Exclusions\n• Cosmetic surgery\nCovered Services\nOffice"]);
    const res = proposeExclusions(sealVerifiedTable(SID, [d], table([d], [])).registry.get("n1")!, { sessionId: SID, otherPlanNames: [] });
    expect(res.proposals).toHaveLength(0);
    expect(res.report.unbound).toBe("no-verified-plan");
  });

  it("a non-unique item is refused by the store and counted, never stored", () => {
    const pages = ["Plan name: Invented Care Gold\nCosmetic surgery", "Exclusions\n• Cosmetic surgery\nCovered Services\nCosmetic surgery\nOffice"];
    const { exclusions, ev } = sealed([doc("u1", pages)], [plan("Invented Care Gold", "u1")]);
    expect(exclusions).toHaveLength(1); // the marker-inclusive quote is unique
    const pages2 = ["Plan name: Invented Care Gold\nx", "Exclusions\n• Cosmetic surgery\nCovered Services\n• Cosmetic surgery"];
    const r2 = sealed([doc("u2", pages2)], [plan("Invented Care Gold", "u2")]);
    expect(r2.exclusions).toHaveLength(0);
    expect(r2.ev.exclusionProposals[0]).toMatchObject({ proposed: 1, accepted: 0, refused: 1 });
    expect(ev.exclusionProposals[0].refused).toBe(0);
  });
});
