// Table-cell claims through the production verification boundary
// (extractFallback → validateTable → verifyComparisonTable), i.e. exactly the
// /api/extract deterministic path minus HTTP/session plumbing.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type CellValue, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { columnQualifiers, factsForLabel, verifyTableAnchor } from "@/app/lib/extraction/table-facts";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import { tableDocument, type TablePageSpec, type TestDocument } from "./helpers/table-doc";

const schedule = (extra: Partial<TablePageSpec> = {}): TablePageSpec => ({
  preamble: ["Policy name: Alpha"],
  caption: "BENEFIT",
  headings: ["ELITE", "BASIC"],
  rows: [
    ["Deductible", "$0", "$250"],
    ["Maternity Care", "Up to $5,000", "No coverage"],
    ["Local Ambulance", "Up to $750", "Up to $500"],
  ],
  ...extra,
});

function run(docs: TestDocument[]): ComparisonTable {
  return verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
}
const anchoredIn = (t: ComparisonTable, fact: string) =>
  t.rows.find((r) => r.factName === fact)?.values.filter((v) => v.anchor) ?? [];
const planOf = (t: ComparisonTable) => t.plans?.[0]?.planId;

describe("table cells: fact from the label, scope from the heading, display verbatim", () => {
  it("attributes each tier's cell to the single verified plan with its tier", () => {
    const t = run([tableDocument("d1", [schedule()])]);
    const values = anchoredIn(t, "annual-deductible");
    expect(values.map((v) => [v.display, v.qualifiers.planTier, v.planId])).toEqual([
      ["Deductible (ELITE): $0", "ELITE", planOf(t)],
      ["Deductible (BASIC): $250", "BASIC", planOf(t)],
    ]);
  });

  it("keeps an exclusion cell as its own verbatim statement for its own tier", () => {
    const t = run([tableDocument("d1", [schedule()])]);
    const basic = anchoredIn(t, "maternity-coverage").find((v) => v.qualifiers.planTier === "BASIC");
    expect(basic?.display).toBe("Maternity Care (BASIC): No coverage");
  });

  it("cites the row span and the header span, both verified on the page", () => {
    const docs = [tableDocument("d1", [schedule()])];
    const value = anchoredIn(run(docs), "ambulance")[1];
    expect(value.evidence.map((e) => e.quote.replace(/\s+/g, " ").trim())).toEqual(["Local Ambulance Up to $750 Up to $500", "BENEFIT ELITE BASIC"]);
    expect(value.evidence.every((e) => docs[0].pages[e.page - 1].includes(e.quote))).toBe(true);
  });

  it("the line engine does not emit its own column-blind reading of table lines", () => {
    const t = run([tableDocument("d1", [schedule()])]);
    const lineValues = t.rows.flatMap((r) => r.values.filter((v) => !v.anchor && /\$750|\$250/.test(v.display)));
    expect(lineValues).toEqual([]);
  });
});

describe("table cells: ownership guards (fail closed)", () => {
  it("abstains on a document that declares two plans", () => {
    const t = run([tableDocument("d1", [schedule({ preamble: ["Policy name: Alpha", "Policy name: Beta"] })])]);
    expect(anchoredIn(t, "annual-deductible").every((v) => v.planId === undefined)).toBe(true);
  });

  it("abstains when a later page declares a different plan", () => {
    const t = run([tableDocument("d1", [schedule(), "Plan name: Sample Plan"])]);
    expect(anchoredIn(t, "annual-deductible").every((v) => v.planId === undefined)).toBe(true);
  });

  it("abstains on a row naming another verified plan", () => {
    const docs = [
      tableDocument("d1", [schedule({ rows: [["Deductible (unlike Beta Plan)", "$0", "$250"], ["Copay", "$10", "$20"], ["Lab", "$1", "$2"]] })]),
      tableDocument("d2", [schedule({ preamble: ["Policy name: Beta Plan"] })]),
    ];
    const t = run(docs);
    const d1 = anchoredIn(t, "annual-deductible").filter((v) => v.documentId === "d1");
    expect(d1.length).toBeGreaterThan(0);
    expect(d1.every((v) => v.planId === undefined)).toBe(true);
  });

  it("abstains on rider/optional/example language in the row", () => {
    const t = run([tableDocument("d1", [schedule({ rows: [["Optional Dental Rider", "$50", "$80"], ["Deductible", "$0", "$250"], ["Copay", "$10", "$20"]] })])]);
    const dental = anchoredIn(t, "dental-coverage");
    expect(dental.length).toBe(2);
    expect(dental.every((v) => v.planId === undefined)).toBe(true);
    expect(anchoredIn(t, "annual-deductible").every((v) => v.planId === planOf(t))).toBe(true);
  });

  it("isolates documents: each table attributes only to its own document's plan", () => {
    const docs = [tableDocument("d1", [schedule()]), tableDocument("d2", [schedule({ preamble: ["Policy name: Beta Plan"] })])];
    const t = run(docs);
    const byDoc = new Map(t.plans!.map((p) => [p.sources[0].documentId, p.planId]));
    for (const v of anchoredIn(t, "annual-deductible")) expect(v.planId).toBe(byDoc.get(v.documentId));
  });
});

