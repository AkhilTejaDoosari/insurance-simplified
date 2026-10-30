import { describe, expect, it } from "vitest";
// V1.1 M2 task 7: controlled interpretation. Pure rules consume validated
// rows + exact user context and emit a documented fact, a potential conflict,
// or an unresolved question — each with a rule ID and evidence. Absence of
// evidence yields a question, never a determination.

import {
  deriveInterpretations,
  ELIGIBILITY_ROW_NAME,
  RULE_IDS,
} from "@/app/lib/extraction/eligibility";
import { buildOverview } from "@/app/lib/extraction/overview";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { RegisteredComparisonTable, TableRow } from "@/app/lib/extraction/types";

const v = (documentId: string, display: string, quote: string, page = 1): TableRow["values"][number] => ({
  documentId,
  display,
  qualifiers: {},
  evidence: [{ documentId, page, quote }],
});

const RESIDENCE_EXCLUSION_QUOTE =
  "This policy does not cover claims made in the insured person's country of residence.";

describe("controlled interpretation findings", () => {
  it("does not turn an unrelated dental exclusion into a residence coverage exclusion", () => {
    const quote = "Resident of the United States: eligible. Dental care is not covered.";
    const rows: TableRow[] = [{ factName: "geographic-restrictions", verdict: "SUPPORTED",
      values: [v("doc-1", quote, quote)] }];
    const findings = deriveInterpretations(rows, {
      countryOrResidency: "United States", location: "Boston, United States",
    });
    expect(findings.find((finding) => finding.ruleId === RULE_IDS.residenceCoverage)).toBeUndefined();
    expect(findings.find((finding) => finding.ruleId === RULE_IDS.residenceUnconfirmed)).toBeUndefined();
  });

  it("does not link eligibility and a dental exclusion in the same sentence", () => {
    const quote = "Resident of the United States: eligible, but dental care is not covered.";
    const rows: TableRow[] = [{ factName: "eligibility", verdict: "SUPPORTED",
      values: [v("doc-1", quote, quote)] }];
    expect(deriveInterpretations(rows, { countryOrResidency: "United States", location: "Boston, United States" })
      .filter((finding) => finding.ruleId === RULE_IDS.residenceCoverage)).toEqual([]);
  });

  it("recognizes a country-of-residence exclusion with the location before the exclusion verb", () => {
    const quote = "Coverage in the insured person's country of residence is excluded.";
    const rows: TableRow[] = [{ factName: "international-coverage", verdict: "SUPPORTED",
      values: [v("doc-1", quote, quote, 2)] }];
    const finding = deriveInterpretations(rows, { countryOrResidency: "United States", location: "Boston, United States" })
      .find((item) => item.ruleId === RULE_IDS.residenceCoverage);
    expect(finding?.kind).toBe("potential-conflict");
    expect(finding?.evidence[0].page).toBe(2);
  });
  it("flags a residence exclusion as a potential conflict with source, context and rule", () => {
    const rows: TableRow[] = [
      {
        factName: "international-coverage",
        verdict: "SUPPORTED",
        values: [v("doc-1", RESIDENCE_EXCLUSION_QUOTE, RESIDENCE_EXCLUSION_QUOTE, 3)],
      },
    ];
    const conflict = deriveInterpretations(rows, {
      countryOrResidency: "United States",
      location: "Cleveland, Ohio, United States",
    }).find((i) => i.ruleId === RULE_IDS.residenceCoverage);

    expect(conflict).toBeDefined();
    expect(conflict!.kind).toBe("potential-conflict");
    expect(conflict!.evidence[0]).toMatchObject({ documentId: "doc-1", page: 3 });
    expect(conflict!.context).toEqual([
      { field: "countryOrResidency", value: "United States" },
      { field: "location", value: "Cleveland, Ohio, United States" },
    ]);
    expect(conflict!.question).toBeTruthy();
    // A potential conflict is never a definitive rejection (spec I / R.3).
    expect(conflict!.statement.toLowerCase()).not.toMatch(
      /ineligible|you are not eligible|rejected|denied/,
    );
  });

  it("does not treat a US resident's stated Canadian destination as a residence mismatch", () => {
    const rows: TableRow[] = [{ factName: "international-coverage", verdict: "SUPPORTED",
      values: [v("doc-1", RESIDENCE_EXCLUSION_QUOTE, RESIDENCE_EXCLUSION_QUOTE, 3)] }];
    const findings = deriveInterpretations(rows, { countryOrResidency: "United States", location: "Toronto, Canada" });
    expect(findings.find((i) => i.kind === "potential-conflict")).toBeUndefined();
    const restriction = findings.find((i) => i.ruleId === RULE_IDS.residenceCoverage)!;
    expect(restriction.kind).toBe("documented-fact");
    expect(restriction.context).toEqual([
      { field: "countryOrResidency", value: "United States" },
      { field: "location", value: "Toronto, Canada" },
    ]);
    expect(restriction.evidence[0].page).toBe(3);
    expect(restriction.statement).not.toMatch(/guaranteed|you are eligible/i);
  });

  it("asks for destination when it is missing or its country cannot be established", () => {
    const rows: TableRow[] = [{ factName: "international-coverage", verdict: "SUPPORTED",
      values: [v("doc-1", RESIDENCE_EXCLUSION_QUOTE, RESIDENCE_EXCLUSION_QUOTE)] }];
    for (const location of ["", "Toronto"]) {
      const finding = deriveInterpretations(rows, { countryOrResidency: "United States", location })
        .find((i) => i.ruleId === RULE_IDS.residenceUnconfirmed)!;
      expect(finding.kind).toBe("unresolved-question");
      expect(finding.context).toEqual(location ? [
        { field: "countryOrResidency", value: "United States" },
        { field: "location", value: location },
      ] : [{ field: "countryOrResidency", value: "United States" }]);
      expect(finding.question).toMatch(/country.*coverage location/i);
    }
  });

  it("asks for a quote when the premium is not stated in the uploaded evidence", () => {
    const rows: TableRow[] = [
      { factName: "premium", verdict: "NOT STATED", values: [] },
    ];
    const missing = deriveInterpretations(rows, {}).find(
      (i) => i.ruleId === RULE_IDS.premiumMissing,
    );

    expect(missing).toBeDefined();
    expect(missing!.kind).toBe("unresolved-question");
    expect(missing!.statement).toMatch(/not stated in the uploaded evidence/i);
    expect(missing!.question).toMatch(/quote/i);
    // Absence carries no fabricated citation.
    expect(missing!.evidence).toEqual([]);
  });

  it("keeps unsupported eligibility unconfirmed instead of deciding it", () => {
    const rows: TableRow[] = [
      { factName: ELIGIBILITY_ROW_NAME, verdict: "NOT STATED", values: [] },
    ];
    const open = deriveInterpretations(rows, { age: "25" }).find(
      (i) => i.ruleId === RULE_IDS.eligibilityUnconfirmed,
    );

    expect(open).toBeDefined();
    expect(open!.kind).toBe("unresolved-question");
    expect(open!.statement.toLowerCase()).not.toMatch(
      /you are eligible|ineligible|guarantee/,
    );
    expect(open!.question).toBeTruthy();
  });

  it("returns unknown — never ineligible — when the country is not supplied", () => {
    const rows: TableRow[] = [
      {
        factName: "international-coverage",
        verdict: "SUPPORTED",
        values: [v("doc-1", RESIDENCE_EXCLUSION_QUOTE, RESIDENCE_EXCLUSION_QUOTE)],
      },
      { factName: "premium", verdict: "NOT STATED", values: [] },
      { factName: ELIGIBILITY_ROW_NAME, verdict: "NOT STATED", values: [] },
    ];
    const out = deriveInterpretations(rows, {});

    expect(out.every((i) => i.kind === "unresolved-question")).toBe(true);
    expect(out.map((i) => i.ruleId)).toEqual(
      expect.arrayContaining([
        RULE_IDS.residenceUnconfirmed,
        RULE_IDS.premiumMissing,
        RULE_IDS.eligibilityUnconfirmed,
      ]),
    );
    expect(JSON.stringify(out).toLowerCase()).not.toMatch(/ineligible|denied/);
  });

  it("emits nothing about residence when the document states no restriction", () => {
    const rows: TableRow[] = [
      {
        factName: "hospitalization",
        verdict: "SUPPORTED",
        values: [v("doc-1", "Hospitalization is covered.", "Hospitalization is covered.")],
      },
    ];
    expect(
      deriveInterpretations(rows, { countryOrResidency: "United States" }).find(
        (i) => i.ruleId === RULE_IDS.residenceCoverage,
      ),
    ).toBeUndefined();
  });

  it("does not combine a positive residence fact with an unrelated exclusion", () => {
    const rows: TableRow[] = [{
      factName: "geographic-restrictions",
      verdict: "SUPPORTED",
      values: [
        v("doc-1", "Coverage in the country of residence is available.", "Coverage in the country of residence is available.", 2),
        v("doc-1", "Outside the service area is not covered.", "Outside the service area is not covered.", 3),
      ],
    }];
    expect(deriveInterpretations(rows, { countryOrResidency: "United States" })
      .find((finding) => finding.ruleId === RULE_IDS.residenceCoverage)).toBeUndefined();
  });
});

