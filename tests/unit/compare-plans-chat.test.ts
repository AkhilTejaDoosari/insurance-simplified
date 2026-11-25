// Comparison answers from the verified grid (owner decision 2026-11-25).
// Synthetic plans and figures only.
import { describe, expect, it } from "vitest";
import { CANNOT_RANK, NEEDS_CHECK, NOT_STATED_IN_PLAN, NOT_VERIFIED_IN_PLAN, comparePlansAnswer, comparisonConcept } from "@/app/lib/chat/compare-plans";
import { conceptForQuestion } from "@/app/lib/chat/grid-first";
import type { CellValue, TableRow } from "@/app/lib/extraction/types";

const NAMES = ["Northwind Alpha", "Harbor Beta", "Vista Gamma"];
const docs = (cells: (string | undefined)[], extra = "") => NAMES.map((name, i) => ({
  documentId: `d${i}`, pageCount: 1,
  pages: [`${name}\nBenefit\nPlan Pays\n${cells[i] === undefined ? "" : `Emergency room copay\n${cells[i]}\n`}${extra}`],
}));
const plans = NAMES.map((name, i) => ({ planId: `p${i}`, name, sources: [{ documentId: `d${i}`, page: 1, quote: name }] }));
const cell = (i: number, text: string, over: Partial<CellValue> = {}): CellValue => ({
  documentId: `d${i}`, planId: `p${i}`, display: `Emergency room copay (Plan Pays): ${text}`, qualifiers: { conditions: "Plan Pays" },
  evidence: [{ documentId: `d${i}`, page: 1, quote: `Emergency room copay\n${text}` }, { documentId: `d${i}`, page: 1, quote: "Plan Pays" }],
  anchor: { kind: "table-cell", page: 1, table: 0, row: 0, column: 0, label: "Emergency room copay" }, ...over,
});
const row = (values: CellValue[], over: Partial<TableRow> = {}): TableRow => ({ factName: "emergency-care", verdict: "SUPPORTED", values, ...over });
const ask = (question: string, cells: (string | undefined)[], rows?: TableRow[], selection?: { planIds: string[]; tiers: Record<string, string | null> }) => {
  const d = docs(cells);
  const values = cells.flatMap((c, i) => (c === undefined ? [] : [cell(i, c)]));
  return comparePlansAnswer({ question, table: { rows: rows ?? [row(values)], plans }, scopedDocuments: d, sessionDocuments: d, selection });
};
const LOWEST = "Which plan has the lowest emergency room cost?";

