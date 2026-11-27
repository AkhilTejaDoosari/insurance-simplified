// P2.1 — unseen plan recognition: first-page title block fallback.
//
// The fallback runs only for a document in which none of the existing
// recognizers attested a plan. It is deliberately narrow (FEHB-style
// brochures): every condition below is POSITIVE identity evidence, and any
// ambiguity attests nothing (fail-closed):
//   * page 1 carries FEHB context;
//   * page 1 declares "Enrollment codes for this Plan:" with
//     "<code> <name> - <category>" lines using supported FEHB categories,
//     across ALL blocks on the page, all naming ONE product;
//   * exactly one distinct standalone title line is that same name;
//   * the block has no illustrative/sample context, and the title is not
//     the sponsor or a legal-entity name;
//   * the quote is a unique verifiable span containing the name.
import { describe, expect, it } from "vitest";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import {
  attestPlans,
  resolveRowPlanIds,
} from "@/app/lib/extraction/plan-identity";
import { validateTable } from "@/app/lib/extraction/types";
import type { CellValue, ProvenPlan } from "@/app/lib/extraction/types";


const doc = (documentId: string, pages: string[]) => ({
  documentId,
  filename: `${documentId}.pdf`,
  pages,
});

const FEHB =
  "Who may enroll in this Plan: Federal employees eligible for the Federal Employees Health Benefits Program";
const HEADER = "Enrollment codes for this Plan:";

/** A realistic FEHB-style first page around the given enrollment lines. */
function fehbPage(title: string, enrollment: string[], extra: string[] = [], declared: string = title): string {
  return [
    title, "www.example.org", "2027",
    `A Fee-for-Service Plan (${declared}) with a Preferred Provider Organization`,
    FEHB, ...extra, ...enrollment,
  ].join("\n");
}
const ZENITH_CODES = [
  HEADER,
  "131 Zenith Care - Self Only",
  "133 Zenith Care - Self Plus One",
  "132 Zenith Care - Self and Family",
];
const names = (page: string) => attestPlans([doc("d", [page])]).map((p) => p.name);

describe("negative documents", () => {
  it("does not attest from a declaration without a title line, or a title without a declaration", () => {
    expect(names([FEHB, ...ZENITH_CODES].join("\n"))).toEqual([]);
    expect(names(["Zenith Care", "www.zenith.example", FEHB].join("\n"))).toEqual([]);
  });
});

describe("F1 — every enrollment block on page 1 is considered", () => {
  it("attests nothing when two separate blocks declare different products", () => {
    const page = fehbPage("Zenith Care", [
      HEADER, "131 Zenith Care - Self Only", "133 Zenith Care - Self Plus One",
      "", "Option B", HEADER, "231 Zenith Plus - Self Only",
    ]);
    expect(names(page)).toEqual([]);
  });

  it("attests nothing when a code line for another product follows a blank line in the block", () => {
    const page = fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "", "133 Zenith Plus - Self Plus One"]);
    expect(names(page)).toEqual([]);
  });

  it("attests nothing when a second product is declared by a code line after an intervening heading", () => {
    const page = fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "Rates: Back Cover", "233 Zenith Plus - Self Plus One"]);
    expect(names(page)).toEqual([]);
  });

  it("still attests when separate blocks, blank lines and headings all declare the SAME product", () => {
    const page = fehbPage("Zenith Care", [
      HEADER, "", "131 Zenith Care - Self Only", "", "Rates: Back Cover",
      HEADER, "133 Zenith Care - Self Plus One",
    ]);
    expect(names(page)).toEqual(["Zenith Care"]);
  });

  it("joins wrapped code lines and a wrapped header", () => {
    const wrapped = fehbPage("Zenith Care", [
      "Enrollment codes for", "this Plan:", "131 Zenith Care -", "Self Only", "133 Zenith Care", "- Self Plus One",
    ]);
    expect(names(wrapped)).toEqual(["Zenith Care"]);
    const wrappedOther = fehbPage("Zenith Care", [
      HEADER, "131 Zenith Care - Self Only", "233 Zenith Plus -", "Self Plus One",
    ]);
    expect(names(wrappedOther)).toEqual([]);
  });

  it("treats distinct product names that would collapse under punctuation stripping as different", () => {
    for (const [a, b] of [["Alpha+", "Alpha"], ["Plan A-1", "Plan A1"], ["Care & Co Plan", "Care Co Plan"]]) {
      const page = fehbPage(a, [HEADER, `131 ${a} - Self Only`, `133 ${b} - Self Plus One`]);
      expect(names(page), `${a} vs ${b}`).toEqual([]);
    }
  });

  it("does not match a title that differs from the declared name only by punctuation", () => {
    expect(names(fehbPage("Alpha", [HEADER, "131 Alpha+ - Self Only"]))).toEqual([]);
  });

  it("still equates mark/space differences of ONE product (real brochure shape)", () => {
    expect(names(fehbPage("Zenith® Care", [HEADER, "131 ZenithCare - Self Only"]))).toEqual(["Zenith® Care"]);
  });
});