describe("D3/D5 location country inference regressions", () => {
  const genuine = RESIDENCE_EXCLUSION_QUOTE;
  function residenceFinding(userContext: { countryOrResidency: string; location: string }) {
    return deriveInterpretations(
      [{ factName: "international-coverage", verdict: "SUPPORTED", values: [v("doc-1", genuine, genuine, 3)] }],
      userContext,
    ).find((i) => i.ruleId === RULE_IDS.residenceCoverage);
  }
  function unconfirmedFinding(userContext: { countryOrResidency: string; location: string }) {
    return deriveInterpretations(
      [{ factName: "international-coverage", verdict: "SUPPORTED", values: [v("doc-1", genuine, genuine, 3)] }],
      userContext,
    ).find((i) => i.ruleId === RULE_IDS.residenceUnconfirmed);
  }

  it("recognizes an explicit foreign country", () => {
    const finding = residenceFinding({ countryOrResidency: "United States", location: "Paris, France" });
    expect(finding?.kind).toBe("documented-fact");
  });

  it("recognizes an explicit same country as a potential conflict", () => {
    const finding = residenceFinding({ countryOrResidency: "United States", location: "Cleveland, United States" });
    expect(finding?.kind).toBe("potential-conflict");
  });

  it("normalizes country aliases", () => {
    const finding = residenceFinding({ countryOrResidency: "USA", location: "Cleveland, United States of America" });
    expect(finding?.kind).toBe("potential-conflict");
  });

  it("treats a recognized US state as domestic", () => {
    expect(residenceFinding({ countryOrResidency: "United States", location: "Cleveland, Ohio" })?.kind).toBe("potential-conflict");
  });

  it("treats a US ZIP code as domestic", () => {
    expect(residenceFinding({ countryOrResidency: "United States", location: "Cleveland, 44118" })?.kind).toBe("potential-conflict");
  });

  it("does not assume domestic for an ambiguous province suffix", () => {
    expect(residenceFinding({ countryOrResidency: "United States", location: "Toronto, ON" })).toBeUndefined();
    expect(unconfirmedFinding({ countryOrResidency: "United States", location: "Toronto, ON" })?.kind).toBe("unresolved-question");
  });

  it("does not assume domestic for an ambiguous postal-code suffix", () => {
    expect(residenceFinding({ countryOrResidency: "United States", location: "London, SW1A 1AA" })).toBeUndefined();
    expect(unconfirmedFinding({ countryOrResidency: "United States", location: "London, SW1A 1AA" })?.kind).toBe("unresolved-question");
  });

  it("does not assume domestic or foreign for a bare city", () => {
    expect(residenceFinding({ countryOrResidency: "United States", location: "Toronto" })).toBeUndefined();
    expect(unconfirmedFinding({ countryOrResidency: "United States", location: "Toronto" })?.kind).toBe("unresolved-question");
  });
});

