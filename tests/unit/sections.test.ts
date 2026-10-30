import { describe, expect, it } from "vitest";
import { FACTS } from "@/app/lib/extraction/fact-list";
import {
  ELIGIBILITY_ROW_NAME,
  NON_DISPLAY_FEEDERS,
} from "@/app/lib/extraction/eligibility";
import { groupRows, SECTIONS, sectionForFactName } from "@/app/lib/extraction/sections";
import type { TableRow } from "@/app/lib/extraction/types";

const row = (factName: string): TableRow => ({ factName, verdict: "NOT STATED", values: [] });

const EXPECTED_SECTIONS = [
  "My Fit",
  "My Costs",
  "Coverage",
  "Limits & Risks",
  "Evidence & Actions",
];

describe("comparison table sections", () => {
  it("uses the five approved V1.1 section names in order", () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(EXPECTED_SECTIONS);
  });

  it("maps the personalized eligibility composite to My Fit", () => {
    const fitFacts = new Set(SECTIONS[0].factNames);
    expect(fitFacts.has(ELIGIBILITY_ROW_NAME)).toBe(true);
  });

  it("maps monetary cost and high-impact condition facts to My Costs", () => {
    const costFacts = new Set(SECTIONS[1].factNames);
    expect(costFacts.has("annual-deductible")).toBe(true);
    expect(costFacts.has("out-of-pocket-maximum")).toBe(true);
    expect(costFacts.has("premium")).toBe(true);
    expect(costFacts.has("coinsurance")).toBe(true);
    expect(costFacts.has("network")).toBe(true);
    expect(costFacts.has("policy-limit")).toBe(true);
    expect(costFacts.has("pre-existing-conditions")).toBe(true);
  });

  it("maps service and benefit facts to Coverage", () => {
    const coverageFacts = new Set(SECTIONS[2].factNames);
    expect(coverageFacts.has("hospitalization")).toBe(true);
    expect(coverageFacts.has("emergency-care")).toBe(true);
    expect(coverageFacts.has("dental-coverage")).toBe(true);
    expect(coverageFacts.has("emergency-evacuation")).toBe(true);
  });

  it("maps exclusions, limits, waiting, geography and authorization facts to Limits & Risks", () => {
    const riskFacts = new Set(SECTIONS[3].factNames);
    expect(riskFacts.has("material-exclusions")).toBe(true);
    expect(riskFacts.has("waiting-period")).toBe(true);
    expect(riskFacts.has("preauthorization")).toBe(true);
    expect(riskFacts.has("geographic-restrictions")).toBe(true);
    expect(riskFacts.has("age-limits")).toBe(true);
  });

  it("keeps Evidence & Actions as the destination for unclassified facts", () => {
    expect(SECTIONS[4].title).toBe("Evidence & Actions");
  });

  it("gives every display fact exactly one canonical section with no duplicates", () => {
    const assigned = SECTIONS.flatMap((s) => s.factNames);
    expect(new Set(assigned).size).toBe(assigned.length);
    const displayFacts = FACTS.map((f) => f.name).filter(
      (n) => !(NON_DISPLAY_FEEDERS as readonly string[]).includes(n),
    );
    expect([...assigned].sort()).toEqual([...displayFacts, ELIGIBILITY_ROW_NAME].sort());
  });

  it("hides non-display eligibility feeders from grouping", () => {
    const rows = [...NON_DISPLAY_FEEDERS.map(row), row("annual-deductible")];
    const groups = groupRows(rows);
    const seen = groups.flatMap((g) => g.rows.map((r) => r.factName));
    expect(seen).toEqual(["annual-deductible"]);
  });

  it("never duplicates a row across groups", () => {
    const rows = FACTS.map((f) => row(f.name));
    const groups = groupRows(rows);
    const seen = groups.flatMap((g) => g.rows.map((r) => r.factName));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("orders rows by section then by the section's own order", () => {
    const rows = [row("annual-deductible"), row(ELIGIBILITY_ROW_NAME), row("emergency-care")];
    const groups = groupRows(rows);
    expect(groups.map((g) => g.section.title)).toEqual(["My Fit", "My Costs", "Coverage"]);
    expect(groups[0].rows.map((r) => r.factName)).toEqual([ELIGIBILITY_ROW_NAME]);
    expect(groups[1].rows.map((r) => r.factName)).toEqual(["annual-deductible"]);
    expect(groups[2].rows.map((r) => r.factName)).toEqual(["emergency-care"]);
  });

  it("places unknown facts in Evidence & Actions rather than discarding them", () => {
    const groups = groupRows([row("future-fact"), row("network")]);
    expect(groups.map((g) => g.section.title)).toContain("Evidence & Actions");
    const actionGroup = groups.find((g) => g.section.title === "Evidence & Actions");
    expect(actionGroup?.rows[0].factName).toBe("future-fact");
  });

  it("exposes a section lookup for every assigned fact", () => {
    expect(sectionForFactName(ELIGIBILITY_ROW_NAME)).toBe("My Fit");
    expect(sectionForFactName("annual-deductible")).toBe("My Costs");
    expect(sectionForFactName("hospitalization")).toBe("Coverage");
    expect(sectionForFactName("material-exclusions")).toBe("Limits & Risks");
    expect(sectionForFactName("referral-requirement")).toBe("Limits & Risks");
    expect(sectionForFactName("unknown-fact")).toBe("Evidence & Actions");
  });
});
