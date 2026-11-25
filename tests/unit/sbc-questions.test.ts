// Generalization fix 2 (2026-11-25): the "Important Questions" rows of an SBC
// state the overall deductible and the out-of-pocket limit. Synthetic text in
// the federal form's own wording.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { verifyClaimAnchor } from "@/app/lib/extraction/claim-anchors";
import { sbcQuestionClaims } from "@/app/lib/extraction/sbc-questions";

const HEAD = [
  "Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services Coverage Period: 01/01/2031 – 12/31/2031",
  "Northwind Mutual: Harbor Choice PPO Coverage for: Individual + Family | Plan Type: PPO",
  "The Summary of Benefits and Coverage (SBC) document will help you choose a health plan. This is only a summary.",
  "Important Questions Answers Why This Matters:",
];
const WHY_DED = "Generally, you must pay all of the costs from providers up to the deductible amount before\nthis plan begins to pay. If you have other family members on the plan, the overall\nfamily deductible must be met before the plan begins to pay.";
const WHY_OOP = "The out-of-pocket limit is the most you could pay in a year for covered services. If you have\nother family members in this plan, they have to meet their own out-of-pocket limits.";
const page = (ded: string, oop: string, more = "") => [
  ...HEAD,
  "What is the overall", `deductible?${ded}`, WHY_DED,
  "Are there services", "covered before you meet", "your deductible?", "Yes. Preventive care.",
  "This plan covers some items and services even if you haven’t yet met the deductible",
  "What is the out-of-pocket", `limit for this plan?${oop}`, WHY_OOP,
  "What is not included in", "the out-of-pocket limit?", "Premiums and balance-billing charges.",
  "Even though you pay these expenses, they don’t count toward the out-of-pocket limit.", more,
].join("\n");
const doc = (text: string, rest: string[] = []) => ({ documentId: "doc-1", filename: "x.pdf", pageCount: 1 + rest.length, pages: [text, ...rest] });
const claims = (d: ReturnType<typeof doc>, fact: string) => sbcQuestionClaims(d).filter((c) => c.factName === fact);
const show = (d: ReturnType<typeof doc>, fact: string) => claims(d, fact).map((c) => [c.value.display, c.value.qualifiers.networkTier, c.value.qualifiers.conditions]);
const rowOf = (d: ReturnType<typeof doc>, fact: string) =>
  verifyComparisonTable(validateTable(extractFallback([d], {})), [d]).rows.find((r) => r.factName === fact)!;

