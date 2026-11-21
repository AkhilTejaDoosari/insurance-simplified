// Independent review of the pre-Phase-5 fixes (2026-11-21), findings fixed
// test-first: B1 (service-specific deductibles filed as annual), S6 (a
// numbered list item resolved as a footnote; footnote not cited on the
// lookahead path), S8 (read-back kept a value whose footnote citation
// failed), S3 (definitions that carry the value), S2 (short real values
// treated as labels). Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback, isValuelessLabel } from "@/app/lib/extraction/extract";
import { resolveFootnotes } from "@/app/lib/extraction/fact-list";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { validateTable } from "@/app/lib/extraction/types";

const doc = (lines: string[]) => ({ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [lines.join("\n")] });
const shown = (lines: string[], fact: string) =>
  (extractFallback([doc(lines)], {}).rows.find((r) => r.factName === fact)?.values ?? []).map((v) => v.display);

describe("B1: a deductible for a service or per sickness is not the annual deductible", () => {
  it.each(["Deductible for emergency room $250", "Deductible (prescription drugs) $50", "Deductible per sickness $100", "Deductible at the emergency room $250"])(
    "service/incident line %# stays out of the annual row",
    (line) => expect(shown(["SCHEDULE OF BENEFITS", line], "annual-deductible")).toEqual([]),
  );

  it("per sickness is a per-incident basis", () => {
    expect(shown(["SCHEDULE OF BENEFITS", "Deductible per sickness $100"], "per-illness-deductible")).toEqual(["Deductible per sickness $100"]);
  });

  it.each(["Deductible $500", "Deductible: $500", "Deductible (individual) $500", "Deductible per person $250", "Deductible elsewhere $100", "Deductible in-network $250"])(
    "plan-level deductible line %# is read",
    (line) => expect(shown(["SCHEDULE OF BENEFITS", line], "annual-deductible")).toEqual([line]),
  );
});

describe("S6: footnotes are a numbered note block, not any numbered line", () => {
  it("a numbered list item is not a footnote of a marked label", () => {
    const r = resolveFootnotes(["Deductible2 elsewhere $100", "Schedule notes", "2 Office visits $20 per visit"]);
    expect(r[0].footnotes).toEqual([]);
  });

  it("a note block 1, 2 … without amounts resolves", () => {
    const r = resolveFootnotes(["Deductible1 elsewhere $100", "Coinsurance2 80%", "1 Per injury or sickness", "2 Refer to the benefit description."]);
    expect(r[0].footnotes).toEqual([2]);
    expect(r[1].footnotes).toEqual([3]);
  });

  it("a note block that does not start at 1 does not resolve", () => {
    const r = resolveFootnotes(["Deductible2 elsewhere $100", "2 Per injury or sickness"]);
    expect(r[0].footnotes).toEqual([]);
  });

  it("a value read on the lookahead line still cites the label's footnote", () => {
    const t = extractFallback([doc(["Elite Select", "Deductible1", "$250 $500", "1 Per injury or sickness"])], {});
    const fromLookahead = t.rows.flatMap((r) => r.values).filter((v) => v.evidence.some((e) => e.quote.startsWith("$250")));
    expect(fromLookahead.length).toBeGreaterThan(0);
    for (const v of fromLookahead) expect(v.evidence.map((e) => e.quote)).toContain("1 Per injury or sickness");
  });
});

describe("S8: a value's citations verify all-or-nothing", () => {
  it("a value whose footnote citation does not verify is dropped, not kept on its label line", () => {
    const d = doc(["Deductible1 elsewhere $100", "1 Per injury or sickness"]);
    const table = validateTable(extractFallback([d], {}));
    const row = table.rows.find((r) => r.factName === "per-illness-deductible")!;
    expect(row.values).toHaveLength(1);
    // Tamper: the footnote no longer reads as it did on the page.
    row.values[0].evidence[1] = { ...row.values[0].evidence[1], quote: "1 Per policy year" };
    const verified = verifyComparisonTable(table, [d]);
    expect(verified.rows.find((r) => r.factName === "per-illness-deductible")?.values ?? []).toEqual([]);
  });
});

describe("S3: a definition that carries a figure, or a 'this means' line, is kept", () => {
  it("'This means …' explains a cost and is kept", () => {
    expect(shown(["This means you pay $300 per emergency room visit"], "emergency-care")).toEqual(["This means you pay $300 per emergency room visit"]);
    expect(shown(["That means the plan pays 80% coinsurance after the deductible"], "coinsurance")).toEqual(["That means the plan pays 80% coinsurance after the deductible"]);
  });

  it("'<term> means … $amount' is kept for its fact", () => {
    expect(shown(["Out-of-pocket maximum means the most you pay: $6,000"], "out-of-pocket-maximum")).toEqual(["Out-of-pocket maximum means the most you pay: $6,000"]);
  });
});

describe("S2: short real values are not labels", () => {
  it.each(["Requires preauthorization", "Referral needed", "Two visits per year", "You pay nothing", "Free of charge", "Guaranteed renewable", "After deductible", "Emergency services worldwide", "Physical therapy visits20"])(
    "%s is a value",
    (line) => expect(isValuelessLabel(line)).toBe(false),
  );

  it.each(["Specialist", "Urgent Care", "REPATRIATION OF REMAINS", "EXCLUSIONS"])("%s is still a label", (line) => {
    expect(isValuelessLabel(line)).toBe(true);
  });
});
