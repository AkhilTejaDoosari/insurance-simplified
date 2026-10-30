import { describe, expect, it } from "vitest";
import { attestPlans, attributePlanScope } from "@/app/lib/extraction/plan-identity";
import type { ComparisonTable } from "@/app/lib/extraction/types";

describe("source-attested plan identity", () => {
  it("recognizes an explicit product title without using its filename", () => {
    const plans = attestPlans([{
      documentId: "doc-wt",
      filename: "misleading-name.pdf",
      pages: ["Get StudentSecure insurance from WorldTrips, a member of its insurer group."],
    }]);

    expect(plans.map((plan) => plan.name)).toEqual(["StudentSecure"]);
    expect(plans[0].sources[0]).toMatchObject({
      documentId: "doc-wt",
      page: 1,
      quote: "Get StudentSecure insurance from WorldTrips, a member of its insurer group.",
    });
  });

  it("recognizes a standalone insurer product title but not a carrier-only mention", () => {
    const plans = attestPlans([{
      documentId: "doc-sc",
      filename: "Travel-Medical-Basic.pdf",
      pages: ["Seven Corners Travel Medical Including the USA\nSeven Corners Assist provides support."],
    }]);

    expect(plans.map((plan) => plan.name)).toEqual(["Travel Medical Including the USA"]);
    expect(plans[0].sources[0].quote).toBe("Seven Corners Travel Medical Including the USA");
  });

  it("attests a first-page program title when immediately identified as a certificate of insurance", () => {
    const plans = attestPlans([{
      documentId: "doc-program",
      filename: "unrelated-filename.pdf",
      pages: ["Patriot Exchange ProgramSM\nCertificate of Insurance\nPolicy terms follow."],
    }]);

    expect(plans.map((plan) => plan.name)).toEqual(["Patriot Exchange ProgramSM"]);
    expect(plans[0].sources[0]).toMatchObject({
      documentId: "doc-program",
      page: 1,
      quote: "Patriot Exchange ProgramSM",
    });
  });

  it("finds two explicit plan titles on one PDF without assigning their facts", () => {
    const plans = attestPlans([{ documentId: "doc-a", pages: ["Policy name: Alpha\nPolicy name: Beta"], filename: "same.pdf" }]);
    expect(plans.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    expect(plans[0].sources).toEqual([{ documentId: "doc-a", page: 1, quote: "Policy name: Alpha" }]);
  });

  it("joins two PDFs only with the same explicit identifier and name", () => {
    const pages = ["Policy name: Alpha; Policy ID: ABC-123; Issuer: Acme"];
    const plans = attestPlans([{ documentId: "a", filename: "one.pdf", pages }, { documentId: "b", filename: "two.pdf", pages }]);
    expect(plans).toHaveLength(1);
    expect(plans[0].sources.map((s) => s.documentId)).toEqual(["a", "b"]);
    expect(plans[0].policyIdentifier).toBe("ABC-123");
    expect(plans[0].issuer).toBe("Acme");
  });

  it("does not merge name-only PDFs or invent identity from similar filenames", () => {
    const plans = attestPlans([
      { documentId: "a", filename: "Alpha.pdf", pages: ["Policy name: Alpha"] },
      { documentId: "b", filename: "Alpha.pdf", pages: ["Policy name: Alpha"] },
      { documentId: "c", filename: "Alpha.pdf", pages: ["Generic benefits"] },
    ]);
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.sources.length === 1)).toBe(true);
    expect(plans.some((p) => p.sources[0].documentId === "c")).toBe(false);
  });
  it("keeps identical product names and IDs from different or unproven issuers separate", () => {
    const plans = attestPlans([
      { documentId: "a", filename: "same.pdf", pages: ["Policy name: Alpha; Policy ID: ABC-123; Issuer: Acme"] },
      { documentId: "b", filename: "same.pdf", pages: ["Policy name: Alpha; Policy ID: ABC-123; Issuer: Other"] },
      { documentId: "c", filename: "same.pdf", pages: ["Policy name: Alpha; Policy ID: ABC-123"] },
    ]);
    expect(plans).toHaveLength(3);
  });
});