describe("comparison questions", () => {
  it("lists each plan's verified value with its citation, and the lowest of plain comparable amounts", () => {
    const a = ask(LOWEST, ["$250", "$100", "$175"])!;
    expect(a.answerText.split("\n")).toEqual([
      "Northwind Alpha — Emergency room copay (Plan Pays): $250",
      "Harbor Beta — Emergency room copay (Plan Pays): $100",
      "Vista Gamma — Emergency room copay (Plan Pays): $175",
      "Lowest stated value: Harbor Beta ($100)",
    ]);
    expect(new Set(a.citations.map((c) => c.documentId))).toEqual(new Set(["d0", "d1", "d2"]));
    expect(ask("Which plan has the highest emergency room copay?", ["$250", "$100", "$250"])!.answerText).toContain("Highest stated value: Northwind Alpha ($250), Vista Gamma ($250)");
  });

  it("says when one plan has no verified value, and does not rank", () => {
    const lines = ask(LOWEST, ["$250", undefined, "$175"])!.answerText.split("\n");
    expect(lines[1]).toBe(`Harbor Beta — ${NOT_STATED_IN_PLAN}`);
    expect(lines.at(-1)).toBe(CANNOT_RANK);
  });

  it("never says not stated when the plan's document mentions it", () => {
    const { planId: _p, ...unattributed } = cell(1, "$100");
    const withText = ask(LOWEST, ["$250", "$100", "$175"], [row([cell(0, "$250"), unattributed, cell(2, "$175")])])!;
    expect(withText.answerText).toContain(`Harbor Beta — ${NOT_VERIFIED_IN_PLAN}`);
    const withheld = ask(LOWEST, ["$250", undefined, "$175"], [row([cell(0, "$250"), cell(2, "$175")], { withheld: [{ documentId: "d1", page: 1, quote: "Harbor Beta", reason: "label-unrecognized" }] })])!;
    expect(withheld.answerText).toContain(`Harbor Beta — ${NOT_VERIFIED_IN_PLAN}`);
  });

  it.each([
    ["mixed units", ["$250", "10%", "$175"]],
    ["a value that is not a plain number", ["$250", "URC; $100 copay", "$175"]],
    ["a range", ["$0 - $500", "$100", "$175"]],
  ])("does not rank %s", (_label, cells) => {
    const text = ask(LOWEST, cells as string[])!.answerText;
    expect(text).toContain(CANNOT_RANK);
    expect(text).not.toMatch(/Lowest stated value/);
  });

  it("does not rank uncertain, conditional or differently scoped values, and says when they need checking", () => {
    const values = [cell(0, "$250"), cell(1, "$100"), cell(2, "$175")];
    const uncertain = ask(LOWEST, ["$250", "$100", "$175"], [row(values, { verdict: "NEEDS VERIFICATION" })])!.answerText;
    expect(uncertain).toContain(NEEDS_CHECK);
    expect(uncertain).toContain(CANNOT_RANK);
    const network = [cell(0, "$250"), cell(1, "$100", { qualifiers: { networkTier: "Plan Pays" } }), cell(2, "$175")];
    expect(ask(LOWEST, ["$250", "$100", "$175"], [row(network)])!.answerText).toContain(CANNOT_RANK);
  });

  it("uses only selected plans, and only values that verify in the chat scope", () => {
    const a = ask("Compare the emergency room copay for all plans", ["$250", "$100", "$175"], undefined, { planIds: ["p0", "p2"], tiers: {} })!;
    expect(a.answerText).not.toContain("Harbor Beta");
    const bad = cell(1, "$100", { evidence: [{ documentId: "d1", page: 1, quote: "Emergency room copay\n$9" }] });
    const b = ask(LOWEST, ["$250", "$100", "$175"], [row([cell(0, "$250"), bad, cell(2, "$175")])])!;
    expect(b.answerText).not.toContain("$100");
    expect(b.answerText).toContain(`Harbor Beta — ${NOT_VERIFIED_IN_PLAN}`);
  });

  it.each([
    ["not a comparison", "What is the emergency room copay?"],
    ["no grid concept", "Which plan covers space tourism?"],
    ["two concepts", "Which plan has the lowest dental deductible?"],
  ])("leaves today's behaviour: %s", (_label, question) => {
    expect(ask(question, ["$250", "$100", "$175"])).toBeUndefined();
  });

  it("leaves one selected plan, conflicted rows and the single-answer concept rule alone", () => {
    expect(ask(LOWEST, ["$250", "$100", "$175"], undefined, { planIds: ["p1"], tiers: {} })).toBeUndefined();
    expect(ask(LOWEST, ["$250", "$100", "$175"], [row([cell(0, "$250"), cell(1, "$100")], { verdict: "CONFLICTED" })])).toBeUndefined();
    expect(conceptForQuestion("Is hospitalization covered?")).toBeUndefined();
    for (const [q, id] of [["Compare the ambulance coverage for all plans", "ambulance"], ["Which plan has the cheapest urgent care?", "urgent-care"], ["Compare prescriptions across these plans", "prescriptions"], ["Compare hospitalization", "hospitalization"], ["Which plan has the lowest deductible?", "deductible"]]) {
      expect(comparisonConcept(q)?.id).toBe(id);
    }
  });
});

describe("chat panel", () => {
  it("shows no internal verdict label", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/components/ChatPanel.tsx", "utf8");
    expect(source).not.toContain("{r.factName}");
    expect(source).not.toContain("Related comparison results");
  });
});
