// Generalization fix 1 (2026-11-25): the Summary of Benefits and Coverage is a
// federally standardized form. Its header block names the plan next to
// "Coverage for: … | Plan Type: …". All text below is synthetic.
import { describe, expect, it } from "vitest";
import { attestPlans } from "@/app/lib/extraction/plan-identity";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";

const HEADER = "Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services Coverage Period: 01/01/2031 – 12/31/2031";
const INTRO = [
  "The Summary of Benefits and Coverage (SBC) document will help you choose a health plan. The SBC shows you how you and the plan would share the",
  "cost for covered health care services. NOTE: Information about the cost of this plan (called the premium) will be provided separately. This is only a",
  "summary. For general definitions of common terms, such as allowed amount, see the Glossary.",
];
const QUESTIONS = [
  "Important Questions Answers Why This Matters:",
  "What is the overall",
  "deductible? $900 Individual / $1,800 Family",
  "Generally, you must pay all of the costs from providers up to the deductible amount before this plan begins to pay.",
];
const doc = (head: string[], more: string[] = [], id = "doc-1") => ({
  documentId: id, filename: "x.pdf", pages: [[...head, ...INTRO, ...QUESTIONS].join("\n"), ...more],
});
const names = (d: ReturnType<typeof doc>) => attestPlans([d]).map((p) => p.name);

describe("SBC header plan identity", () => {
  it("reads '<insurer>: <plan>' printed before 'Coverage for:'", () => {
    const d = doc(["Page 1 of 6", HEADER, "Northwind Mutual: Harbor Choice PPO Coverage for: Individual + Family | Plan Type: PPO"]);
    expect(names(d)).toEqual(["Northwind Mutual: Harbor Choice PPO"]);
    const [plan] = attestPlans([d]);
    expect(verifyEvidenceCitation([{ ...d, pageCount: 1 }], plan.sources[0]).ok).toBe(true);
    expect(plan.sources[0].quote).toContain("Northwind Mutual: Harbor Choice PPO");
  });

  it("reads a plan name with no insurer part", () => {
    expect(names(doc([HEADER, "Harbor HSA Plus Plan Coverage For: Family | Plan Type: PS1"]))).toEqual(["Harbor HSA Plus Plan"]);
  });

  it("reads a name line of its own when the insurer is a logo and 'Coverage for' is elsewhere", () => {
    expect(names(doc([
      "Page 1 of 6", "AB-1234-1", "Coverage for: Individual / Family | Plan Type: HDHP", HEADER, ": Harbor CDHP Plan",
      "All plans offered and underwritten by Northwind Health of Example",
    ]))).toEqual(["Harbor CDHP Plan"]);
  });

  it("reads the header after the introductory paragraph", () => {
    const d = { documentId: "doc-1", filename: "x.pdf", pages: [[...INTRO, HEADER, "Harbor HSA Plan Coverage For: Family | Plan Type: PS1", ...QUESTIONS].join("\n")] };
    expect(names(d)).toEqual(["Harbor HSA Plan"]);
  });

  it("reads a coverage period printed on its own line", () => {
    expect(names(doc([
      "Summary of Benefits and Coverage: What this Plan Covers & What You Pay For Covered Services",
      "Coverage Period: 07/01/2031 – 06/30/2032",
      "Northwind: Harbor Student Plan Coverage for: Individual | Plan Type: PPO",
    ]))).toEqual(["Northwind: Harbor Student Plan"]);
  });

  it("keeps two SBCs of one insurer as two plans", () => {
    const a = doc([HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO"], [], "doc-1");
    const b = doc([HEADER, "Northwind: Harbor Two Coverage for: Family | Plan Type: PPO"], [], "doc-2");
    expect(attestPlans([a, b]).map((p) => [p.name, p.sources.map((s) => s.documentId)])).toEqual([
      ["Northwind: Harbor One", ["doc-1"]], ["Northwind: Harbor Two", ["doc-2"]],
    ]);
  });

  it.each([
    ["no SBC header", ["Northwind: Harbor PPO Coverage for: Family | Plan Type: PPO"]],
    ["the federal template placeholder", [HEADER, "Insurance Company 1: Plan Option 1 Coverage for: Family | Plan Type: PPO"]],
    ["a sample form", [HEADER, "Northwind: Sample Plan Coverage for: Family | Plan Type: PPO"]],
    ["only a plan type word", [HEADER, "PPO Coverage for: Family | Plan Type: PPO"]],
    ["only an insurer before the colon", [HEADER, "Northwind Mutual: Coverage for: Family | Plan Type: PPO"]],
    ["a name wrapped over two lines (no single line to cite)", [HEADER, "Northwind Mutual: Harbor Medical", "Option Two Coverage for: Family | Plan Type: PPO"]],
    ["no name at all", [HEADER, "Coverage for: Family | Plan Type: PPO"]],
    ["two candidate name lines without 'Coverage for'", [HEADER, "Northwind Harbor One", "Northwind Harbor Two"]],
    ["a name continuing after the plan type", [HEADER, "Northwind: Harbor Coverage for: Family | Plan Type: PPO", "Gold Option"]],
    ["a sentence", [HEADER, "This plan is offered to employees of Northwind. Coverage for: Family | Plan Type: PPO"]],
    ["a money amount", [HEADER, "Harbor $500 Coverage for: Family | Plan Type: PPO"]],
    ["two different 'Coverage for' names", [HEADER, "Harbor One Coverage for: Family | Plan Type: PPO", "Harbor Two Coverage for: Family | Plan Type: PPO"]],
  ])("abstains: %s", (_label, head) => {
    expect(names(doc(head as string[]))).toEqual([]);
  });

  it("abstains when a later page starts an SBC for a different plan", () => {
    const second = [HEADER, "Northwind: Harbor Two Coverage for: Family | Plan Type: PPO", ...INTRO, ...QUESTIONS].join("\n");
    expect(names(doc([HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO"], [second]))).toEqual([]);
  });

  it("abstains when a later page starts an SBC whose plan cannot be read", () => {
    const second = [HEADER, ...INTRO, ...QUESTIONS].join("\n");
    expect(names(doc([HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO"], [second]))).toEqual([]);
  });

  it("keeps one plan when the same header repeats on later pages", () => {
    const second = [HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO", "Common Medical Event Services You May Need"].join("\n");
    expect(names(doc([HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO"], [second]))).toEqual(["Northwind: Harbor One"]);
  });

  it("abstains on a page that only mentions the SBC form", () => {
    expect(names({ documentId: "doc-1", filename: "x.pdf", pages: ["Harbor Guide Coverage for: you\nAsk for the Summary of Benefits and Coverage (SBC) document.\nImportant Questions Answers Why This Matters:"] })).toEqual([]);
  });
});