describe("D6 plan/value attribution regressions", () => {
  function table(values: ComparisonTable["rows"][number]["values"], plans: ComparisonTable["plans"]): ComparisonTable {
    return {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "brochure.pdf", pageCount: 2 }],
      plans,
      rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values }],
    };
  }

  it("assigns a value only when its evidence names the plan", () => {
    const plans = [
      { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }] },
      { planId: "plan-b", name: "Beta", sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Beta" }] },
    ];
    const values: ComparisonTable["rows"][number]["values"] = [
      { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Alpha deductible is $250." }] },
      { documentId: "doc-1", display: "$500", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Beta deductible is $500." }] },
      { documentId: "doc-1", display: "$900", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Shared deductible $900." }] },
    ];
    const scoped = attributePlanScope(table(values, plans), [{ documentId: "doc-1", filename: "brochure.pdf", pages: ["Plan name: Alpha\nPlan name: Beta"] }]);
    expect(scoped.rows[0].values[0].planId).toBe("plan-a");
    expect(scoped.rows[0].values[1].planId).toBe("plan-b");
    expect(scoped.rows[0].values[2].planId).toBeUndefined();
  });

  it("does not assign unlabeled values to the last preceding plan declaration", () => {
    const plans = [
      { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }] },
      { planId: "plan-b", name: "Beta", sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Beta" }] },
    ];
    const values: ComparisonTable["rows"][number]["values"] = [
      { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Deductible $250" }] },
    ];
    const scoped = attributePlanScope(table(values, plans), [{ documentId: "doc-1", filename: "brochure.pdf", pages: ["Plan name: Alpha\nPlan name: Beta"] }]);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("keeps an explicit planId claim only when the evidence names the plan", () => {
    const plans = [
      { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }] },
    ];
    const values: ComparisonTable["rows"][number]["values"] = [
      { documentId: "doc-1", planId: "plan-a", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "The annual deductible is $250." }] },
      { documentId: "doc-1", planId: "plan-a", display: "$500", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Alpha deductible is $500." }] },
    ];
    const scoped = attributePlanScope(table(values, plans), [{ documentId: "doc-1", filename: "brochure.pdf", pages: ["Plan name: Alpha"] }]);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
    expect(scoped.rows[0].values[1].planId).toBe("plan-a");
  });
});

