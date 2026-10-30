// P1 controlled evidence ownership — Stage E proof tests.
// The C6 mention pathway (attributePlanScope) is unchanged; these tests cover
// the new document-ownership proof used by the extract route's Stage E gate.
// Proof semantics under test:
//   A value may carry a planId of a verified plan WITHOUT the labelled
//   plan/fact/value line only when ALL hold:
//     1. exactly one verified plan covers the value's own document;
//     2. the value's display + cited quotes carry no abstention language
//        (riders, examples, illustrations, samples, alternatives, competitor
//        figures, comparable-plan figures, shared provisions, marketing);
//     3. the value's text does not name another verified plan (rival mention);
//     4. the value's cited pages declare no other plan (page scope is clear);
//     5. the value's same-document peer group (uniform attribution) contains
//        no same-scope contradiction;
//     6. the claimed labelled-line path (hasPlanValueProof) is unchanged and
//        still decides before ownership.
import { describe, expect, it } from "vitest";
import {
  attestPlans,
  ownershipProvisionApplicable,
  resolveRowPlanIds,
  uniqueDocumentPlanId,
} from "@/app/lib/extraction/plan-identity";
import type { CellValue, ProvenPlan } from "@/app/lib/extraction/types";

type Doc = { documentId: string; filename: string; pages: string[] };

function doc(documentId: string, pages: string[]): Doc {
  return { documentId, filename: `${documentId}.pdf`, pages };
}

function value(
  documentId: string,
  display: string,
  page: number,
  quote: string,
  extra: Partial<CellValue> = {},
): CellValue {
  return {
    documentId,
    display,
    qualifiers: (extra.qualifiers ?? {}) as CellValue["qualifiers"],
    ...(extra.planId ? { planId: extra.planId } : {}),
    evidence: [{ documentId, page, quote }],
  };
}

describe("unique document plan identity", () => {
  it("returns the single plan that covers a document", () => {
    const docs = [doc("d1", ["Policy name: Alpha"])];
    const plans = attestPlans(docs);
    expect(plans).toHaveLength(1);
    expect(uniqueDocumentPlanId(plans, "d1")).toBe(plans[0].planId);
  });

  it("is undefined when two plans cover one document (fail-closed)", () => {
    const docs = [doc("d1", ["Policy name: Alpha\nPolicy name: Beta"])];
    expect(uniqueDocumentPlanId(attestPlans(docs), "d1")).toBeUndefined();
  });

  it("is undefined when no verified plan covers the document", () => {
    const plans: ProvenPlan[] = [
      { planId: "plan-a", name: "Alpha", sources: [{ documentId: "d1", page: 1, quote: "Policy name: Alpha" }] },
    ];
    expect(uniqueDocumentPlanId(plans, "d2")).toBeUndefined();
    expect(uniqueDocumentPlanId([], "d1")).toBeUndefined();
  });

  it("sees one merged plan covering two documents (policy id + issuer)", () => {
    const docs = [
      doc("d1", ["Plan name: Zeta; Policy ID: Z9; Issuer: ZetaCorp"]),
      doc("d2", ["Plan name: Zeta; Policy ID: Z9; Issuer: ZetaCorp"]),
    ];
    const plans = attestPlans(docs);
    expect(plans).toHaveLength(1);
    expect(uniqueDocumentPlanId(plans, "d1")).toBe(plans[0].planId);
    expect(uniqueDocumentPlanId(plans, "d2")).toBe(plans[0].planId);
  });
});

describe("attestation title-context hardening (phantom identity rejection)", () => {
  it("rejects a mid-document declaration as a plan identity", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Annual deductible: $250\nPlan name: Sample Plan"])];
    expect(attestPlans(docs).map((p) => p.name)).toEqual(["Alpha"]);
  });

  it("rejects a program title declared mid-document", () => {
    const docs = [doc("d1", ["Introduction text", "Patriot Exchange ProgramSM\nCertificate of Insurance"])];
    expect(attestPlans(docs)).toEqual([]);
  });

  it("does not attest a plan declared only on a later page (fail-closed; reported limitation)", () => {
    const docs = [doc("d1", ["Some brochure text", "Plan name: Alpha"])];
    expect(attestPlans(docs)).toEqual([]);
  });

  it("still attests multiple declarations on the first page (multi-plan documents stay visible)", () => {
    const docs = [doc("d1", ["Policy name: Alpha\nPolicy name: Beta"])];
    expect(attestPlans(docs)).toHaveLength(2);
  });
});