describe("F2 — fictitious/sample and unsupported enrollment blocks abstain", () => {
  it("does not create a phantom plan from a guide's sample enrollment block", () => {
    const guide = [
      "Understanding Your Benefits — A Member Guide",
      "Sample® Plan",
      "How to read your enrollment codes",
      HEADER,
      "999 Sample Plan - Fictional Example",
    ].join("\n");
    expect(names(guide)).toEqual([]);
  });

  it("abstains on unsupported enrollment categories even with FEHB context", () => {
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Gold Tier"]))).toEqual([]);
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "133 Zenith Care - Fictional Example"]))).toEqual([]);
  });

  it("abstains without FEHB context although the categories are supported", () => {
    const guide = ["Zenith Care", "How to read your ID card", HEADER, "131 Zenith Care - Self Only"].join("\n");
    expect(names(guide)).toEqual([]);
  });

  it("abstains when the enrollment block sits in explicit sample/illustrative context", () => {
    const sample = fehbPage("Zenith Care", ZENITH_CODES, []).replace(HEADER, `Example: this is a fictional illustration of enrollment codes.\n${HEADER}`);
    expect(names(sample)).toEqual([]);
    const labelled = fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only (sample)"]);
    expect(names(labelled)).toEqual([]);
  });

  it("control: the same page without the sample context attests (so the guard is what abstains)", () => {
    expect(names(fehbPage("Zenith Care", ZENITH_CODES))).toEqual(["Zenith Care"]);
  });
});

describe("F3 — title counting ignores the name inside enrollment-code lines", () => {
  it("attests a title that also appears inside all three code lines, with a verifiable quote", () => {
    const page = fehbPage("Zenith Care", ZENITH_CODES);
    const plans = attestPlans([doc("d", [page])]);
    expect(plans.map((p) => p.name)).toEqual(["Zenith Care"]);
    const [source] = plans[0].sources;
    expect(source).toMatchObject({ documentId: "d", page: 1 });
    expect(source.quote).toContain("Zenith Care");
    const docs = [{ documentId: "d", pageCount: 1, pages: [page] }];
    const verified = verifyEvidenceCitation(docs, source);
    expect(verified.ok).toBe(true);
    expect(verified).toEqual({ ok: true, quote: source.quote });
  });

  it("attests nothing when two DISTINCT standalone title lines match the declared name", () => {
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, ["ZENITH CARE"]))).toEqual([]);
  });

  it("an identical repeated title line is one unique title, attested only with a verifiable source", () => {
    const page = fehbPage("Zenith Care", ZENITH_CODES, ["Zenith Care"]);
    const plans = attestPlans([doc("d", [page])]);
    if (plans.length === 0) return; // fail-closed is acceptable; a wrong source is not
    const docs = [{ documentId: "d", pageCount: 1, pages: [page] }];
    expect(verifyEvidenceCitation(docs, plans[0].sources[0]).ok).toBe(true);
  });

  it("sponsor guard (control): attests without the sponsor line, abstains with it", () => {
    const sponsor = "Sponsored and administered by: Zenith Care";
    expect(names(fehbPage("Zenith Care", ZENITH_CODES))).toEqual(["Zenith Care"]);
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, [sponsor]))).toEqual([]);
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, ["Sponsored and administered by:", "Zenith Care"]))).toEqual([]);
  });

  it("legal-entity guard (control): attests 'Northwind Mutual', abstains for 'Northwind Mutual Association'", () => {
    const codes = (n: string) => [HEADER, `301 ${n} - Self Only`];
    expect(names(fehbPage("Northwind Mutual", codes("Northwind Mutual")))).toEqual(["Northwind Mutual"]);
    expect(names(fehbPage("Northwind Mutual Association", codes("Northwind Mutual Association")))).toEqual([]);
  });

  it("does not promote an enrollment category or page heading", () => {
    expect(names(fehbPage("Self Only", [HEADER, "131 Zenith Care - Self Only"], ["Section 2. Changes for 2027"]))).toEqual([]);
  });
});