describe("D4 residence exclusion wording regressions", () => {
  function residenceFinding(quote: string, location = "Cleveland, United States") {
    return deriveInterpretations(
      [{ factName: "international-coverage", verdict: "SUPPORTED", values: [v("doc-1", quote, quote, 3)] }],
      { countryOrResidency: "United States", location },
    ).find((i) => i.ruleId === RULE_IDS.residenceCoverage);
  }

  it("recognizes plural 'Benefits are not payable for claims incurred in the country of residence'", () => {
    const finding = residenceFinding("Benefits are not payable for claims incurred in the country of residence.");
    expect(finding?.kind).toBe("potential-conflict");
  });

  it("still ignores an unrelated dental exclusion", () => {
    expect(residenceFinding("Dental care is not covered.")).toBeUndefined();
  });
});

function registeredTable(rows: TableRow[], plans?: RegisteredComparisonTable["plans"]): RegisteredComparisonTable {
  const documents = [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 3 }];
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents,
    plans,
    rows: rows.map((row) => ({
      ...row,
      values: row.values.map((value) => ({
        ...value,
        evidence: value.evidence.map((e) => ({
          ...e,
          evidenceId: evidenceIdFor(e.documentId, e.page, e.quote),
        })),
      })),
    })),
  } as RegisteredComparisonTable;
}

