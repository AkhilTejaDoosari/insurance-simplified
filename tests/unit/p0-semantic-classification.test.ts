// P0-03 regression suite (Phase 2, Tasks 3–6). Each case was reproduced on
// the owner's real PDFs (local only, REAL_PDFS_DIR); the text below is
// synthetic and paraphrased. Every test runs the production line engine and
// verification boundary (extractFallback → verifyComparisonTable), so a case
// fails if the wrong fact receives the line at ANY stage — including the
// "Eligibility for you" composite that eligibility feeders flow into.
//
// Principle under test: the existence of a matching passage is not enough to
// establish a claim. A sentence that mentions a keyword but states a different
// concept must reach no fact (absence is honest) or its own fact.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { factsForLabel } from "@/app/lib/extraction/table-facts";
import { ELIGIBILITY_ROW_NAME } from "@/app/lib/extraction/eligibility";
import { FACTS, FACT_LIST_VERSION } from "@/app/lib/extraction/fact-list";
import { sectionForFactName } from "@/app/lib/extraction/sections";
import { provisionKindForFact } from "@/app/lib/evidence/session-evidence";

function classify(...pages: string[]) {
  const doc = { documentId: "doc-1", filename: "synthetic.pdf", pageCount: pages.length, pages };
  const table = verifyComparisonTable(validateTable(extractFallback([doc], {})), [doc]);
  const values = (fact: string) => table.rows.find((r) => r.factName === fact)?.values ?? [];
  const displays = (fact: string) => values(fact).map((v) => v.display);
  /** Facts whose values cite a quote containing `text`. */
  const factsCiting = (text: string) =>
    table.rows
      .filter((r) => r.values.some((v) => v.evidence.some((e) => e.quote.includes(text))))
      .map((r) => r.factName)
      .sort();
  return { table, values, displays, factsCiting };
}

describe("Task 3 — a claims deadline is not eligibility", () => {
  const LEGAL_ACTION =
    "A lawsuit cannot be started later than two (2) years after proof of loss is required to be given.";
  const FILING_DEADLINE =
    "(c) expenses are not payable unless a completed proof of claim is received within one hundred twenty (120) days";

  it("never files claim-procedure language under eligibility or the eligibility composite", () => {
    const { factsCiting } = classify(`CLAIMS\n${LEGAL_ACTION}\n${FILING_DEADLINE}`);
    expect(factsCiting("required to be given")).not.toContain("eligibility");
    expect(factsCiting("required to be given")).not.toContain(ELIGIBILITY_ROW_NAME);
    expect(factsCiting("proof of claim is received")).not.toContain("eligibility");
    expect(factsCiting("proof of claim is received")).not.toContain(ELIGIBILITY_ROW_NAME);
  });

  it("files a stated submission deadline under its own claims-filing-deadline fact", () => {
    const { displays } = classify(`${FILING_DEADLINE}\nClaims must be submitted within 90 days of the date of service.`);
    expect(displays("claims-filing-deadline")).toEqual([
      FILING_DEADLINE,
      "Claims must be submitted within 90 days of the date of service.",
    ]);
  });

  it.each([
    ["payment timing without a claim", "Payment is made within forty-five (45) days from receipt."],
    ["claim-form definition", "Proof of Claim: a signed claim form with itemized receipts."],
    ["legal-action limit", LEGAL_ACTION],
    ["death within days of an accident", "Death must happen within sixty (60) days after the accident."],
  ])("does not invent a filing deadline from %s", (_label, line) => {
    expect(classify(line).displays("claims-filing-deadline")).toEqual([]);
  });

  it("keeps genuine eligibility requirements (positive control)", () => {
    const { displays } = classify("To be eligible you must be under age 65 and residing outside your home country.");
    expect(displays("eligibility")).toEqual(["To be eligible you must be under age 65 and residing outside your home country."]);
  });
});