describe("F4 — enrollment scope must be preserved, completely, per value", () => {
  const fehbDoc = doc("fehb", [fehbPage("Zenith Care", ZENITH_CODES)]);
  const [plan] = attestPlans([fehbDoc]) as [ProvenPlan];

  const cell = (display: string, quote: string, conditions?: string): CellValue => ({
    documentId: "fehb",
    display,
    qualifiers: conditions ? { conditions } : {},
    evidence: [{ documentId: "fehb", page: 17, quote }],
  });
  const resolve = (values: CellValue[]) => resolveRowPlanIds("annual-deductible", values, [plan], [fehbDoc]);
  const validates = (values: CellValue[]) =>
    validateTable({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "fehb", filename: "fehb.pdf", pageCount: 140 }],
      plans: [plan],
      rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values }],
    });

  const SELF_ONLY = "For Self Only contracts, the calendar year deductible is now $1,000.";
  const SELF_PLUS_FAMILY = "For Self Plus One, and Self and Family contracts, the deductible is now $2,000";

// Policy 2026-11-14: prose line values are not attributed by inference; the
// enrollment-scoped value stays displayed with its scope (unattributed).
// Restoring attribution needs a structured prose-statement claim (planned).
  it("keeps sourced single-category values distinct (displayed, unattributed)", () => {
    const values = [
      cell("$1,000", SELF_ONLY, "Self Only"),
      cell("$2,000", "For Self Plus One contracts, the deductible is now $2,000", "Self Plus One"),
    ];
    expect(() => validates(values)).not.toThrow();
    expect(hasSameScopeContradiction(values)).toBe(false);
    expect(resolve(values)).toEqual([undefined, undefined]);
  });

  it("a combined-scope value with ALL categories preserved validates (displayed, unattributed)", () => {
    const complete = cell("$2,000", SELF_PLUS_FAMILY, "Self Plus One, and Self and Family");
    expect(() => validates([complete])).not.toThrow();
    expect(resolve([complete])).toEqual([undefined]);
  });

  it("abstains on a PARTIAL scope (one of two named categories preserved)", () => {
    const partial = cell("$2,000", SELF_PLUS_FAMILY, "Self Plus One");
    expect(() => validates([partial])).not.toThrow(); // schema alone cannot see the loss
    expect(resolve([partial])).toEqual([undefined]);
    const other = cell("$2,000", SELF_PLUS_FAMILY, "Self and Family");
    expect(resolve([other])).toEqual([undefined]);
  });

  it("abstains on MISSING scope, alone or paired (no plan-wide deductible, no contradiction-as-scope)", () => {
    expect(resolve([cell("$1,000", SELF_ONLY)])).toEqual([undefined]);
    const pair = [cell("$1,000", SELF_ONLY), cell("$2,000", SELF_PLUS_FAMILY)];
    expect(hasSameScopeContradiction(pair)).toBe(true);
    expect(resolve(pair)).toEqual([undefined, undefined]);
  });

  it("keeps three separate categories with different amounts as three scoped values", () => {
    const values = [
      cell("$1,000", "For Self Only contracts, the deductible is $1,000.", "Self Only"),
      cell("$2,000", "For Self Plus One contracts, the deductible is $2,000.", "Self Plus One"),
      cell("$3,000", "For Self and Family contracts, the deductible is $3,000.", "Self and Family"),
    ];
    expect(() => validates(values)).not.toThrow();
    expect(hasSameScopeContradiction(values)).toBe(false);
    expect(resolve(values)).toEqual([undefined, undefined, undefined]);
    expect(values.map((v) => v.qualifiers.conditions)).toEqual(["Self Only", "Self Plus One", "Self and Family"]);
  });

  it("does not let one value's scope cover a scope-less peer (no cross-value inheritance)", () => {
    const values = [
      cell("$1,000", "For Self Only contracts, the deductible is $1,000.", "Self Only"),
      cell("$2,000", "For Self Plus One contracts, the deductible is $2,000."),
    ];
    expect(resolve(values)).toEqual([undefined, undefined]);
    // Order must not matter.
    expect(resolve([values[1], values[0]])).toEqual([undefined, undefined]);
  });

  it("abstains when a single sentence ties the figure to several categories but only one is preserved", () => {
    const ambiguous = cell("$1,000", "Self Only is $1,000 and Self Plus One is $2,000", "Self Only");
    expect(() => validates([ambiguous])).not.toThrow();
    expect(resolve([ambiguous])).toEqual([undefined]);
  });

  it("abstains rather than losing scope when wrapped (multiline) evidence cannot support the condition", () => {
    // Canonical quotes keep the PDF's line break; the clause rule cannot tie the
    // category to the figure across it, so the scope would vanish downstream.
    const wrapped = cell(
      "$2,000",
      "For Self Plus One, and Self and Family contracts, the\ndeductible is now $2,000",
      "Self Plus One, and Self and Family",
    );
    expect(resolve([wrapped])).toEqual([undefined]);
    const wrappedSingle = cell("$1,000", "For Self Only contracts,\nthe calendar year deductible is now $1,000.", "Self Only");
    expect(resolve([wrappedSingle])).toEqual([undefined]);
  });

  it("does not affect a figure whose own sentence names no category", () => {
    const neutral = cell("$600", "Tier 3 specialty drugs: up to a maximum of $600 for a 30-day supply.");
    // No enrollment gate fires; the line value is still not attributed by
    // inference (policy 2026-11-14).
    expect(resolveRowPlanIds("prescriptions", [{ ...neutral, evidence: [{ ...neutral.evidence[0], quote: "Tier 3 specialty prescription drugs: up to a maximum of $600 for a 30-day supply." }] }], [plan], [fehbDoc])).toEqual([undefined]);
  });
});


