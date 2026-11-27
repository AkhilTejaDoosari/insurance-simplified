import { describe, expect, it } from "vitest";
import {
  buildPresentation,
  indexFacts,
  validatePresentation,
  projectView,
  type ActiveView,
} from "@/app/lib/presentation/adaptive";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

export const fixture: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  resultFingerprint: "adaptive-fixture",
  documents: ["a", "b", "c"].map((id) => ({
    documentId: id,
    filename: `${id}.pdf`,
    pageCount: 2,
  })),
  plans: ["a", "b", "c"].map((id) => ({
    planId: `plan-${id}`,
    name: id.toUpperCase(),
    sources: [{ documentId: id, page: 1, quote: id.toUpperCase() }],
  })),
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: ["a", "b", "c"].map((id, i) => ({
        documentId: id,
        planId: `plan-${id}`,
        display: `${500 + i * 250} USD`,
        qualifiers: {
          currency: "USD",
          period: "per year",
          networkTier: "in-network",
          selectionStatus: "purchased" as const,
        },
        evidence: [
          {
            documentId: id,
            page: 1,
            quote: `Your selected deductible is ${500 + i * 250} USD per year in-network`,
            evidenceId: `ev-${id}-cost`,
          },
        ],
      })),
    },
    {
      factName: "material-exclusions",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "a",
          display: "Hazardous sports excluded",
          qualifiers: {},
          evidence: [
            {
              documentId: "a",
              page: 2,
              quote: "Hazardous sports excluded",
              evidenceId: "ev-unassigned",
            },
          ],
        },
      ],
    },
    {
      factName: "waiting-period",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "a",
          planId: "plan-a",
          display: "30 days",
          qualifiers: {},
          evidence: [
            {
              documentId: "a",
              page: 2,
              quote: "Waiting period 30 days",
              evidenceId: "ev-wait",
            },
          ],
        },
      ],
    },
    ...Array.from({ length: 60 }, (_, i) => ({
      factName: `irrelevant-${i}`,
      verdict: "NOT STATED" as const,
      values: [],
    })),
  ],
};
const compare: ActiveView = {
  mode: "compare",
  planIds: ["plan-b", "plan-a"],
  tiers: {},
};
const single: ActiveView = {
  mode: "understand",
  documentId: "a",
  planIds: ["plan-a"],
  tiers: {},
};