describe("Task 4 — a per-illness or per-injury deductible is not the annual deductible", () => {
  it.each([
    ["Deductible: $250 per illness or injury"],
    ["• Sickness: A $400 Deductible applies for each Illness"],
    ["Deductible per covered injury: $1,000"],
  ])("routes per-incident deductible line %# to per-illness-deductible only", (line) => {
    const { factsCiting } = classify(line);
    expect(factsCiting(line)).toEqual(["per-illness-deductible"]);
  });

  it("preserves the basis as a period qualifier", () => {
    const [value] = classify("Deductible: $250 per illness or injury").values("per-illness-deductible");
    expect(value.qualifiers.period).toMatch(/per illness/);
  });

  it.each([
    ["Annual deductible: $2,000"],
    ["Deductible $0, $200 or $400 per member, as selected"],
    ["Calendar-year deductible: $1,500"],
  ])("keeps period-deductible line %# as the annual deductible", (line) => {
    const { factsCiting } = classify(line);
    expect(factsCiting(line)).toContain("annual-deductible");
    expect(factsCiting(line)).not.toContain("per-illness-deductible");
  });

  it.each([
    ["a per-visit deductible", "Emergency room: Deductible $100 per visit", "per visit"],
    ["a basis wrapped onto the next line", "• Sickness: A $400 Deductible applies for each\nurgent care visit at a clinic", "Deductible applies for each"],
  ])("does not file %s as the annual deductible", (_label, block, cited) => {
    expect(classify(block).factsCiting(cited)).not.toContain("annual-deductible");
  });

  it("does not take a benefit's own per-occurrence deductible as the plan's per-illness deductible", () => {
    expect(factsForLabel("Dental Accident Care • Subject to Coinsurance • Deductible per occurrence")).not.toContain(
      "per-illness-deductible",
    );
  });

  it("keeps an annual deductible that only mentions a per-illness one as annual", () => {
    const line = "Annual deductible $1,000 replaces the per illness deductible";
    expect(classify(line).factsCiting(line)).toEqual(["annual-deductible"]);
  });

  it("keeps an annual deductible with an incidental per-visit waiver", () => {
    const line = "Annual deductible: $500, waived for each emergency room visit";
    expect(classify(line).factsCiting(line)).toContain("annual-deductible");
  });

  it("does not file a non-medical per-damage deductible as the annual deductible", () => {
    expect(classify("• Per damage Deductible: $75").factsCiting("Per damage")).not.toContain("annual-deductible");
  });

  it.each([
    ["Deductible • Per Illness or Injury (In-Network, domestic)", ["per-illness-deductible"]],
    ["Deductible (per injury)", ["per-illness-deductible"]],
    ["Deductible per covered illness", ["per-illness-deductible"]],
    ["Deductible (SELECT)", ["annual-deductible"]],
    ["Deductible Options (You pay)", ["annual-deductible"]],
  ])("table label %j maps to %j", (label, expected) => {
    expect(factsForLabel(label)).toEqual(expected);
  });
});

describe("Task 5 — an age-dependent coverage maximum is not an age limit", () => {
  const LIMIT_BLOCK = [
    "Medical Expenses",
    "Overall maximum limit",
    "• Shown on your ID card",
    "• Up to age 64: $75,000, $150,000 or $300,000",
    "• Ages 65 through 74: $75,000 or $150,000",
  ].join("\n");

  it("files age-banded maximum options under the policy limit, governed by their heading", () => {
    const { factsCiting, values } = classify(LIMIT_BLOCK);
    expect(factsCiting("Up to age 64")).toEqual(["policy-limit"]);
    expect(factsCiting("Ages 65 through 74")).toEqual(["policy-limit"]);
    const first = values("policy-limit").find((v) => v.display.includes("Up to age 64"))!;
    // The governing heading travels with the evidence (material context).
    expect(first.evidence[0].quote).toContain("Overall maximum limit");
    expect(first.display).toBe("• Up to age 64: $75,000, $150,000 or $300,000");
    expect(first.qualifiers.selectionStatus).toBe("selectable");
  });

  it.each([
    "Maximum coverage option of $100,000 available for members over 65 years of age.",
    "Coverage maximum options: $50,000 / $100,000 / $250,000 available for members over 65.",
    "Maximum Limit $2,000,000",
  ])("files coverage-maximum line %# under policy-limit and not age-limits", (line) => {
    const { factsCiting } = classify(line);
    expect(factsCiting(line)).toContain("policy-limit");
    expect(factsCiting(line)).not.toContain("age-limits");
  });

  it.each([
    ["a sub-benefit limit bullet", "Air Ambulance\n• Maximum Limit: $20,000", "Maximum Limit: $20,000"],
    ["a per-day sub-limit", "Hospital Companion\n• Maximum Limit per day: $60", "per day"],
    ["a sub-limit sentence", "Pharmacy Maximum Limit is up to $40,000 per year", "Pharmacy"],
    ["a duration maximum", "Plan Coverage Maximum Limit: 180 days", "180 days"],
  ])("does not present %s as the overall policy limit", (_label, block, cited) => {
    expect(classify(block).factsCiting(cited)).not.toContain("policy-limit");
  });

  it("keeps age statements that name the person instead of the word age (positive control)", () => {
    for (const line of ["Coverage is available for dependents under 19.", "Coverage ends for members over 65."]) {
      expect(classify(line).factsCiting(line)).toContain("age-limits");
    }
  });

  it.each([
    ["an out-of-pocket maximum", "Out-of-Pocket Maximum\n• Under 19: $2,000", "Under 19"],
    ["a visit limit", "Physical Therapy Visit Limit\n• 20 visits: $50", "20 visits"],
  ])("does not govern a bullet under %s as the policy limit", (_label, block, cited) => {
    expect(classify(block).factsCiting(cited)).not.toContain("policy-limit");
  });

  it("does not take age-banded amounts under an unrelated heading as a policy limit", () => {
    const block = "Premium rates\n• Up to age 64: $45 per month\n• Ages 65 through 74: $90 per month";
    expect(classify(block).factsCiting("Up to age 64")).not.toContain("policy-limit");
    expect(classify(block).factsCiting("Up to age 64")).not.toContain("age-limits");
  });

  it.each([
    "Age limit: you must be under age 65 to enroll.",
    "Coverage is available to applicants under the age of 70.",
  ])("keeps %j as an age limit (positive control)", (line) => {
    expect(classify(line).factsCiting(line)).toContain("age-limits");
  });

  it.each([
    "Ambulance transport over 100 miles requires approval.",
    "Benefits are paid within 30 days for claims over 500 dollars.",
  ])("does not read a bare number after 'over' as an age: %j", (line) => {
    expect(classify(line).factsCiting(line)).not.toContain("age-limits");
  });
});