describe("Invariant A — complete enrollment declaration parsing", () => {
  it("abstains when a wrapped record names a second product (code line, then name split across lines)", () => {
    const page = fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "233 Zenith", "Plus - Self Plus One"]);
    expect(names(page)).toEqual([]);
  });

  it("abstains when the code is alone on its line and the other product's name follows", () => {
    const page = fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "233", "Zenith Plus - Self Plus One"]);
    expect(names(page)).toEqual([]);
  });

  it("abstains when a code-like record never parses (partial record inside the declaration)", () => {
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "233 Zenith Plus", "Rates: Back Cover"]))).toEqual([]);
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "233"]))).toEqual([]);
  });

  it("abstains when a code-like record with an unsupported category follows a heading", () => {
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "Rates: Back Cover", "299 Zenith Plus - Platinum"]))).toEqual([]);
  });

  it("attests legitimate records wrapped inside the name, inside the category, and after the code", () => {
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith", "Care - Self Only", "133 Zenith Care - Self Plus", "One", "132", "Zenith Care - Self and Family"]))).toEqual(["Zenith Care"]);
    expect(names(fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self", "Only"]))).toEqual(["Zenith Care"]);
  });

  it("abstains on normalized-name collisions between distinct literal products", () => {
    const page = fehbPage("Zenith Care", [HEADER, "131 Zenith Care - Self Only", "133 ZenithCare - Self Plus One"]);
    expect(names(page)).toEqual([]);
    const marks = fehbPage("Zenith Care", [HEADER, "131 Zenith® Care - Self Only", "133 Zenith Care - Self Plus One"]);
    expect(names(marks)).toEqual(["Zenith Care"]); // a registered mark is not a different product
  });

});