describe("SBC overall deductible and out-of-pocket limit", () => {
  it("reads one amount per enrollment when no network is named", () => {
    const d = doc(page(" $900 Individual / $1,800 Family", " $4,000 Individual / $8,000 Family"));
    expect(show(d, "annual-deductible")).toEqual([["$900 Individual", undefined, "Individual"], ["$1,800 Family", undefined, "Family"]]);
    expect(show(d, "out-of-pocket-maximum")).toEqual([["$4,000 Individual", undefined, "Individual"], ["$8,000 Family", undefined, "Family"]]);
  });

  it("binds each amount to the network that introduces it", () => {
    const d = doc(page("\nFor in-network providers: $200 individual/ $400\nfamily. For out-of-network providers: $300\nindividual/ $1,000 family", " Network: $4,000 Individual / $8,000 Family\nOut-of-Network: $9,000 Individual / $16,000 Family\nPer calendar year."));
    expect(show(d, "annual-deductible")).toEqual([
      ["in-network providers: $200 individual", "in-network", "individual"],
      ["in-network providers: $400 family", "in-network", "family"],
      ["out-of-network providers: $300 individual", "out-of-network", "individual"],
      ["out-of-network providers: $1,000 family", "out-of-network", "family"],
    ]);
    expect(show(d, "out-of-pocket-maximum")).toEqual([
      ["Network: $4,000 Individual\nPer calendar year.", "Network", "Individual"],
      ["Network: $8,000 Family\nPer calendar year.", "Network", "Family"],
      ["Out-of-Network: $9,000 Individual\nPer calendar year.", "Out-of-Network", "Individual"],
      ["Out-of-Network: $16,000 Family\nPer calendar year.", "Out-of-Network", "Family"],
    ]);
  });

  it("carries a following sentence with every amount, verbatim", () => {
    const d = doc(page(" $0", "\nIn-network: $2,000 individual / $4,000 family. There is a separate limit on drugs: $500 individual"));
    expect(show(d, "out-of-pocket-maximum").map((v) => v[0])).toEqual([
      "In-network: $2,000 individual\nThere is a separate limit on drugs: $500 individual",
      "In-network: $4,000 family\nThere is a separate limit on drugs: $500 individual",
    ]);
    expect(show(d, "annual-deductible")).toEqual([["$0", undefined, undefined]]);
  });

  it("reads a label before its amount and a per-person slash", () => {
    const d = doc(page(" Individual $900 / Family $1,800", " $4,000/person or $8,000/family"));
    expect(show(d, "annual-deductible").map((v) => v[0])).toEqual(["Individual $900", "Family $1,800"]);
    expect(show(d, "out-of-pocket-maximum").map((v) => [v[0], v[2]])).toEqual([["$4,000/person", "person"], ["$8,000/family", "family"]]);
  });

  it("keeps an answer it cannot take apart whole and verbatim", () => {
    const d = doc(page("\n$500 for the first tier and $900 after that, then $1,800 combined", " $4,000"));
    expect(show(d, "annual-deductible")).toEqual([["$500 for the first tier and $900 after that, then $1,800 combined", undefined, undefined]]);
    expect(rowOf(d, "annual-deductible").verdict).toBe("NEEDS VERIFICATION");
  });

  it("reads an answer of no out-of-pocket limit", () => {
    const text = page(" $0", " Not Applicable.").replace(WHY_OOP, "This plan does not have an out-of-pocket limit on your expenses.");
    expect(show(doc(text), "out-of-pocket-maximum").map((v) => v[0])).toEqual(["Not Applicable."]);
  });

  it("is SUPPORTED, attributed to the plan and re-derivable", () => {
    const d = doc(page(" Network: $900 Individual / $1,800 Family", " $4,000 Individual / $8,000 Family"));
    const row = rowOf(d, "annual-deductible");
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values.map((v) => v.display)).toEqual(["Network: $900 Individual", "Network: $1,800 Family"]);
    expect(row.values.every((v) => v.planId)).toBe(true);
    for (const v of row.values) expect(verifyClaimAnchor("annual-deductible", v, [d])).toBe(true);
    const [value] = row.values;
    expect(verifyClaimAnchor("annual-deductible", { ...value, display: "Network: $1 Individual" }, [d])).toBe(false);
    expect(verifyClaimAnchor("out-of-pocket-maximum", value, [d])).toBe(false);
    expect(verifyClaimAnchor("annual-deductible", { ...value, qualifiers: { ...value.qualifiers, networkTier: "Out-of-Network" } }, [d])).toBe(false);
  });

  it.each([
    ["the explanation was not found", page(" $900 Individual", " $4,000").replace("Generally, you must pay all of the costs", "In general the costs are paid")],
    ["another question's text is inside the answer", page(" Are there services covered? $900 Individual", " $4,000")],
    ["the page footer is inside the answer", page("\nPage 1 of 6\n$900 Individual", " $4,000")],
    ["no amount is stated", page(" See the plan document for details about this.", " $4,000")],
    ["the document is not an SBC", page(" $900 Individual", " $4,000").replace(HEAD[0], "Guide to your benefits")],
  ])("makes no claim when %s", (_label, text) => {
    expect(claims(doc(text), "annual-deductible")).toEqual([]);
  });

  it("makes no claim when the question is answered twice", () => {
    const text = page(" $900 Individual", " $4,000");
    expect(claims(doc(text, [text.replace("$900", "$700")]), "annual-deductible")).toEqual([]);
  });

  it("never takes an amount from a coverage example", () => {
    const d = doc(page(" $900 Individual / $1,800 Family", " $4,000"), ["About these Coverage Examples:\nIn this example, Mia would pay:\nCost Sharing\nDeductibles $910\nThe total Mia would pay is $1,200"]);
    expect(rowOf(d, "annual-deductible").values.map((v) => v.display)).toEqual(["$900 Individual", "$1,800 Family"]);
  });

  it("reads the network and referral answers with their question", () => {
    const d = doc(page(" $0", " $4,000", [
      "Will you pay less if you", "use a network provider?", "Yes. See www.example.test or call 1-800-555-0100 for a", "list of network providers.",
      "This plan uses a provider network. You will pay less if you use a provider in the plan’s network.",
      "Do you need a referral to", "see a specialist?", "Yes, but you may self-refer to certain", "specialists.",
      "This plan will pay some or all of the costs to see a specialist for covered services but only if",
      "you have a referral before you see the specialist.",
    ].join("\n")));
    expect(show(d, "referral-requirement").map((v) => v[0])).toEqual(["Do you need a referral to see a specialist? Yes, but you may self-refer to certain specialists."]);
    expect(show(d, "network").map((v) => v[0])).toEqual(["Will you pay less if you use a network provider? Yes. See www.example.test or call 1-800-555-0100 for a list of network providers."]);
  });
});
