import { describe, expect, it } from "vitest";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { groupRows, SECTIONS } from "@/app/lib/extraction/sections";
import type { TableRow } from "@/app/lib/extraction/types";

const row = (factName: string): TableRow => ({ factName, verdict: "NOT STATED", values: [] });

describe("comparison table sections", () => {
  it("uses the four approved V1 section names with Essentials first", () => {
    expect(SECTIONS.map((s) => s.title)).toEqual([
      "Essentials",
      "Care & Coverage",
      "Rules & Restrictions",
      "Plan Highlights",
    ]);
  });

  it("places premium/price in Essentials (A-015)", () => {
    expect(SECTIONS[0].factNames).toContain("premium");
  });

  it("covers every fact in at least one section; the first three are exclusive", () => {
    const [essentials, care, rules] = SECTIONS;
    const core = [...essentials.factNames, ...care.factNames, ...rules.factNames];
    expect(new Set(core).size).toBe(core.length);
    const covered = new Set(SECTIONS.flatMap((s) => s.factNames));
    for (const f of FACTS.map((f) => f.name)) {
      expect(covered.has(f)).toBe(true);
    }
  });

  it("re-surfaces highlight facts without consuming them", () => {
    const groups = groupRows([row("dental-coverage")]);
    expect(groups.map((g) => g.section.title)).toEqual(["Care & Coverage", "Plan Highlights"]);
  });

  it("orders rows by section then by the section's own order", () => {
    const rows = [row("annual-deductible"), row("eligibility"), row("emergency-care")];
    const groups = groupRows(rows);
    expect(groups.map((g) => g.section.title)).toEqual(["Essentials", "Care & Coverage"]);
    expect(groups[0].rows.map((r) => r.factName)).toEqual(["annual-deductible", "eligibility"]);
    expect(groups[1].rows.map((r) => r.factName)).toEqual(["emergency-care"]);
  });

  it("omits empty sections and keeps unknown facts in a trailing 'Other' group", () => {
    const groups = groupRows([row("future-fact"), row("network")]);
    expect(groups.map((g) => g.section.title)).toEqual(["Essentials", "Other"]);
    expect(groups[1].rows[0].factName).toBe("future-fact");
  });
});