describe("evidence-driven presentation contract", () => {
  it("gives an unattributed document a readable topic view, explicitly not confirmed plan coverage", () => {
    const unknown = {
      ...fixture,
      plans: [],
      rows: fixture.rows.map((r) => ({
        ...r,
        values: r.values.map((v) => ({ ...v, planId: undefined })),
      })),
    };
    const view: ActiveView = { ...single, planIds: [] };
    const spec = buildPresentation(unknown, view, {});
    expect(spec.blocks.some((b) => b.type === "key-value-group")).toBe(true);
    expect(spec.blocks.flatMap((b) => b.uncertainty)).not.toContain(
      "verified-plan",
    );
    expect(validatePresentation(spec, unknown, view, {})).not.toBeNull();
  });
  it("adapts to observed dimensions and never restores a universal absent-row inventory", () => {
    const spec = buildPresentation(fixture, compare, {});
    expect(spec.blocks.some((b) => b.type === "comparison-table")).toBe(true);
    expect(JSON.stringify(spec)).not.toContain("irrelevant-");
    expect(spec.scope.planIds).toEqual(["plan-b", "plan-a"]);
    expect(validatePresentation(spec, fixture, compare, {})).not.toBeNull();
  });
  it("uses one dynamic comparison table without charts, timelines, or a duplicate matrix", () => {
    const withCoverage: Table = {
      ...fixture,
      rows: [
        ...fixture.rows,
        {
          factName: "emergency-care",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "plan-a",
              display: "Covered",
              qualifiers: {},
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Emergency care covered",
                  evidenceId: "ev-a-emergency",
                },
              ],
            },
            {
              documentId: "b",
              planId: "plan-b",
              display: "Not covered",
              qualifiers: {},
              evidence: [
                {
                  documentId: "b",
                  page: 1,
                  quote: "Emergency care not covered",
                  evidenceId: "ev-b-emergency",
                },
              ],
            },
          ],
        },
      ],
    };
    const spec = buildPresentation(withCoverage, compare, {});
    const visualTypes = [
      "bar-chart",
      "timeline",
      "coverage-matrix",
      "proportion-chart",
    ];

    expect(
      spec.blocks.filter((block) => block.type === "comparison-table"),
    ).toHaveLength(1);
    expect(
      spec.blocks.some((block) => visualTypes.includes(block.type)),
    ).toBe(false);
  });
  it("does not repeat uncertain comparison facts in a second unresolved-facts block", () => {
    const uncertain: Table = {
      ...fixture,
      rows: fixture.rows.map((row) =>
        row.factName === "waiting-period"
          ? { ...row, verdict: "NEEDS VERIFICATION" }
          : row,
      ),
    };

    const spec = buildPresentation(uncertain, compare, {});

    expect(
      spec.blocks.find((block) => block.type === "unresolved-questions"),
    ).toBeUndefined();
    expect(
      spec.blocks
        .find((block) => block.type === "comparison-table")
        ?.factIds.some((id) => id.startsWith("waiting-period:")),
    ).toBe(true);
  });
  it("rejects a proposed second comparison table", () => {
    const spec = buildPresentation(fixture, compare, {});
    const comparison = spec.blocks.find(
      (block) => block.type === "comparison-table",
    )!;

    expect(
      validatePresentation(
        { ...spec, blocks: [...spec.blocks, comparison] },
        fixture,
        compare,
        {},
      ),
    ).toBeNull();
  });
  it("rejects per-fact cards as an alternate comparison presentation", () => {
    const spec = buildPresentation(fixture, compare, {});
    const comparison = spec.blocks.find(
      (block) => block.type === "comparison-table",
    )!;
    const alternate = {
      ...comparison,
      type: "key-value-group" as const,
      purpose: "Read related documented facts together.",
    };

    expect(
      validatePresentation(
        {
          ...spec,
          blocks: spec.blocks.map((block) =>
            block === comparison ? alternate : block,
          ),
        },
        fixture,
        compare,
        {},
      ),
    ).toBeNull();
  });
  it("rejects duplicate summary blocks in a proposed presentation", () => {
    const spec = buildPresentation(fixture, compare, {});
    const summary = spec.blocks.find((block) => block.type === "finding")!;

    expect(
      validatePresentation(
        { ...spec, blocks: [...spec.blocks, summary] },
        fixture,
        compare,
        {},
      ),
    ).toBeNull();
  });
  it("rejects a proposed summary with more than three findings", () => {
    const spec = buildPresentation(fixture, compare, {});
    const summary = spec.blocks.find((block) => block.type === "finding")!;
    const selected = indexFacts(fixture, compare).slice(0, 4);
    const expandedSummary = {
      ...summary,
      factIds: selected.map((fact) => fact.id),
      uncertainty: [...new Set(selected.map((fact) => fact.state))],
      qualifiers: selected.map((fact) => ({
        factId: fact.id,
        values: fact.qualifiers,
      })),
      interpretations: selected.map((fact) => ({
        factId: fact.id,
        values: fact.interpretations,
      })),
      evidence: selected.map((fact) => ({
        factId: fact.id,
        evidenceIds: fact.value.evidence.map((evidence) => evidence.evidenceId),
      })),
    };

    expect(
      validatePresentation(
        {
          ...spec,
          blocks: spec.blocks.map((block) =>
            block === summary ? expandedSummary : block,
          ),
        },
        fixture,
        compare,
        {},
      ),
    ).toBeNull();
  });
  it("rejects facts repeated in the unresolved-question block", () => {
    const withQuestion: Table = {
      ...fixture,
      rows: [
        ...fixture.rows,
        {
          factName: "premium",
          verdict: "NEEDS VERIFICATION",
          values: [],
          rationale: "Varies by age.",
        },
      ],
    };
    const spec = buildPresentation(withQuestion, compare, {});
    const unresolved = spec.blocks.find(
      (block) => block.type === "unresolved-questions",
    )!;
    const fact = indexFacts(withQuestion, compare)[0];
    const duplicate = {
      ...unresolved,
      factIds: [fact.id],
      uncertainty: [fact.state],
      qualifiers: [{ factId: fact.id, values: fact.qualifiers }],
      interpretations: [{ factId: fact.id, values: fact.interpretations }],
      evidence: [
        {
          factId: fact.id,
          evidenceIds: fact.value.evidence.map((evidence) => evidence.evidenceId),
        },
      ],
    };

    expect(
      validatePresentation(
        { ...spec, blocks: spec.blocks.map((block) => block === unresolved ? duplicate : block) },
        withQuestion,
        compare,
        {},
      ),
    ).toBeNull();
  });
  it("keeps verified plan facts out of unassigned-evidence disclosure proposals", () => {
    const spec = buildPresentation(fixture, compare, {});
    const disclosure = spec.blocks.find(
      (block) => block.type === "evidence-disclosure",
    )!;
    const fact = indexFacts(fixture, compare).find(
      (item) => item.state === "verified-plan",
    )!;
    const expandedDisclosure = {
      ...disclosure,
      factIds: [...disclosure.factIds, fact.id],
      uncertainty: [...new Set([...disclosure.uncertainty, fact.state])],
      qualifiers: [
        ...disclosure.qualifiers,
        { factId: fact.id, values: fact.qualifiers },
      ],
      interpretations: [
        ...disclosure.interpretations,
        { factId: fact.id, values: fact.interpretations },
      ],
      evidence: [
        ...disclosure.evidence,
        {
          factId: fact.id,
          evidenceIds: fact.value.evidence.map((evidence) => evidence.evidenceId),
        },
      ],
    };

    expect(
      validatePresentation(
        {
          ...spec,
          blocks: spec.blocks.map((block) =>
            block === disclosure ? expandedDisclosure : block,
          ),
        },
        fixture,
        compare,
        {},
      ),
    ).toBeNull();
  });
  it("shows unassigned document facts once in the individual reading, not in duplicate disclosure", () => {
    const fact = indexFacts(fixture, single).find(
      (item) => item.concept === "material-exclusions",
    )!;
    const spec = buildPresentation(fixture, single, {});

    expect(
      spec.blocks.some(
        (block) =>
          block.type === "key-value-group" && block.factIds.includes(fact.id),
      ),
    ).toBe(true);
    expect(
      spec.blocks.some(
        (block) =>
          block.type === "evidence-disclosure" &&
          block.factIds.includes(fact.id),
      ),
    ).toBe(false);
  });
  it("scopes an individual reading, its evidence, and every component to the chosen document", () => {
    const spec = buildPresentation(fixture, single, {});
    const facts = indexFacts(fixture, single);
    expect(facts.every((f) => f.value.documentId === "a")).toBe(true);
    expect(spec.blocks.some((b) => b.type === "key-value-group")).toBe(true);
    const projected = projectView(fixture, single);
    expect(projected.documents.map((d) => d.documentId)).toEqual(["a"]);
    expect(
      projected.rows
        .flatMap((r) => r.values)
        .every((v) => v.documentId === "a"),
    ).toBe(true);
  });
  it("preserves unassigned document evidence without manufacturing plan applicability", () => {
    const fact = indexFacts(fixture, single).find(
      (f) => f.concept === "material-exclusions",
    )!;
    expect(fact.state).toBe("unverified-applicability");
    expect(fact.scope.planIds).toEqual([]);
    const spec = buildPresentation(fixture, single, {});
    expect(
      spec.blocks.some(
        (b) => b.type === "key-value-group" && b.factIds.includes(fact.id),
      ),
    ).toBe(true);
    expect(
      spec.blocks.some(
        (b) => b.type === "evidence-disclosure" && b.factIds.includes(fact.id),
      ),
    ).toBe(false);
  });
  it("rejects invented fact IDs, executable/configuration payloads, and unsupported prose", () => {
    const good = buildPresentation(fixture, compare, {});
    for (const block of [
      { ...good.blocks[0], factIds: ["invented"] },
      { ...good.blocks[0], html: "<script>alert(1)</script>" },
      { ...good.blocks[0], heading: "Guaranteed free coverage" },
    ])
      expect(
        validatePresentation(
          { ...good, blocks: [block] },
          fixture,
          compare,
          {},
        ),
      ).toBeNull();
  });
  it("uses deterministic adaptive fallback when an optional proposal is invalid", () => {
    expect(
      buildPresentation(
        fixture,
        single,
        {},
        { blocks: [{ type: "javascript" }] },
      ),
    ).toEqual(buildPresentation(fixture, single, {}));
  });
  it("supports two independently proven plans in one PDF without creating a second document", () => {
    const combined: Table = {
      ...fixture,
      plans: fixture.plans!.map((p) =>
        p.planId === "plan-b"
          ? { ...p, sources: p.sources.map((s) => ({ ...s, documentId: "a" })) }
          : p,
      ),
      rows: fixture.rows.map((r) => ({
        ...r,
        values: r.values.map((v) =>
          v.planId === "plan-b"
            ? {
                ...v,
                documentId: "a",
                evidence: v.evidence.map((e) => ({ ...e, documentId: "a" })),
              }
            : v,
        ),
      })),
    };
    const spec = buildPresentation(combined, compare, {});
    expect(
      projectView(combined, compare).documents.map((d) => d.documentId),
    ).toEqual(["a"]);
    expect(spec.scope.planIds).toEqual(["plan-b", "plan-a"]);
    expect(
      indexFacts(combined, { ...single, planIds: ["plan-b"] })
        .filter((f) => f.state === "verified-plan")
        .every((f) => f.scope.planIds[0] === "plan-b"),
    ).toBe(true);
  });
  it("keeps conflicting and incomplete facts unresolved, but does not call cross-plan differences conflicts", () => {
    expect(
      indexFacts(fixture, compare).some(
        (f) => f.state === "conflicting-evidence",
      ),
    ).toBe(false);
    const changed = structuredClone(fixture);
    changed.rows[0].values.push({
      ...changed.rows[0].values[0],
      display: "900 USD",
    });
    const spec = buildPresentation(changed, compare, {});
    expect(
      indexFacts(changed, compare).some(
        (f) => f.state === "conflicting-evidence",
      ),
    ).toBe(true);
    expect(
      spec.blocks.find((block) => block.type === "comparison-table")?.factIds
        .length,
    ).toBeGreaterThan(0);
    expect(
      spec.blocks.some((block) => block.type === "unresolved-questions"),
    ).toBe(false);
    changed.rows[0].verdict = "NEEDS VERIFICATION";
    expect(
      indexFacts(changed, compare).some(
        (f) => f.state === "needs-verification",
      ),
    ).toBe(true);
  });
  it("retains the selected tier, age, network, and deductible conditions without a purchased-option inference", () => {
    const changed = structuredClone(fixture);
    const base = changed.rows[0].values[0];
    changed.rows[0].values = [
      {
        ...base,
        display: "500 USD",
        qualifiers: {
          ...base.qualifiers,
          planTier: "Basic",
          selectionStatus: "selectable",
          ageBand: "25-29",
          conditions: "Prior approval required",
        },
        evidence: [
          {
            ...base.evidence[0],
            quote:
              "Basic deductible options 500 USD per year in-network ages 25-29. Prior approval required",
          },
        ],
      },
      {
        ...base,
        display: "900 USD",
        qualifiers: { planTier: "Elite" },
        evidence: [
          {
            ...base.evidence[0],
            evidenceId: "ev-elite",
            quote: "Elite 900 USD",
          },
        ],
      },
    ];
    const view = { ...single, tiers: { "plan-a": "Basic" } };
    const facts = indexFacts(changed, view);
    expect(facts.some((f) => f.value.display === "900 USD")).toBe(false);
    expect(
      facts.find((f) => f.concept === "annual-deductible")!.value.qualifiers
        .selectionStatus,
    ).toBe("selectable");
    expect(
      facts.find((f) => f.concept === "annual-deductible")!.qualifiers
        .networkTier,
    ).toBe("in-network");
  });
  it("rejects prototype vocabulary, missing evidence, wrong pages, and foreign fact references", () => {
    const spec = buildPresentation(fixture, single, {});
    expect(
      validatePresentation(
        { ...spec, blocks: [{ ...spec.blocks[0], type: "toString" }] },
        fixture,
        single,
        {},
      ),
    ).toBeNull();
    const changed = structuredClone(fixture);
    changed.rows[0].values[0].evidence[0].page = 999;
    expect(
      indexFacts(changed, single).some(
        (f) => f.concept === "annual-deductible",
      ),
    ).toBe(false);
    const foreign = indexFacts(fixture, {
      ...single,
      documentId: "c",
      planIds: ["plan-c"],
    })[0].id;
    expect(
      validatePresentation(
        { ...spec, blocks: [{ ...spec.blocks[0], factIds: [foreign] }] },
        fixture,
        single,
        {},
      ),
    ).toBeNull();
  });
  it("asks for genuinely missing context without restoring absent insurance rows", () => {
    const changed: Table = {
      ...fixture,
      rows: [
        ...fixture.rows,
        {
          factName: "premium",
          verdict: "NEEDS VERIFICATION",
          values: [],
          rationale: "Varies by age.",
        },
      ],
    };
    const spec = buildPresentation(changed, single, {});
    expect(
      spec.blocks.find((b) => b.type === "unresolved-questions")?.display
        .questions,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "age" })]),
    );
    expect(JSON.stringify(spec)).not.toContain("irrelevant-");
  });
  it("preserves controlled contextual warnings and missing-input questions from the accepted rules", () => {
    const changed: Table = { ...fixture, rows: [
      { factName: "international-coverage", verdict: "SUPPORTED", values: [{ documentId: "a", planId: "plan-a", display: "Country of residence excluded", qualifiers: {}, evidence: [{ documentId: "a", page: 1, quote: "This policy does not cover claims made in the insured person's country of residence.", evidenceId: "ev-residence" }] }] },
      { factName: "eligibility-for-you", verdict: "NOT STATED", values: [] },
    ] };
    const spec = buildPresentation(changed, single, { countryOrResidency: "United States", location: "Cleveland, 44118" });
    expect(JSON.stringify(spec)).toContain("potential-conflict");
    expect(JSON.stringify(spec)).toContain("does not determine eligibility");
    expect(spec.blocks.find((b) => b.type === "unresolved-questions")?.display.questions?.some((q) => q.field === "visaOrStatus")).toBe(true);
  });
});
