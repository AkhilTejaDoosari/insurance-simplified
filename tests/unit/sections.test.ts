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

  it("gives every fact exactly one canonical section with no duplicates", () => {
    const assigned = SECTIONS.flatMap((s) => s.factNames);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual(FACTS.map((f) => f.name).sort());
  });

  it("never duplicates a row across groups", () => {
    const rows = FACTS.map((f) => row(f.name));
    const groups = groupRows(rows);
    const seen = groups.flatMap((g) => g.rows.map((r) => r.factName));
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(FACTS.map((f) => f.name).sort());
  });

  it("keeps Plan Highlights for genuinely unique facts only", () => {
    const highlights = SECTIONS.find((s) => s.title === "Plan Highlights")!;
    const others = new Set(
      SECTIONS.filter((s) => s.title !== "Plan Highlights").flatMap((s) => s.factNames),
    );
    for (const n of highlights.factNames) {
      expect(others.has(n)).toBe(false);
    }
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
