import { describe, expect, it } from "vitest";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { groupRows, SECTIONS } from "@/app/lib/extraction/sections";
import type { TableRow } from "@/app/lib/extraction/types";

const row = (factName: string): TableRow => ({ factName, verdict: "NOT STATED", values: [] });

describe("comparison table sections", () => {
  it("assigns every fact in the fact list to exactly one section", () => {
    const assigned = SECTIONS.flatMap((s) => s.factNames);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual(FACTS.map((f) => f.name).sort());
  });

  it("orders rows by section then by the section's own order", () => {
    const rows = [row("dental-coverage"), row("annual-deductible"), row("eligibility"), row("emergency-care")];
    const groups = groupRows(rows);
    expect(groups.map((g) => g.section.title)).toEqual(["Must know", "Coverage details", "Extras and fine print"]);
    expect(groups[0].rows.map((r) => r.factName)).toEqual(["annual-deductible", "eligibility"]);
    expect(groups[2].rows.map((r) => r.factName)).toEqual(["dental-coverage"]);
  });

  it("omits empty sections and keeps unknown facts in a trailing 'Other' group", () => {
    const groups = groupRows([row("future-fact"), row("network")]);
    expect(groups.map((g) => g.section.title)).toEqual(["Must know", "Other"]);
    expect(groups[1].rows[0].factName).toBe("future-fact");
  });
});