describe("Invariant B — an actual plan identity, not an educational example", () => {
  const base = fehbPage("Zenith Care", ZENITH_CODES);

  it("requires product-specific corroboration from an affirmative plan declaration", () => {
    const noDeclaration = base.replace(/^A Fee-for-Service Plan.*$/m, "A health benefits option");
    expect(names(noDeclaration)).toEqual([]);
    const otherProduct = fehbPage("Zenith Care", ZENITH_CODES, [], "Another Product");
    expect(names(otherProduct)).toEqual([]);
    expect(names(base)).toEqual(["Zenith Care"]); // control
  });

  it("rejects an educational guide that states it is not a plan brochure", () => {
    for (const statement of [
      "This guide is not a plan brochure.",
      "This document is not an official statement of benefits.",
      "This guide is for educational purposes only.",
      "The enrollment codes shown here are for illustration purposes.",
    ]) {
      expect(names(fehbPage("Zenith Care", ZENITH_CODES, [statement])), statement).toEqual([]);
    }
  });

  it("rejects hypothetical or fictional enrollment-code demonstrations", () => {
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, ["The codes below are hypothetical."]))).toEqual([]);
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, ["Zenith Care is a fictional plan used to teach ID cards."]))).toEqual([]);
    // Non-adjacent: the statement sits well above the block, not beside it.
    const far = ["The codes in this guide are hypothetical.", "Line one.", "Line two.", "Line three.", "Line four."];
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, far))).toEqual([]);
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, ["Line one.", "Line two.", "Zenith Care is a fictitious plan.", "Line three.", "Line four."]))).toEqual([]);
  });

  it("rejects an enrollment block that follows a non-adjacent sample/example section", () => {
    const page = fehbPage("Zenith Care", [
      "Example: reading your enrollment codes",
      "Your ID card lists a three-digit code, the plan name and your contract type.",
      "Keep the card with you whenever you receive care.",
      "Call the number on the back of the card with any questions.",
      ...ZENITH_CODES,
    ]);
    expect(names(page)).toEqual([]);
    const trailing = fehbPage("Zenith Care", ZENITH_CODES, ["How to read your ID card (example)"]);
    expect(names(trailing)).toEqual([]);
  });

  it("rejects mixed real and sample enrollment declarations", () => {
    const sampleName = fehbPage("Zenith Care", [...ZENITH_CODES, "Sample enrollment codes:", HEADER, "999 Sample Plan - Self Only"]);
    expect(names(sampleName)).toEqual([]);
    const sameName = fehbPage("Zenith Care", [...ZENITH_CODES, "Sample enrollment codes:", HEADER, "999 Zenith Care - Self Only"]);
    expect(names(sameName)).toEqual([]);
  });

  it("is not a global keyword deny-list: ordinary 'for example' prose on a real brochure still attests", () => {
    const prose = fehbPage("Zenith Care", ZENITH_CODES, [
      "For example, benefits for covered services are described in Section 5 of this brochure.",
      "This brochure is the official statement of benefits.",
    ]);
    expect(names(prose)).toEqual(["Zenith Care"]);
  });
});