describe("C6 repro: same-page plan declarations never attribute values", () => {
  function docTable(opts: {
    pages: string[];
    values: ComparisonTable["rows"][number]["values"];
    plans: ComparisonTable["plans"];
  }): { table: ComparisonTable; documents: Parameters<typeof attributePlanScope>[1] } {
    return {
      table: {
        schemaVersion: "v1",
        factListVersion: "v1",
        documents: [{ documentId: "doc-1", filename: "brochure.pdf", pageCount: opts.pages.length }],
        plans: opts.plans,
        rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: opts.values }],
      },
      documents: [{ documentId: "doc-1", filename: "brochure.pdf", pages: opts.pages }],
    };
  }

  it("does not attribute a value just because the page repeats a single plan declaration", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Policy name: Alpha\nAnnual deductible: $250"],
      values: [
        { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("does not absorb an example figure into the plan that shares its page", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Example: a comparable plan's deductible is $900"],
      values: [
        { documentId: "doc-1", display: "$900", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Example: a comparable plan's deductible is $900" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("does not absorb a competitor's stated figure into the declared plan", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Competitor Gamma deductible is $500"],
      values: [
        { documentId: "doc-1", display: "$500", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Competitor Gamma deductible is $500" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("attributes a value whose own evidence names exactly one proven plan", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Alpha's annual deductible is $250"],
      values: [
        { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Alpha's annual deductible is $250" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBe("plan-a");
  });

  it("attributes four-PDF values whose evidence names their plan, and never from page structure", () => {
    const docs = [
      { documentId: "doc-a", filename: "a.pdf", pages: ["Policy name: Alpha", "Alpha annual deductible $250"] },
      { documentId: "doc-b", filename: "b.pdf", pages: ["Policy name: Beta", "Beta annual deductible $500"] },
    ];
    const table: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: docs.map((d) => ({ documentId: d.documentId, filename: d.filename, pageCount: d.pages.length })),
      plans: [
        { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-a", page: 1, quote: "Policy name: Alpha" }] },
        { planId: "plan-b", name: "Beta", sources: [{ documentId: "doc-b", page: 1, quote: "Policy name: Beta" }] },
      ],
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          { documentId: "doc-a", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-a", page: 2, quote: "Alpha annual deductible $250" }] },
          { documentId: "doc-b", display: "$500", qualifiers: {}, evidence: [{ documentId: "doc-b", page: 2, quote: "Beta annual deductible $500" }] },
        ],
      }],
    };
    const scoped = attributePlanScope(table, docs);
    expect(scoped.rows[0].values[0].planId).toBe("plan-a");
    expect(scoped.rows[0].values[1].planId).toBe("plan-b");

    // Structural equivalence without a name mention stays unassigned.
    const unmentioned: ComparisonTable = {
      ...table,
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: table.rows[0].values.map((value) => ({
          ...value,
          evidence: value.evidence.map((e) => ({
            ...e,
            quote: e.quote.replace(/^(Alpha|Beta) /, ""),
          })),
        })),
      }],
    };
    const unscoped = attributePlanScope(unmentioned, docs);
    expect(unscoped.rows[0].values[0].planId).toBeUndefined();
    expect(unscoped.rows[0].values[1].planId).toBeUndefined();
  });

  it("keeps a value unassigned when its evidence names more than one proven plan", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha\nPolicy name: Beta", "Alpha and Beta deductibles are $250 and $500"],
      values: [
        { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Alpha and Beta deductibles are $250 and $500" }] },
      ],
      plans: [
        { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] },
        { planId: "plan-b", name: "Beta", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Beta" }] },
      ],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("does not count a substring occurrence as a plan-name mention", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Alphabet plans compare well; deductible $250"],
      values: [
        { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Alphabet plans compare well; deductible $250" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("leaves a value unassigned when the page declares multiple plans", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha\nPolicy name: Beta", "Annual deductible: $250"],
      values: [
        { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250" }] },
      ],
      plans: [
        { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] },
        { planId: "plan-b", name: "Beta", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Beta" }] },
      ],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("rejects cross-document plan attribution", () => {
    const table: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-a", filename: "a.pdf", pageCount: 1 },
        { documentId: "doc-b", filename: "b.pdf", pageCount: 1 },
      ],
      plans: [
        { planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-a", page: 1, quote: "Policy name: Alpha" }] },
        { planId: "plan-b", name: "Beta", sources: [{ documentId: "doc-b", page: 1, quote: "Policy name: Beta" }] },
      ],
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [{ documentId: "doc-b", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-b", page: 1, quote: "Alpha annual deductible $250" }] }],
      }],
    };
    const scoped = attributePlanScope(table, [
      { documentId: "doc-a", filename: "a.pdf", pages: ["Policy name: Alpha"] },
      { documentId: "doc-b", filename: "b.pdf", pages: ["Annual deductible: $250"] },
    ]);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });

  it("keeps an explicit planId claim only when the evidence names that plan", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Alpha deductible $250"],
      values: [
        { documentId: "doc-1", planId: "plan-a", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Alpha deductible $250" }] },
        { documentId: "doc-1", planId: "plan-a", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBe("plan-a");
    expect(scoped.rows[0].values[1].planId).toBeUndefined();
  });

  it("does not absorb a value into a plan merely because a single plan is declared on another page", () => {
    const { table, documents } = docTable({
      pages: ["Policy name: Alpha", "Shared deductible: $900"],
      values: [
        { documentId: "doc-1", display: "$900", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Shared deductible: $900" }] },
      ],
      plans: [{ planId: "plan-a", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
    });
    const scoped = attributePlanScope(table, documents);
    expect(scoped.rows[0].values[0].planId).toBeUndefined();
  });
});
