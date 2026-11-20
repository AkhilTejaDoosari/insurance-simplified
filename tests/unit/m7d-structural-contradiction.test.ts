// M4 review finding #3 (assigned to M7): Stage E path A must check structural
// claims (table cells / grammar statements) for same-scope contradictions
// AMONG THEMSELVES. Same plan + same scope + same fact (same row label) with
// different values is a same-scope contradiction (evidence-core.md §3
// CONFLICTED); different labels or different tiers are distinct provisions.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import { resolveRowPlanIds } from "@/app/lib/extraction/plan-identity";
import { validateTable, type CellValue, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { indexFacts } from "@/app/lib/presentation/adaptive";
import { tableDocument, type TablePageSpec } from "./helpers/table-doc";

const base = { preamble: ["Policy name: Alpha"], caption: "BENEFIT", headings: ["ELITE", "BASIC"] };
const page = (rows: TablePageSpec["rows"], preamble = base.preamble): TablePageSpec => ({ ...base, preamble, rows });

function setup(lines: string[] = []) {
  const doc = tableDocument("d1", [
    page([["Deductible", "$0", "$250"], ["Local Ambulance", "Up to $750", "Up to $500"], ["Copay", "$10", "$20"]]),
    page([["Deductible", "$100", "$250"], ["Lab", "$1", "$2"], ["Copay", "$10", "$20"]], ["Schedule continued"]),
    ...lines,
  ]);
  const docs = [doc];
  const table = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
  return { docs, table, planId: table.plans![0].planId };
}

const deductibles = (t: ComparisonTable) => t.rows.find((r) => r.factName === "annual-deductible")!.values;
const unscoped = (v: CellValue): CellValue => { const { planId: _p, ...rest } = v; return rest as CellValue; };

function presentationStates(table: ComparisonTable, planId: string, tier: string) {
  let n = 0;
  const withIds = {
    ...table,
    documents: [{ documentId: "d1", filename: "d1.pdf", pageCount: 3 }],
    rows: table.rows.map((r) => ({ ...r, values: r.values.map((v) => ({ ...v, evidence: v.evidence.map((e) => ({ ...e, evidenceId: `ev-${n++}` })) })) })),
  };
  return indexFacts(withIds as never, { mode: "understand", documentId: "d1", planIds: [planId], tiers: { [planId]: tier } })
    .filter((f) => f.concept === "annual-deductible")
    .map((f) => [f.value.display, f.state]);
}

describe("Stage E path A: same-scope contradictions among structural claims", () => {
  it("two cells of one plan, tier and row label with different values are attributed together and shown as a conflict", () => {
    const { table, planId } = setup();
    const elite = deductibles(table).filter((v) => v.anchor && v.qualifiers.planTier === "ELITE");
    expect(elite.map((v) => v.display)).toEqual(["Deductible (ELITE): $0", "Deductible (ELITE): $100"]);
    expect(elite.every((v) => v.planId === planId)).toBe(true);
    expect(hasSameScopeContradiction(elite)).toBe(true);
    expect(presentationStates(table, planId, "ELITE")).toEqual([
      ["Deductible (ELITE): $0", "conflicting-evidence"],
      ["Deductible (ELITE): $100", "conflicting-evidence"],
    ]);
  });

  it("an unstructured reading cannot pick a winner between contradicting structural claims", () => {
    const { docs, table, planId } = setup();
    const cells = deductibles(table).filter((v) => v.anchor).map(unscoped);
    // A prose line that agrees with one cell and contradicts the other.
    const line: CellValue = {
      documentId: "d1",
      display: "Deductible (ELITE): $100",
      qualifiers: { planTier: "ELITE" },
      evidence: [{ documentId: "d1", page: 2, quote: "Deductible $100" }, { documentId: "d1", page: 2, quote: "BENEFIT ELITE BASIC" }],
    };
    const ids = resolveRowPlanIds("annual-deductible", [...cells, line], table.plans!, docs);
    const byDisplay = new Map(cells.map((c, i) => [`${c.display}#${i}`, ids[i]]));
    // Before the fix: the $0 cell abstained (line contradiction) and the $100
    // cell stayed the plan's only ELITE deductible — a silent pick.
    expect([...byDisplay.entries()].filter(([k]) => k.startsWith("Deductible (ELITE)")).map(([, id]) => id))
      .toEqual([planId, planId]);
    expect(ids[cells.length]).toBeUndefined();
    const attributedElite = cells.filter((c, i) => ids[i] === planId && c.qualifiers.planTier === "ELITE")
      .map((c) => ({ ...c, planId }));
    expect(hasSameScopeContradiction(attributedElite)).toBe(true);
  });

  it("does not over-trigger: distinct row labels in one tier are distinct provisions", () => {
    const doc = tableDocument("d1", [page([
      ["Maternity Care", "Up to $5,000", "No coverage"],
      ["Termination of Pregnancy", "Up to $500", "No coverage"],
      ["Deductible", "$0", "$250"],
    ])]);
    const docs = [doc];
    const table = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
    const planId = table.plans![0].planId;
    const elite = table.rows.find((r) => r.factName === "maternity-coverage")!.values.filter((v) => v.qualifiers.planTier === "ELITE");
    expect(elite).toHaveLength(2);
    expect(elite.every((v) => v.planId === planId)).toBe(true);
    expect(hasSameScopeContradiction(elite)).toBe(false);
  });

  it("does not over-trigger: one label across tiers, or the same value repeated, is not a conflict", () => {
    const { table, planId } = setup();
    expect(presentationStates(table, planId, "BASIC")).toEqual([
      ["Deductible (BASIC): $250", "verified-plan"],
      ["Deductible (BASIC): $250", "verified-plan"],
    ]);
  });

  it("an unstructured contradiction still withholds a lone structural claim (unchanged)", () => {
    const doc = tableDocument("d1", [page([["Deductible", "$0", "$250"], ["Copay", "$10", "$20"], ["Lab", "$1", "$2"]])]);
    const docs = [doc];
    const table = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
    const cells = deductibles(table).filter((v) => v.anchor).map(unscoped);
    const line: CellValue = {
      documentId: "d1", display: "Deductible (ELITE): $900", qualifiers: { planTier: "ELITE" },
      evidence: [{ documentId: "d1", page: 1, quote: "Deductible $0" }, { documentId: "d1", page: 1, quote: "BENEFIT ELITE BASIC" }],
    };
    const ids = resolveRowPlanIds("annual-deductible", [...cells, line], table.plans!, docs);
    expect(ids[cells.findIndex((c) => c.qualifiers.planTier === "ELITE")]).toBeUndefined();
    expect(ids[cells.findIndex((c) => c.qualifiers.planTier === "BASIC")]).toBe(table.plans![0].planId);
  });
});

describe("table-cell scope comes only from its own column heading (EC-3/EC-4)", () => {
  it("ELITE cells under different neighbouring headings (BASIC vs PLUS) are one scope: a conflict", () => {
    const doc = tableDocument("d1", [
      page([["Deductible", "$0", "$250"], ["Copay", "$10", "$20"], ["Lab", "$1", "$2"]]),
      { ...page([["Deductible", "$100", "$300"], ["Copay", "$10", "$20"], ["Lab", "$1", "$2"]], ["Schedule continued"]), headings: ["ELITE", "PLUS"] },
    ]);
    const docs = [doc];
    const table = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
    const planId = table.plans![0].planId;
    const elite = deductibles(table).filter((v) => v.anchor && v.qualifiers.planTier === "ELITE");
    expect(elite.map((v) => v.display)).toEqual(["Deductible (ELITE): $0", "Deductible (ELITE): $100"]);
    expect(elite.every((v) => v.planId === planId)).toBe(true);
    expect(hasSameScopeContradiction(elite)).toBe(true);
    expect(table.rows.find((r) => r.factName === "annual-deductible")!.verdict).toBe("CONFLICTED");
  });
});