describe("Invariant C — enrollment scope gates every attribution path (explicit planId)", () => {
  const fehbDoc = doc("fehb", [fehbPage("Zenith Care", ZENITH_CODES)]);
  const [plan] = attestPlans([fehbDoc]) as [ProvenPlan];
  const SOURCE = "For Self Plus One, and Self and Family contracts, the deductible is now $2,000";
  const labelled = `Plan name: ${plan.name}; annual-deductible: $2,000`;

  const claimed = (conditions?: string, planId: string = plan.planId): CellValue => ({
    documentId: "fehb",
    planId,
    display: "$2,000",
    qualifiers: conditions ? { conditions } : {},
    evidence: [
      { documentId: "fehb", page: 2, quote: labelled },
      { documentId: "fehb", page: 2, quote: SOURCE },
    ],
  });
  const resolve = (v: CellValue) => resolveRowPlanIds("annual-deductible", [v], [plan], [fehbDoc]);

  it("abstains for a labelled explicit-planId value with MISSING category conditions", () => {
    expect(resolve(claimed())).toEqual([undefined]);
  });
  it("abstains for a labelled explicit-planId value with PARTIAL category conditions", () => {
    expect(resolve(claimed("Self Plus One"))).toEqual([undefined]);
    expect(resolve(claimed("Self and Family"))).toEqual([undefined]);
  });
  it("attributes the labelled value when the conditions are COMPLETE", () => {
    expect(resolve(claimed("Self Plus One, and Self and Family"))).toEqual([plan.planId]);
  });
  it("leaves C6 labelled proof unchanged for a document that declares no enrollment categories", () => {
    const alpha = doc("a", ["Policy name: Alpha"]);
    const [alphaPlan] = attestPlans([alpha]);
    const v: CellValue = {
      documentId: "a", planId: alphaPlan.planId, display: "$250", qualifiers: {},
      evidence: [{ documentId: "a", page: 1, quote: "Policy name: Alpha; annual-deductible: $250" }],
    };
    expect(resolveRowPlanIds("annual-deductible", [v], [alphaPlan], [alpha])).toEqual([alphaPlan.planId]);
  });
  it("does not infer a category from a neighbouring value", () => {
    const scoped = claimed("Self Plus One, and Self and Family");
    const bare = claimed();
    expect(resolveRowPlanIds("annual-deductible", [scoped, bare], [plan], [fehbDoc])).toEqual([plan.planId, undefined]);
    expect(resolveRowPlanIds("annual-deductible", [bare, scoped], [plan], [fehbDoc])).toEqual([undefined, plan.planId]);
  });
});

describe("Final corrections — incomplete wrapped records and non-official plan documents", () => {
  const HEAD = [
    "Zenith Care",
    "A Fee-for-Service Plan (Zenith Care) with a Preferred Provider Organization",
    FEHB,
  ];

  it("Case A: a wrapped record with an unsupported category after a heading abstains", () => {
    const page = [...HEAD, HEADER, "131 Zenith Care - Self Only", "Rates: Back Cover", "233 Zenith Plus", "- Platinum"].join("\n");
    expect(attestPlans([doc("d", [page])])).toEqual([]);
  });

  it("Case B: a wrapped record that exceeds the assembly limit after a heading abstains", () => {
    const page = [
      ...HEAD, HEADER, "131 Zenith Care - Self Only", "Rates: Back Cover",
      "233 Zenith", "Plus", "-", "Self", "Plus One",
    ].join("\n");
    expect(attestPlans([doc("d", [page])])).toEqual([]);
  });

  it("control: the same pages without the interrupted record attest", () => {
    const page = [...HEAD, HEADER, "131 Zenith Care - Self Only", "Rates: Back Cover"].join("\n");
    expect(attestPlans([doc("d", [page])]).map((p) => p.name)).toEqual(["Zenith Care"]);
  });

  it("does not treat unrelated page numbers or year lines outside the enrollment context as records", () => {
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, ["15", "2027"]))).toEqual(["Zenith Care"]);
    const after = [...fehbPage("Zenith Care", ZENITH_CODES).split("\n"), "Rates: Back Cover", "15"].join("\n");
    expect(names(after)).toEqual(["Zenith Care"]);
  });

  it("rejects an educational guide that says it is not an official plan document", () => {
    const statement = "This educational guide explains FEHB enrollment and is not an official plan document.";
    expect(names(fehbPage("Zenith Care", ZENITH_CODES, [statement]))).toEqual([]);
    // The same statement must also win when it is the only role signal on the page.
    const page = [...HEAD, statement, ...ZENITH_CODES].join("\n");
    expect(attestPlans([doc("d", [page])])).toEqual([]);
  });
});
