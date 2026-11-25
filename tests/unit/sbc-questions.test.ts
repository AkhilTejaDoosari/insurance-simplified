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
const CHART = [
  "Common Medical Event Services You May Need", "Network Provider", "(You will pay the least)", "Out-of-Network Provider", "(You will pay the most)",
  "Preventive care/screening/", "immunization No charge Not covered",
  "You may have to pay for services that aren’t", "preventive. Ask your provider if the services", "needed are preventive. Then check what your plan", "will pay for.",
].join("\n");
const doc = (text: string, more: string[] = [], rest = [CHART, ...more]) => ({ documentId: "doc-1", filename: "x.pdf", pageCount: 1 + rest.length, pages: [text, ...rest] });
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
    const d = doc(page(" $0", "\nIn-network: $2,000 individual / $4,000 family. Copayments count toward this limit."));
    expect(show(d, "out-of-pocket-maximum").map((v) => v[0])).toEqual([
      "In-network: $2,000 individual\nCopayments count toward this limit.",
      "In-network: $4,000 family\nCopayments count toward this limit.",
    ]);
    expect(show(d, "annual-deductible")).toEqual([["$0", undefined, undefined]]);
  });

  // ---- independent review round 2 (2026-11-25): B1–B5
  it.each([
    "$500 Individual / $1,000 Family In-Network; $1,000 Individual / $2,000 Family Out-of-Network",
    "$500 Individual In-Network, $1,000 Individual Out-of-Network", "$500 In-Network. $1,000 Out-of-Network.", "$0 Network. $500 Out-of-Network",
    "$500 per year in-network, $1,000 per year out-of-network", "$500 individual per calendar year, $1,000 family per calendar year",
    "$500 individual, In-network; Preferred: $0", "$500/individual, Tier 2 $1,000/individual", "$3,000 Family, Embedded $1,500 per person",
    "$500 Individual, Prescription drugs $200", "In-network: $0. Deductible does not apply to preventive care. Out-of-network: $1,000",
    "Network: $500 individual Non-Network: $1,000 individual Tier 3: $9", "Network $500 Individual, Out-of-Network", "$500 individual Out-of-network",
    "$500 In-network providers only", "$200 individual per year for prescription drugs only",
    "In-network: $2,000 individual / $4,000 family. There is a separate limit on drugs: $500 individual",
  ])("keeps the whole answer: %s", (answer) => {
    expect(show(doc(page(`\n${answer}`, " $4,000")), "annual-deductible")).toEqual([[answer, undefined, undefined]]);
  });

  it("binds network labels written with spaces", () => {
    expect(show(doc(page("\nIn network: $500 individual. Out of network: $1,000 individual", " $4,000")), "annual-deductible").map((v) => [v[0], v[1]])).toEqual([
      ["In network: $500 individual", "In network"], ["Out of network: $1,000 individual", "Out of network"],
    ]);
  });

  it.each([
    "Generally, you must pay all of the costs from providers\nfor out-of-network providers. up to the deductible amount before this plan begins to pay.",
    "Generally, you must pay all of the costs from providers\n$1,000 Out-of-network, up to the deductible amount before this plan begins to pay.",
  ])("makes no claim when answer text is mixed into the explanation", (why) => {
    expect(claims(doc(page(" $500 Individual", " $4,000").replace(WHY_DED, why)), "annual-deductible")).toEqual([]);
  });

  it("makes no claim when the text does not run cell by cell", () => {
    expect(claims(doc(page(" $500 Individual", " $4,000"), [], [CHART.replace("preventive. Ask", "$40 copay preventive. Ask")]), "annual-deductible")).toEqual([]);
  });

  it.each(["Plan name: Harbor Two", "Harbor Two\nCertificate of Insurance"])("never attributes an SBC answer to another plan: %s", (head) => {
    const d = doc(`${head}\n${page(" $900 Individual", " $4,000")}`);
    expect(rowOf(d, "annual-deductible").values.every((v) => v.planId === undefined)).toBe(true);
  });

  it("never reads a coverage-example table", () => {
    const p2 = "About these Coverage Examples:\nThis is not a cost estimator.\nPeg\nJoe\nDeductible\n$910\n$920";
    const at = (t: string, from = 0) => { const start = p2.indexOf(t, from); return { start, end: start + t.length }; };
    const cell = (t: string, columns: number[]) => ({ text: t, spans: [at(t)], columns });
    const tables = [{ page: 3, header: { start: p2.indexOf("Peg"), end: p2.indexOf("Joe") + 3 }, columns: [
      { text: "Peg", lines: ["Peg"], spans: [at("Peg")], x0: 0, x1: 1 }, { text: "Joe", lines: ["Joe"], spans: [at("Joe")], x0: 1, x1: 2 },
    ], rows: [{ label: { text: "Deductible", spans: [at("Deductible")] }, cells: [cell("$910", [0]), cell("$920", [1])] }], footnotes: [] }];
    const d = { ...doc(page(" $900 Individual", " $4,000"), [p2]), tables };
    expect(rowOf(d as never, "annual-deductible").values.map((v) => v.display)).toEqual(["$900 Individual"]);
  });

  it.each(["In this example, Joe pays $400.", "See About these Coverage Examples on page 6.", "Total example cost: $900"])("an ordinary brochure keeps its page: %s", (line) => {
    const d = { documentId: "doc-1", filename: "x.pdf", pageCount: 1, pages: [`Plan name: Alpha\nAnnual deductible: $250 per person.\n${line}`] };
    expect(rowOf(d, "annual-deductible").values.map((v) => v.display)).toEqual(["Annual deductible: $250 per person."]);
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
    const d = doc(page(" $900 Individual / $1,800 Family", " $4,000"), ["About these Coverage Examples:\nThis is not a cost estimator.\nIn this example, Mia would pay:\nCost Sharing\nDeductibles $910\nThe total Mia would pay is $1,200"]);
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