describe("ownership provision applicability (lexical abstention guards)", () => {
  it("accepts ordinary benefit provisions", () => {
    expect(ownershipProvisionApplicable("$250", ["Annual deductible: $250"])).toBe(true);
  });

  it("accepts a selectable deductible option menu (qualifier-preserving path)", () => {
    const text = "Deductible Options (You pay) $0 - $5,000 (Choose the option you want.)";
    expect(ownershipProvisionApplicable(text, [text])).toBe(true);
  });

  it("abstains on optional riders, add-ons, upgrades and endorsements", () => {
    expect(ownershipProvisionApplicable("$50", ["Optional coverage: Adventure Activities up to medical maximum"])).toBe(false);
    expect(ownershipProvisionApplicable("$100", ["Rider benefit: $100"])).toBe(false);
    expect(ownershipProvisionApplicable("$75", ["Available as an add-on for $75"])).toBe(false);
    expect(ownershipProvisionApplicable("$60", ["Upgrade available for $60"])).toBe(false);
    expect(ownershipProvisionApplicable("$80", ["Per endorsement dated 2026-01-01, $80 applies"])).toBe(false);
  });

  it("abstains on examples, illustrations and sample figures", () => {
    expect(ownershipProvisionApplicable("$900", ["Example: a comparable plan's deductible is $900"])).toBe(false);
    expect(ownershipProvisionApplicable("$1,000", ["Illustrative calculation: $1,000 out of pocket"])).toBe(false);
    expect(ownershipProvisionApplicable("$300", ["Sample: deductible is $300"])).toBe(false);
    expect(ownershipProvisionApplicable("$40", ["For instance, a $40 copay may apply"])).toBe(false);
    expect(ownershipProvisionApplicable("$20", ["Suppose a $20 copay applies"])).toBe(false);
    expect(ownershipProvisionApplicable("$10", ["Hypothetical example: $10"])).toBe(false);
  });

  it("abstains on alternative-coverage, competitor and comparable-plan figures", () => {
    expect(ownershipProvisionApplicable("$500", ["Alternatively, the Basic option costs $500"])).toBe(false);
    expect(ownershipProvisionApplicable("$500", ["Competitor Gamma deductible is $500"])).toBe(false);
    expect(ownershipProvisionApplicable("$900", ["A comparable plan's deductible is $900"])).toBe(false);
  });

  it("abstains on marketing summaries and shared provisions", () => {
    expect(ownershipProvisionApplicable("abroad. StudentSecure offers a budget-friendly option designed to help meet these needs", ["abroad. StudentSecure offers a budget-friendly option designed to help meet these needs"])).toBe(false);
    expect(ownershipProvisionApplicable("$900", ["Shared deductible: $900"])).toBe(false);
  });

  it("checks the evidence quotes, not just the display", () => {
    expect(ownershipProvisionApplicable("$900", ["Example: a comparable plan's deductible is $900"])).toBe(false);
  });

  it("abstains on long digitless narrative (marketing prose, definitions, boilerplate)", () => {
    expect(ownershipProvisionApplicable("International medical insurance can help protect you if you get sick or hurt while traveling outside your home country.", [])).toBe(false);
    expect(ownershipProvisionApplicable("and coinsurance. Unless otherwise stated, all benefits are per person, per period of coverage, and they are provided up to the amount shown.", [])).toBe(false);
    expect(ownershipProvisionApplicable("You can find exclusions for this plan in the Travel Medical Basic and Travel Medical Choice plan document.", [])).toBe(false);
  });

  it("keeps short digitless benefit labels (schedule structure, not narrative)", () => {
    expect(ownershipProvisionApplicable("Mental Health Disorders", [])).toBe(true);
    expect(ownershipProvisionApplicable("Provider Referrals", [])).toBe(true);
    expect(ownershipProvisionApplicable("Emergency Room Copayment", [])).toBe(true);
  });
});

