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
    const second = [HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO", "Common Medical Event Services You May Need", "Network Provider (You will pay the least)", "Out-of-Network (You will pay the most)"].join("\n");
    expect(names(doc([HEADER, "Northwind: Harbor One Coverage for: Family | Plan Type: PPO"], [second]))).toEqual(["Northwind: Harbor One"]);
  });

  it("abstains on a page that only mentions the SBC form", () => {
    expect(names({ documentId: "doc-1", filename: "x.pdf", pages: ["Harbor Guide Coverage for: you\nAsk for the Summary of Benefits and Coverage (SBC) document.\nImportant Questions Answers Why This Matters:"] })).toEqual([]);
  });

  // ---- independent review of 949e880 (2026-11-25): B1–B6, M1, M4
  const T = "Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services";
  const CF = "Coverage for: Individual + Family | Plan Type: PPO";
  const ONE = [HEADER, `Northwind: Harbor One ${CF}`];
  const sbc = (head: string[]) => [...head, ...INTRO, ...QUESTIONS].join("\n");

  it.each([
    ["title line missing", [`Northwind: Harbor Two ${CF}`, ...INTRO, ...QUESTIONS]],
    ["title after other text on its line", [`Page 1 of 6 ${HEADER}`, `Northwind: Harbor Two ${CF}`, "Common Medical Event"]],
    ["title wrapped before 'Covers'", ["Summary of Benefits and Coverage: What this Plan", "Covers & What You Pay for Covered Services", `Northwind: Harbor Two ${CF}`, "Common Medical Event"]],
    ["title wrapped after the colon", ["Summary of Benefits and Coverage:", "What this Plan Covers & What You Pay for Covered Services", `Northwind: Harbor Two ${CF}`, "Common Medical Event"]],
    ["non-breaking space in the title", [HEADER.replace("this Plan", "this\u00a0Plan"), `Northwind: Harbor Two ${CF}`, "Common Medical Event"]],
    ["title without its colon", [HEADER.replace("Coverage:", "Coverage"), "Common Medical Event"]],
    ["a name line that wraps", [HEADER, "Northwind:", `Harbor Two ${CF}`, "Common Medical Event"]],
    ["another plan type under the same name", [HEADER, "Northwind: Harbor One Coverage for: Individual + Family | Plan Type: HMO", "Common Medical Event"]],
    ["another period under the same name", [HEADER.replace(/2031/g, "2032"), `Northwind: Harbor One ${CF}`, "Common Medical Event"]],
    ["only its questions", QUESTIONS],
  ])("abstains when the file holds a second SBC: %s", (_label, second) => {
    expect(names(doc(ONE, [(second as string[]).join("\n")]))).toEqual([]);
  });

  it("abstains when a second SBC is on the same page", () => {
    expect(names({ documentId: "doc-1", filename: "x.pdf", pages: [`${sbc(ONE)}\n${sbc([HEADER, `Northwind: Harbor Two ${CF}`])}`] })).toEqual([]);
  });

  it.each([
    ["another plan's certificate", "Harbor Two\nCertificate of Coverage\nDeductible In-Network $9,000"],
    ["a benefit guide page", "Harbor Two: what you pay\nDeductible $9,000"],
    ["a notice page that states amounts", "Notice of Nondiscrimination\nDeductible $9,000"],
  ])("abstains when the file also holds %s", (_label, page) => {
    expect(names(doc(ONE, [page]))).toEqual([]);
  });

  it("accepts form pages and closing notices", () => {
    expect(names(doc(ONE, [
      "Common Medical Event Services You May Need\nNetwork Provider (You will pay the least)\nOut-of-Network (You will pay the most)\nSpecialist visit $40 copay",
      "About these Coverage Examples:\nThis is not a cost estimator.\nDeductibles $900",
      "Notice of Nondiscrimination\nWe comply with federal civil rights laws.",
    ]))).toEqual(["Northwind: Harbor One"]);
  });

  it.each([
    ["Here is the SBC for one of our plans", HEADER, `Northwind: Harbor One ${CF}`],
    ["How to read your SBC (example)", HEADER, `Northwind: Harbor One ${CF}`],
    ["Harbor Choice 500", HEADER, `City of Springfield ${CF}`],
    [HEADER, `Northwind Mutual ${CF}`],
    [HEADER, `Northwind Health Insurance Company of Oregon ${CF}`],
    [HEADER, `Northwind Health Plan ${CF}`],
    [HEADER, `Northwind Mutual: City of Springfield ${CF}`],
    [HEADER, `Plan sponsor: Springfield Schools ${CF}`],
    [HEADER, `Oregon ${CF}`], [HEADER, `Gold ${CF}`], [HEADER, `Select Network ${CF}`], [HEADER, `Group #: 0012345 ${CF}`],
    [HEADER, `For Active Employees and Non-Medicare Retirees ${CF}`], [HEADER, `2031 Plan Year ${CF}`],
    [HEADER, "Northwind Mutual Coverage for: Family | Plan Type: PPO | Harbor Choice 500"],
    [CF, HEADER, "An Independent Licensee of the Harbor Association"], [CF, HEADER, "Live fearless"],
    [CF, HEADER, "100 Main Street Springfield, OR 97477"], [CF, HEADER, "Effective 2031-01-01"], [CF, HEADER, "Northwind Mutual Insurance"],
    [CF, HEADER, "Harbor CDHP Plan"],
    [`${T} Northwind: Harbor Medical`, `Option Two ${CF}`], ["Northwind: Harbor Medical", HEADER, `Option Two PPO ${CF}`],
    [HEADER, "All plans offered and underwritten by Harbor Medical", `Option Two PPO ${CF}`],
    [HEADER, "HARBOR-500", `Option Two PPO ${CF}`], [HEADER, `Northwind: Harbor ${CF}`, "HSA-3000"],
    [T, `Northwind: Harbor ${CF}`, "01/01/2031 – 12/31/2031 Gold Option"],
    [HEADER, "Northwind: Harbor Coverage for: Family", "Plan Type: PPO Gold Option"],
    [HEADER, `Harbor Choice PPO- ${CF}`], [HEADER, `Northwind: Harbor Choice & ${CF}`], [HEADER, `Northwind: Harbor Choice with ${CF}`], [HEADER, `Northwind: Harbor Choice (Gold ${CF}`],
    [HEADER, `Northwind: Harbor One ${CF} Harbor Two ${CF}`],
    [HEADER, `Northwind: Harbor One / Harbor Two ${CF}`], [HEADER, `Northwind: Harbor One and Harbor Two ${CF}`],
    [HEADER, `Northwind: Bronze, Silver and Gold ${CF}`], [HEADER, `Northwind: All Options ${CF}`], [HEADER, `Northwind: Harbor One replaces Harbor Two ${CF}`],
    [HEADER, `Northwind: Plan Option 1 ${CF}`], [HEADER, `Insurer: Plan Name ${CF}`], [HEADER, `XYZ Company: Harbor PPO ${CF}`], [HEADER, `Northwind: <Plan> ${CF}`],
    [HEADER, `High Deductible Health Plan ${CF}`], [HEADER, `Base PPO Plan ${CF}`], [HEADER, `Tier 1 PPO ${CF}`], [HEADER, `• Harbor One PPO ${CF}`],
    [HEADER, `Plan name: Harbor One ${CF}`], [HEADER, `Questions: Call to request a copy ${CF}`],
  ].map((head) => [head.join(" ⏎ "), head]))("abstains: %s", (_label, head) => {
    expect(names(doc(head as string[]))).toEqual([]);
  });

  const FORM = "Common Medical Event Services You May Need\nNetwork Provider (You will pay the least)\nOut-of-Network (You will pay the most)";
  it.each([
    ["one phrase of the form under another plan's name", `Northwind: Harbor Two PPO\nCommon Medical Event`],
    ["a guide mentioning the form", "Harbor Two compared. Services You May Need are listed in our guide."],
    ["a repeated title with another name", `${HEADER}\nNorthwind: Harbor Two\n${FORM}`],
    ["another coverage period on its own line", `Coverage Period: 01/01/2032 – 12/31/2032\n${FORM}`],
    ["a certificate with a language notice", "Harbor Two Certificate of Coverage\nHospital: 40% after deductible\nLanguage Assistance Services available"],
  ])("abstains when a later page is %s", (_label, page) => {
    expect(names(doc(ONE, [page]))).toEqual([]);
  });

  it.each([
    "Claims Administrator: Northwind Health", "Plan Administrator: Acme PPO", "Underwritten and administered by: Northwind", "Prepared by: Northwind", "Network: Select",
    "Location: Oregon", "Division: West", "TTY: Relay", "Medical: Choice", "Compare: Harbor", "Northwind: Harbor + Vista PPO", "Northwind Mutual: Northwind Mutual", "Northwind PPO",
  ])("abstains on a field label or a carrier: %s", (name) => {
    expect(names(doc([HEADER, `${name} ${CF}`]))).toEqual([]);
  });

  it("abstains when page 1 declares the header plan and another", () => {
    const d = doc([HEADER, `Harbor HSA Plan ${CF}`]);
    expect(names({ ...d, pages: [`${d.pages[0]}\nPlan name: Harbor HSA Plan\nPlan name: Harbor Two`] })).toEqual([]);
  });

  it("abstains when page 1 also declares another plan", () => {
    const d = doc([HEADER, `Northwind: Harbor One ${CF}`]);
    expect(names({ ...d, pages: [`${d.pages[0]}\nPlan name: Harbor Two`] })).toEqual([]);
  });
});
