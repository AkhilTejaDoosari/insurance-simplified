import { describe, expect, it } from "vitest";
import { FACTS } from "@/app/lib/extraction/fact-list";
import {
  ELIGIBILITY_ROW_NAME,
  NON_DISPLAY_FEEDERS,
} from "@/app/lib/extraction/eligibility";
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

  it("renders Essentials in the locked 8-row order", () => {
    expect(SECTIONS[0].factNames).toEqual([
      ELIGIBILITY_ROW_NAME,
      "annual-deductible",
      "out-of-pocket-maximum",
      "network",
      "coinsurance",
      "policy-limit",
      "premium",
      "pre-existing-conditions",
    ]);
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
    const rows = [row("annual-deductible"), row(ELIGIBILITY_ROW_NAME), row("emergency-care")];
    const groups = groupRows(rows);
    expect(groups.map((g) => g.section.title)).toEqual(["Essentials", "Care & Coverage"]);
    expect(groups[0].rows.map((r) => r.factName)).toEqual([ELIGIBILITY_ROW_NAME, "annual-deductible"]);
    expect(groups[1].rows.map((r) => r.factName)).toEqual(["emergency-care"]);
  });

  it("omits empty sections and keeps unknown facts in a trailing 'Other' group", () => {
    const groups = groupRows([row("future-fact"), row("network")]);
    expect(groups.map((g) => g.section.title)).toEqual(["Essentials", "Other"]);
    expect(groups[1].rows[0].factName).toBe("future-fact");
  });
});
