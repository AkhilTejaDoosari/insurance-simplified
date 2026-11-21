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

// Follow-up review (2026-11-21) of 685f2fc: N1–N4, S7.
describe("N1/N2: an unresolved footnote never decides a basis-dependent row", () => {
  const rows = (lines: string[]) => extractFallback([doc(lines)], {}).rows;
  const get = (lines: string[], fact: string) => rows(lines).find((r) => r.factName === fact);

  it("a footnote whose note text carries an amount still resolves", () => {
    const lines = ["Deductible1 $100", "1 Per injury or sickness, up to $500 per policy year"];
    expect(get(lines, "annual-deductible")?.values ?? []).toEqual([]);
    expect((get(lines, "per-illness-deductible")?.values ?? []).map((v) => v.display)).toEqual(["Deductible1 $100"]);
  });

  it("a marked deductible whose footnote cannot be found is withheld, not filed as annual", () => {
    const lines = ["Deductible1 $100", "3 Office visits", "1 Per injury or sickness"];
    const annual = get(lines, "annual-deductible");
    expect(annual?.values ?? []).toEqual([]);
    expect((annual?.withheld ?? []).map((w) => w.reason)).toContain("footnote-unresolved");
  });

  it("a numbered exclusion list under its heading is not a note block", () => {
    const lines = ["Deductible1 $100", "Exclusions", "1 Cosmetic surgery", "2 Dental care"];
    expect(resolveFootnotes(lines)[0].footnotes).toEqual([]);
    expect((get(lines, "annual-deductible")?.withheld ?? []).map((w) => w.reason)).toContain("footnote-unresolved");
  });

  it("an unmarked deductible is unaffected", () => {
    expect((get(["Deductible $100"], "annual-deductible")?.values ?? []).map((v) => v.display)).toEqual(["Deductible $100"]);
  });
});

describe("N3: a marked label with a resolved footnote is still a label", () => {
  it("'Specialist2' with footnote 2 on the page is withheld, not shown", () => {
    const t = extractFallback([doc(["Copay per visit:", "Specialist2", "$30", "1 Per visit", "2 Referral required"])], {});
    const row = t.rows.find((r) => r.factName === "specialist-visit");
    expect((row?.values ?? []).map((v) => v.display)).not.toContain("Specialist2");
  });
});

describe("N4: headings stay headings", () => {
  it.each(["WORLDWIDE ASSISTANCE", "One Call Assistance", "Before departure", "Full policy wording", "EMERGENCY DENTAL"])("%s is a label", (line) => {
    expect(isValuelessLabel(line)).toBe(true);
  });
  it.each(["NOT COVERED", "Two visits per year", "Paid in full", "After deductible", "Emergency services worldwide"])("%s is a value", (line) => {
    expect(isValuelessLabel(line)).toBe(false);
  });
});

describe("S7: a maximum directly under a benefit label is that benefit's sub-limit", () => {
  it("'Annual maximum $1,000' under 'Physical therapy' is not the policy limit", () => {
    expect(shown(["SCHEDULE OF BENEFITS", "Physical therapy", "Annual maximum $1,000"], "policy-limit")).toEqual([]);
  });
  it("a schedule's overall annual maximum is still read", () => {
    expect(shown(["SCHEDULE OF BENEFITS", "Policy number 12345", "Annual maximum $1,000,000"], "policy-limit")).toEqual(["Annual maximum $1,000,000"]);
  });
});

// Residual (owner list after Phase 2, surfaced by grid-first 2026-11-21): a
// plan-limit line that opens mid-sentence is the tail of a wrapped sentence,
// not the plan's limit ("…birth. Maximum coverage is $500." is a newborn cap).
describe("policy-limit takes no wrapped-sentence fragments", () => {
  it.each([
    "payable for all covered medical expenses will be no more than the maximum benefit limit per coverage maximum.",
    "is in effect at the moment of birth. Maximum coverage is $500. You must give us notice within 31 days",
    "reasonable and customary charges for medically necessary covered medical expenses, subject to the maximum benefit",
  ])("fragment %# is not the policy limit", (line) => {
    expect(shown(["COVERAGE", line], "policy-limit")).toEqual([]);
  });
  it("a schedule line and a sentence opening the line are still read", () => {
    expect(shown(["SCHEDULE", "Annual maximum $1,000,000"], "policy-limit")).toEqual(["Annual maximum $1,000,000"]);
    expect(shown(["COVERAGE", "The maximum benefit is $250,000 per policy year."], "policy-limit")).toEqual(["The maximum benefit is $250,000 per policy year."]);
  });
});