describe("table anchors cannot be forged", () => {
  const docs = [tableDocument("d1", [schedule()])];
  const genuine = (): CellValue => ({ ...anchoredIn(run(docs), "annual-deductible")[1], planId: undefined });

  it("a genuine anchor re-derives", () => {
    expect(verifyTableAnchor("annual-deductible", genuine(), docs)).toBe(true);
  });
  it.each([
    ["altered display", (v: CellValue) => ({ ...v, display: "Deductible (BASIC): $25" })],
    ["swapped tier", (v: CellValue) => ({ ...v, qualifiers: { ...v.qualifiers, planTier: "ELITE" } })],
    ["added network scope", (v: CellValue) => ({ ...v, qualifiers: { ...v.qualifiers, networkTier: "In-Network" } })],
    ["other column", (v: CellValue) => ({ ...v, anchor: { ...v.anchor!, column: 0 } })],
    ["other row", (v: CellValue) => ({ ...v, anchor: { ...v.anchor!, row: 1 } })],
    ["other document", (v: CellValue) => ({ ...v, documentId: "d2" })],
    ["missing header citation", (v: CellValue) => ({ ...v, evidence: v.evidence.slice(0, 1) })],
    ["relabelled row", (v: CellValue) => ({ ...v, anchor: { ...v.anchor!, label: "Copay" } as CellValue["anchor"] })],
  ])("%s does not verify", (_label, mutate) => {
    expect(verifyTableAnchor("annual-deductible", mutate(genuine()), docs)).toBe(false);
  });
  it("a different fact than the label's does not verify", () => {
    expect(verifyTableAnchor("premium", genuine(), docs)).toBe(false);
  });

  it("a forged anchored value is dropped at the boundary, never displayed", () => {
    const table = validateTable(extractFallback(docs, {}));
    const row = table.rows.find((r) => r.factName === "annual-deductible")!;
    const forged = { ...row.values.find((v) => v.anchor)!, display: "Deductible (ELITE): $25" };
    row.values.push(forged);
    const out = verifyComparisonTable(table, docs);
    expect(out.rows.find((r) => r.factName === "annual-deductible")!.values.map((v) => v.display)).not.toContain("Deductible (ELITE): $25");
  });
});

describe("column headings and labels", () => {
  it.each([
    ["ELITE Limit", { planTier: "ELITE" }],
    ["Travel Medical Basic", { planTier: "Basic" }],
    ["United States In-Network", { networkTier: "In-Network", conditions: "United States" }],
    ["Out-of-Network", { networkTier: "Out-of-Network" }],
    ["International", { conditions: "International" }],
    ["Gold Plus", { conditions: "Gold Plus" }],
  ])("%s → %j", (heading, expected) => {
    expect(columnQualifiers(heading)).toEqual(expected);
  });

  it("chooses facts from the label head, not from its sub-notes or parentheticals", () => {
    expect(factsForLabel("Urgent Care • Not subject to Deductible")).toEqual(["urgent-care"]);
    expect(factsForLabel("Mental Health Disorders (Treatment must not be provided at a student health center)")).toEqual(["mental-health"]);
    expect(factsForLabel("Deductible Options (You pay)")).toContain("annual-deductible");
  });
});

describe("contradiction is per provision", () => {
  const docs = [tableDocument("d1", [schedule({ rows: [
    ["Maternity Care", "Up to $5,000", "No coverage"],
    ["Termination of Pregnancy", "Up to $500", "No coverage"],
    ["Deductible", "$0", "$250"],
  ] })])];
  const t = run(docs);
  const elite = anchoredIn(t, "maternity-coverage").filter((v) => v.qualifiers.planTier === "ELITE");

  it("two rows of one tier are different provisions, not a conflict", () => {
    expect(elite).toHaveLength(2);
    expect(hasSameScopeContradiction(elite)).toBe(false);
    expect(elite.every((v) => v.planId === planOf(t))).toBe(true);
  });

  it("the same row label stated differently in one scope IS a conflict", () => {
    const [a] = elite;
    expect(hasSameScopeContradiction([a, { ...a, display: a.display.replace("$5,000", "$9,000") }])).toBe(true);
  });
});