describe("M3 overview builder", () => {
  it("surfaces verified key facts and documented upsides when nothing is blocked", () => {
    const table = registeredTable([
      { factName: "annual-deductible", verdict: "SUPPORTED", values: [v("doc-1", "$250", "Annual deductible is $250.", 2)] },
      { factName: "premium", verdict: "NOT STATED", values: [] },
      { factName: "emergency-evacuation", verdict: "SUPPORTED", values: [v("doc-1", "Up to $1,000,000", "Emergency medical evacuation up to $1,000,000.", 2)] },
    ]);
    const overview = buildOverview(table, { countryOrResidency: "United States", location: "Cleveland, Ohio" });
    expect(overview.status).toBe("unknown");
    expect(overview.headline).toMatch(/some important details are missing/);
    expect(overview.items.some((i) => i.label === "Annual deductible" && i.value === "$250")).toBe(true);
    expect(overview.items.some((i) => i.label === "Premium / price" && i.value?.includes("Not stated"))).toBe(true);
    expect(overview.items.some((i) => i.kind === "upside" && i.label === "Emergency medical evacuation")).toBe(true);
  });

  it("flags a residence conflict as review required", () => {
    const table = registeredTable([
      { factName: "international-coverage", verdict: "SUPPORTED", values: [v("doc-1", "No home-country coverage.", "This policy does not cover claims made in the insured person's country of residence.", 2)] },
    ]);
    const overview = buildOverview(table, { countryOrResidency: "United States", location: "Cleveland, Ohio" });
    expect(overview.status).toBe("review");
    expect(overview.headline).toMatch(/possible coverage applicability conflict/);
    expect(overview.items.some((i) => i.kind === "conflict" && i.section === "My Fit")).toBe(true);
  });

  it("filters key facts by selected tier", () => {
    const table = registeredTable([
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          { ...v("doc-1", "$250", "Lite deductible $250.", 2), qualifiers: { planTier: "Lite" } },
          { ...v("doc-1", "$500", "Platinum deductible $500.", 2), qualifiers: { planTier: "Platinum" } },
        ],
      },
    ]);
    const overview = buildOverview(table, {}, [{ planId: undefined, tier: "Lite" }]);
    const deductible = overview.items.filter((i) => i.label === "Annual deductible");
    expect(deductible).toHaveLength(1);
    expect(deductible[0].value).toBe("$250");
  });

  it("shows deductible options as options, not a purchased choice", () => {
    const table = registeredTable([
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            ...v("doc-1", "$0 / $500 / $1,000 / $2,500", "Deductible options: $0, $500, $1,000, $2,500.", 2),
            qualifiers: { selectionStatus: "selectable" },
          },
        ],
      },
    ]);
    const overview = buildOverview(table, {});
    const item = overview.items.find((i) => i.label === "Annual deductible");
    expect(item).toBeDefined();
    expect(item!.value).toMatch(/options; actual selection unknown/);
    expect(item!.notes).not?.toContain("Purchased option stated by the source.");
  });

  it("surfaces a missing premium row as a cost unknown", () => {
    const table = registeredTable([
      { factName: "annual-deductible", verdict: "SUPPORTED", values: [v("doc-1", "$250", "Deductible $250.", 2)] },
    ]);
    const overview = buildOverview(table, {});
    const premium = overview.items.filter((i) => i.label === "Premium / price");
    expect(premium).toHaveLength(1);
    expect(premium[0].value).toMatch(/Not stated/);
  });

  it("associates network scope with coinsurance percentages", () => {
    const table = registeredTable([
      {
        factName: "coinsurance",
        verdict: "SUPPORTED",
        values: [
          {
            ...v("doc-1", "20%", "You pay 20% in-network.", 2),
            qualifiers: { networkTier: "in-network" },
          },
        ],
      },
    ]);
    const overview = buildOverview(table, {});
    const item = overview.items.find((i) => i.label === "Coinsurance / your share");
    expect(item).toBeDefined();
    expect(item!.notes).toContain("Network: in-network");
  });

  it("flags an unparseable multi-figure value as unresolved", () => {
    const table = registeredTable([
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [v("doc-1", "$0 / $500 / $0", "Deductible amounts are listed.", 2)],
      },
    ]);
    const overview = buildOverview(table, {});
    const item = overview.items.find((i) => i.label === "Annual deductible");
    expect(item).toBeDefined();
    expect(item!.notes?.some((n) => /Unresolved.*which amount applies/i.test(n))).toBe(true);
  });

  it("highlights a matching age band for age-sensitive premiums", () => {
    const table = registeredTable([
      {
        factName: "premium",
        verdict: "SUPPORTED",
        values: [
          {
            ...v("doc-1", "$125", "Monthly premium for ages 25-29 is $125.", 2),
            qualifiers: { ageBand: "25-29" },
          },
        ],
      },
    ]);
    const overview = buildOverview(table, { age: "27" });
    const item = overview.items.find((i) => i.label === "Premium / price");
    expect(item).toBeDefined();
    expect(item!.notes?.some((n) => /matches your age 27/i.test(n))).toBe(true);
  });
});