describe("row plan scope resolution (Stage E ownership)", () => {
  it("attributes every verified value of a single-plan document", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Annual deductible: $250"])];
    const plans = attestPlans(docs);
    const values = [value("d1", "$250", 2, "Annual deductible: $250")];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([plans[0].planId]);
  });

  it("attributes values of a merged plan across both documents", () => {
    const docs = [
      doc("d1", ["Plan name: Zeta; Policy ID: Z9; Issuer: ZetaCorp", "Annual deductible: $500"]),
      doc("d2", ["Plan name: Zeta; Policy ID: Z9; Issuer: ZetaCorp", "Emergency care copay: $150"]),
    ];
    const plans = attestPlans(docs);
    const values = [
      value("d1", "$500", 2, "Annual deductible: $500"),
      value("d2", "$150", 2, "Emergency care copay: $150"),
    ];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([
      plans[0].planId,
      plans[0].planId,
    ]);
  });

  it("keeps a claimed planId backed by the labelled plan/value line", () => {
    const docs = [doc("d1", ["Policy name: Alpha"])];
    const plans: ProvenPlan[] = [
      { planId: "plan-a", name: "Alpha", sources: [{ documentId: "d1", page: 1, quote: "Policy name: Alpha" }] },
    ];
    const values = [
      value("d1", "$250", 1, "Plan name: Alpha; annual-deductible: $250", { planId: "plan-a" }),
      value("d1", "$250", 1, "Alpha's annual deductible is $250", { planId: "plan-a" }),
    ];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([
      "plan-a",
      "plan-a",
    ]);
  });

  it("keeps claimed labelled values even inside a same-scope conflict (C6 claimed path unchanged)", () => {
    const docs = [doc("d1", ["Policy name: Alpha"])];
    const plans: ProvenPlan[] = [
      { planId: "plan-a", name: "Alpha", sources: [{ documentId: "d1", page: 1, quote: "Policy name: Alpha" }] },
    ];
    const values = [
      value("d1", "$250", 1, "Plan name: Alpha; annual-deductible: $250", { planId: "plan-a" }),
      value("d1", "$250", 1, "Plan name: Alpha; annual-deductible: $500", { planId: "plan-a" }),
    ];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([
      "plan-a",
      "plan-a",
    ]);
  });

  it("keeps a mention-attributed value when the peer group is conflict-free", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Alpha's premium is $5"])];
    const plans = attestPlans(docs);
    const values = [value("d1", "$5", 2, "Alpha's premium is $5", { planId: plans[0].planId })];
    expect(resolveRowPlanIds("premium", values, plans, docs)).toEqual([plans[0].planId]);
  });

  it("abstains everywhere on a multi-plan document", () => {
    const docs = [doc("d1", ["Policy name: Alpha\nPolicy name: Beta", "Annual deductible: $250"])];
    const plans = attestPlans(docs);
    const values = [value("d1", "$250", 2, "Annual deductible: $250")];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([undefined]);
  });

  it("abstains ownership values in a same-scope conflicting peer group", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Annual deductible: $250", "Deductible: $500"])];
    const plans = attestPlans(docs);
    const values = [
      value("d1", "$250", 2, "Annual deductible: $250"),
      value("d1", "$500", 3, "Deductible: $500"),
    ];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("abstains on guard language in display or evidence", () => {
    const docs = [doc("d1", ["Policy name: Alpha"])];
    const plans = attestPlans(docs);
    const cases: [string, string][] = [
      ["$100", "Rider benefit: $100"],
      ["$900", "Example: a comparable plan's deductible is $900"],
      ["$500", "Competitor Gamma deductible is $500"],
      ["$900", "Shared deductible: $900"],
      ["International medical insurance can help protect you if you get sick or hurt while traveling outside your home country.", "International medical insurance can help protect you if you get sick or hurt while traveling outside your home country."],
    ];
    for (const [display, quote] of cases) {
      const values = [value("d1", display, 1, quote)];
      expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([undefined]);
    }
  });

  it("abstains when no plans are verified", () => {
    const docs = [doc("d1", ["Annual deductible: $250"])];
    const values = [value("d1", "$250", 1, "Annual deductible: $250")];
    expect(resolveRowPlanIds("annual-deductible", values, [], docs)).toEqual([undefined]);
  });

  it("abstains when the plan does not cover the value's document", () => {
    const docs = [doc("d1", ["Policy name: Alpha"]), doc("d2", ["Annual deductible: $250"])];
    const plans = attestPlans([docs[0]]);
    const values = [value("d2", "$250", 1, "Annual deductible: $250")];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([undefined]);
  });

  it("attributes a selectable deductible option menu", () => {
    const docs = [doc("d1", ["Policy name: Alpha"])];
    const plans = attestPlans(docs);
    const text = "Deductible Options (You pay) $0 - $5,000 (Choose the option you want.)";
    const values = [value("d1", text, 1, text, { qualifiers: { selectionStatus: "selectable" } as CellValue["qualifiers"] })];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([plans[0].planId]);
  });

  it("voids ownership for a document whose later page declares a different plan (multi-plan fail-closed)", () => {
    const docs = [doc("d1", [
      "Policy name: Alpha",
      "Annual deductible: $250\nPlan name: Sample Plan",
      "Emergency care copay: $150",
    ])];
    const plans = attestPlans(docs);
    // The mid-document declaration does not attest a plan identity (P1
    // title-context hardening)…
    expect(plans).toHaveLength(1);
    // …but ownership also voids for the whole document: the page-2 line is
    // evidence the document may describe another plan, so no value may be
    // attributed to the remaining plan (fail-closed, C6-consistent).
    const onPhantomPage = [value("d1", "$250", 2, "Annual deductible: $250")];
    expect(resolveRowPlanIds("annual-deductible", onPhantomPage, plans, docs)).toEqual([undefined]);
    const onCleanPage = [value("d1", "$150", 3, "Emergency care copay: $150")];
    expect(resolveRowPlanIds("emergency-care", onCleanPage, plans, docs)).toEqual([undefined]);
  });

  it("does not void ownership when a later page re-declares the owning plan", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Plan name: Alpha\nAnnual deductible: $250"])];
    const plans = attestPlans(docs);
    expect(plans).toHaveLength(1);
    const values = [value("d1", "$250", 2, "Annual deductible: $250")];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([plans[0].planId]);
  });

  it("abstains a value whose evidence names another verified plan (rival mention)", () => {
    const docs = [
      doc("d1", ["Policy name: Alpha", "Annual deductible: $500 unlike Beta Plan"]),
      doc("d2", ["Policy name: Beta Plan", "Annual deductible: $250"]),
    ];
    const plans = attestPlans(docs);
    expect(plans).toHaveLength(2);
    const withRival = [value("d1", "$500", 2, "Annual deductible: $500 unlike Beta Plan")];
    expect(resolveRowPlanIds("annual-deductible", withRival, plans, docs)).toEqual([undefined]);
    const control = [value("d1", "$500", 2, "Annual deductible: $500")];
    expect(resolveRowPlanIds("annual-deductible", control, plans, docs)).toEqual([plans[0].planId]);
  });

  it("attributes across pages of a single-plan multi-page document", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Annual deductible: $250", "Emergency care copay: $150"])];
    const plans = attestPlans(docs);
    const values = [
      value("d1", "$250", 2, "Annual deductible: $250"),
      value("d1", "$150", 3, "Emergency care copay: $150"),
    ];
    expect(resolveRowPlanIds("annual-deductible", values, plans, docs)).toEqual([
      plans[0].planId,
      plans[0].planId,
    ]);
  });

  it("does not mutate the input values", () => {
    const docs = [doc("d1", ["Policy name: Alpha", "Annual deductible: $250"])];
    const plans = attestPlans(docs);
    const values = [value("d1", "$250", 2, "Annual deductible: $250", { qualifiers: { planTier: "ELITE" } as CellValue["qualifiers"] })];
    const snapshot = JSON.parse(JSON.stringify(values));
    resolveRowPlanIds("annual-deductible", values, plans, docs);
    expect(values).toEqual(snapshot);
  });

  it("resolves a document's values identically alone or alongside other documents' values (isolation)", () => {
    const docs = [
      doc("d1", ["Policy name: Alpha", "Annual deductible: $250"]),
      doc("d2", ["Policy name: Beta Plan", "Annual deductible: $500"]),
    ];
    const plans = attestPlans(docs);
    const d1 = value("d1", "$250", 2, "Annual deductible: $250");
    const d2 = value("d2", "$500", 2, "Annual deductible: $500");
    const alone = resolveRowPlanIds("annual-deductible", [d1], plans, docs);
    const together = resolveRowPlanIds("annual-deductible", [d1, d2], plans, docs);
    expect(alone).toEqual([plans[0].planId]);
    expect(together[0]).toBe(alone[0]);
    expect(together[1]).toBe(plans[1].planId);
  });
});