describe("Task 6 — geographic restrictions require a restriction, not a mention", () => {
  it("captures a stated area-of-coverage restriction", () => {
    const line = "Area of Coverage All countries excluding the member's country of residence";
    expect(classify(line).displays("geographic-restrictions")).toEqual([line]);
  });

  it.each([
    ["a definition", "Destination Country: All places the member travels to during the trip."],
    ["a 'means' definition", "Coverage area means the countries in which benefits are payable."],
    ["a mention", "for a sickness that starts while the member is in the Destination Country."],
    ["an evacuation condition", "(c) the member cannot depart the Destination Country by commercial flight"],
    ["a home-country extension", "Incidental home country coverage: up to 14 days for each 6 months of coverage."],
    ["a phone number", "Outside the United States: call +1.555.010.0000 collect"],
    ["a benefit trigger", "(ii) begins outside the member's country of residence without warning, and"],
    ["marketing copy", "Studying outside your home country this year?"],
  ])("does not file %s as a geographic restriction", (_label, line) => {
    expect(classify(line).factsCiting(line)).not.toContain("geographic-restrictions");
  });

  it.each([
    "Services received outside the service area are not covered.",
    "Coverage in your home country is limited to 30 days per period of coverage.",
    "Benefits are payable only within the United States.",
  ])("captures a restriction sentence: %j", (line) => {
    expect(classify(line).factsCiting(line)).toContain("geographic-restrictions");
  });

  it.each([
    "Benefits are not available in the U.S. for residents of other countries.",
    "Area of Coverage: The United States only",
  ])("captures a restriction written as %j", (line) => {
    expect(classify(line).factsCiting(line)).toContain("geographic-restrictions");
  });

  it("does not take a contact line as a restriction", () => {
    const line = "Customer service (USA only): 1-800-555-0100";
    expect(classify(line).factsCiting(line)).not.toContain("geographic-restrictions");
  });

  it("reads a geographic table row by its heading, not by an unrelated label", () => {
    expect(factsForLabel("Area of Coverage")).toContain("geographic-restrictions");
    expect(factsForLabel("Coinsurance Outside the United States")).not.toContain("geographic-restrictions");
  });

  it("requires a restriction for international-coverage too", () => {
    expect(classify("International In-Network Out-of-Network").factsCiting("International")).not.toContain("international-coverage");
    const line = "No benefits are payable for treatment received outside the U.S. except for emergencies.";
    expect(classify(line).factsCiting(line)).toContain("international-coverage");
  });
});

describe("fact-list registration", () => {
  it("bumps the fact-list version and registers each new fact with a section and provision kind", () => {
    expect(FACT_LIST_VERSION).toBe("v2");
    for (const name of ["claims-filing-deadline", "per-illness-deductible"]) {
      expect(FACTS.some((f) => f.name === name)).toBe(true);
    }
    expect(sectionForFactName("per-illness-deductible")).toBe("My Costs");
    expect(sectionForFactName("claims-filing-deadline")).toBe("Limits & Risks");
    expect(provisionKindForFact("per-illness-deductible")).toBe("cost_share");
    expect(provisionKindForFact("claims-filing-deadline")).toBe("requirement");
  });
});