describe("C1 stable unique React keys", () => {
  it("gives duplicate-looking values distinct ids from buildOverview", () => {
    const table = registeredTable([
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          { ...v("doc-1", "$250", "Deductible is $250.", 2) },
          { ...v("doc-1", "$250", "Deductible restated $250.", 3) },
        ],
      },
    ]);
    const overview = buildOverview(table, {});
    const ids = overview.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps interpretation ids distinct when evidence differs", () => {
    const table = registeredTable([
      {
        factName: "international-coverage",
        verdict: "SUPPORTED",
        values: [
          v("doc-1", "No home-country coverage.", "This policy does not cover claims made in the insured person's country of residence.", 2),
          v("doc-1", "No home-country coverage.", "Country of residence exclusion also on page 4.", 4),
        ],
      },
    ]);
    const overview = buildOverview(table, { countryOrResidency: "United States", location: "Cleveland, Ohio" });
    const ids = overview.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("C4 consolidate repeated unknowns", () => {
  it("groups identical not-stated messages and keeps per-fact details", () => {
    const table = registeredTable([
      { factName: "premium", verdict: "NOT STATED", values: [] },
      { factName: "annual-deductible", verdict: "NOT STATED", values: [] },
      { factName: "out-of-pocket-maximum", verdict: "NOT STATED", values: [] },
    ]);
    const overview = buildOverview(table, {});
    const groups = overview.items.filter((i) => i.kind === "unknown-group");
    expect(groups).toHaveLength(1);
    expect(groups[0].details).toHaveLength(3);
    expect(groups[0].details!.some((d) => d.label === "Premium / price")).toBe(true);
    expect(groups[0].details!.some((d) => d.label === "Annual deductible")).toBe(true);
    expect(groups[0].details!.some((d) => d.label === "Out-of-pocket maximum")).toBe(true);
    // Duplicate individual not-stated rows must not remain in the top-level list.
    const remaining = overview.items.filter(
      (i) => i.kind !== "unknown-group" && i.value?.includes("Not stated"),
    );
    expect(remaining).toHaveLength(0);
  });
});

describe("C5 three-insight cap", () => {
  it("shows at most three initial findings in priority order", () => {
    const table = registeredTable([
      {
        factName: "international-coverage",
        verdict: "SUPPORTED",
        values: [
          v("doc-1", "No home-country coverage.", "This policy does not cover claims made in the insured person's country of residence.", 2),
        ],
      },
      { factName: "annual-deductible", verdict: "SUPPORTED", values: [v("doc-1", "$250", "Annual deductible is $250.", 2)] },
      { factName: "out-of-pocket-maximum", verdict: "SUPPORTED", values: [v("doc-1", "$3,000", "Out-of-pocket maximum is $3,000.", 2)] },
      { factName: "emergency-evacuation", verdict: "SUPPORTED", values: [v("doc-1", "Up to $1,000,000", "Emergency evacuation up to $1,000,000.", 2)] },
    ]);
    const overview = buildOverview(table, { countryOrResidency: "United States", location: "Cleveland, Ohio" });

    expect(overview.initialItems.length).toBeLessThanOrEqual(3);
    expect(overview.initialItems.length).toBeGreaterThan(0);
    const initialKinds = overview.initialItems.map((i) => i.kind);
    expect(initialKinds[0]).toBe("conflict");
    expect(initialKinds[1]).toBe("cost");
    // With two material costs, the cap should fill with a second cost before an upside.
    expect(initialKinds[2]).toBe("cost");

    const initialIds = new Set(overview.initialItems.map((i) => i.id));
    expect(initialIds.size).toBe(overview.initialItems.length);

    // The remainder holds the lower-priority items with full evidence.
    expect(overview.remainder.some((i) => i.kind === "upside")).toBe(true);
  });

  it("falls back to lower-priority items only when higher-priority findings are absent", () => {
    const table = registeredTable([
      { factName: "premium", verdict: "NOT STATED", values: [] },
      { factName: "annual-deductible", verdict: "NOT STATED", values: [] },
    ]);
    const overview = buildOverview(table, {});
    expect(overview.initialItems.length).toBeLessThanOrEqual(3);
    expect(overview.initialItems.length).toBeGreaterThan(0);
  });
});
