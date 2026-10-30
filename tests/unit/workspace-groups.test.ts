import { describe, expect, it } from "vitest";
import { buildWorkspaceGroups } from "@/app/lib/extraction/workspace-groups";
import { sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import type { RegisteredComparisonTable, TableRow } from "@/app/lib/extraction/types";

const row = (factName: string): TableRow => ({ factName, verdict: "NOT STATED", values: [] });

const value = (documentId: string, quote: string) => ({
  documentId,
  display: quote,
  qualifiers: {},
  evidence: [{ documentId, page: 1, quote, evidenceId: `ev-${documentId}` }],
});

const rows = [
  { factName: "annual-deductible", verdict: "SUPPORTED", values: [value("doc-1", "$250 deductible")] },
  { factName: "emergency-evacuation", verdict: "SUPPORTED", values: [value("doc-2", "Evacuation benefit")] },
  { factName: "premium", verdict: "NOT STATED", values: [] },
  { factName: "future-fact", verdict: "SUPPORTED", values: [value("doc-1", "Future")] },
] satisfies RegisteredComparisonTable["rows"];

describe("workspace groups", () => {
  it("produces at most five top-level sections", () => {
    const groups = buildWorkspaceGroups(rows, undefined);
    expect(groups.length).toBeLessThanOrEqual(5);
    const titles = groups.map((g) => g.section.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("places presentation groups as nested subgroups inside the assigned top-level section", () => {
    const presentationGroups = sanitizeGroups({
      groups: [
        { title: "Cost choices", factNames: ["annual-deductible"] },
        { title: "Travel safeguards", factNames: ["emergency-evacuation"] },
      ],
    }, rows);
    const groups = buildWorkspaceGroups(rows, presentationGroups);
    const costs = groups.find((g) => g.section.title === "My Costs");
    expect(costs).toBeDefined();
    expect(costs!.subgroups.map((s) => s.title)).toContain("Cost choices");
    expect(costs!.subgroups.flatMap((s) => s.rows.map((r) => r.factName))).toContain("annual-deductible");

    const coverage = groups.find((g) => g.section.title === "Coverage");
    expect(coverage).toBeDefined();
    expect(coverage!.subgroups.map((s) => s.title)).toContain("Travel safeguards");
  });

  it("keeps ungrouped rows in a default subgroup within their section", () => {
    const groups = buildWorkspaceGroups(rows, undefined);
    const costs = groups.find((g) => g.section.title === "My Costs");
    expect(costs?.subgroups.some((s) => s.rows.some((r) => r.factName === "premium"))).toBe(true);
  });

  it("sends unknown fact keys to Evidence & Actions as unclassified facts", () => {
    const groups = buildWorkspaceGroups(rows, undefined);
    const actions = groups.find((g) => g.section.title === "Evidence & Actions");
    expect(actions).toBeDefined();
    expect(actions!.subgroups.flatMap((s) => s.rows.map((r) => r.factName))).toContain("future-fact");
  });

  it("never drops a row or duplicates it across sections", () => {
    const groups = buildWorkspaceGroups(rows, undefined);
    const seen = groups.flatMap((g) => g.subgroups.flatMap((s) => s.rows.map((r) => r.factName)));
    expect(seen.length).toBe(new Set(seen).size);
    expect(seen.sort()).toEqual(rows.map((r) => r.factName).sort());
  });

  it("omits sections that are empty", () => {
    const groups = buildWorkspaceGroups([row("annual-deductible")], undefined);
    expect(groups.map((g) => g.section.title)).toEqual(["My Costs"]);
  });

  it("omits subgroups that have no rows after filtering", () => {
    const presentationGroups = sanitizeGroups({
      groups: [
        { title: "Cost choices", factNames: ["annual-deductible"] },
        { title: "Empty group", factNames: ["invented-benefit"] },
      ],
    }, rows);
    const groups = buildWorkspaceGroups(rows, presentationGroups);
    const costs = groups.find((g) => g.section.title === "My Costs")!;
    expect(costs.subgroups.map((s) => s.title)).toContain("Cost choices");
    expect(costs.subgroups.map((s) => s.title)).not.toContain("Empty group");
  });
});
