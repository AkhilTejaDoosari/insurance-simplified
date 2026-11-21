// Owner decision 2026-11-21, doc 02 fix 2: a footnote marker glued to a
// label ("Deductible1", "Annual maximum²") must not hide the fact, and a
// schedule line "Annual maximum $1,000,000" is the plan's overall limit.
// Markers are ignored for MATCHING only; the quote and display stay the
// verbatim source line. Reproduced on an owner PDF whose benefit schedule
// lost both deductibles and the annual maximum. Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { withoutFootnoteMarkers } from "@/app/lib/extraction/fact-list";

function withheldFor(lines: string[], fact: string) {
  const table = extractFallback([{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [lines.join("\n")] }], {});
  return (table.rows.find((r) => r.factName === fact)?.withheld ?? []).map((w) => w.quote);
}

function valuesFor(lines: string[], fact: string) {
  const table = extractFallback([{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [lines.join("\n")] }], {});
  return (table.rows.find((r) => r.factName === fact)?.values ?? []).map((v) => v.display);
}

describe("footnote markers on labels", () => {
  it("strips a glued marker for matching, nothing else", () => {
    expect(withoutFootnoteMarkers("Deductible1 at the student health center $50")).toBe("Deductible at the student health center $50");
    expect(withoutFootnoteMarkers("Coinsurance in-network2 80%")).toBe("Coinsurance in-network 80%");
    expect(withoutFootnoteMarkers("Annual maximum³: $500,000")).toBe("Annual maximum: $500,000");
    // Amounts, ages, visa codes and short codes are not markers.
    expect(withoutFootnoteMarkers("$1,000,000 per 12 months; F1 or J1; age 26")).toBe("$1,000,000 per 12 months; F1 or J1; age 26");
  });

  // Review N1 (follow-up): a marked deductible whose footnote is NOT on
  // the page has an unknown basis — it is withheld for verification, never
  // filed by its marker-free text (these two cases asserted filing before).
  it("a marked schedule deductible without its footnote is withheld, verbatim", () => {
    const lines = ["SCHEDULE OF BENEFITS", "Deductible1 at the student health center $50", "Deductible1 elsewhere $100"];
    expect(valuesFor(lines, "annual-deductible")).toEqual([]);
    expect(withheldFor(lines, "annual-deductible")).toEqual(["Deductible1 elsewhere $100"]);
  });

  it("a marked per-illness deductible without its footnote is withheld, never annual", () => {
    const lines = ["SCHEDULE OF BENEFITS", "Deductible2 per illness $250"];
    expect(valuesFor(lines, "annual-deductible")).toEqual([]);
    expect(valuesFor(lines, "per-illness-deductible")).toEqual([]);
    expect(withheldFor(lines, "per-illness-deductible")).toEqual(["Deductible2 per illness $250"]);
  });

  it("a per-visit deductible is not the annual deductible", () => {
    expect(valuesFor(["Deductible per visit $25"], "annual-deductible")).toEqual([]);
  });

  it("a deductible line that waives or credits is not a deductible amount", () => {
    expect(valuesFor(["Deductible waived for the first $500 of preventive care"], "annual-deductible")).toEqual([]);
  });
});

describe("a resolved footnote is part of the label's meaning", () => {
  // The owner PDF's footnote 1 reads "Per injury or sickness": the marked
  // deductibles are per-illness deductibles, never the annual deductible.
  const SCHEDULE = [
    "SUMMARY SCHEDULE OF BENEFITS",
    "Deductible1 at the student health center $50",
    "Deductible1 elsewhere $100",
    "Coinsurance in-network2 80% of preferred allowance",
    "1 Per injury or sickness",
    "2 Refer to the benefit description for daily limits.",
  ];
  const table = () =>
    extractFallback([{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [SCHEDULE.join("\n")] }], {});
  const row = (fact: string) => table().rows.find((r) => r.factName === fact)?.values ?? [];

  it("a per-illness footnote keeps the deductible out of the annual row", () => {
    expect(row("annual-deductible")).toEqual([]);
  });

  it("files it as the per-illness deductible, citing the label line and its footnote", () => {
    const values = row("per-illness-deductible");
    expect(values.map((v) => v.display)).toEqual(["Deductible1 at the student health center $50", "Deductible1 elsewhere $100"]);
    for (const v of values) {
      expect(v.evidence.map((e) => e.quote)).toEqual([v.display, "1 Per injury or sickness"]);
    }
  });

  it("an unrelated footnote does not change the fact and is cited with it", () => {
    const value = row("coinsurance").find((v) => v.display === "Coinsurance in-network2 80% of preferred allowance");
    expect(value?.evidence.map((e) => e.quote)).toEqual([
      "Coinsurance in-network2 80% of preferred allowance",
      "2 Refer to the benefit description for daily limits.",
    ]);
  });

  it("a footnote line ABOVE the marked label is not its footnote", () => {
    const t = extractFallback([{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [["1 Per injury or sickness", "Deductible1 elsewhere $100"].join("\n")] }], {});
    // Not its footnote, so the marker is unresolved (review N1): withheld.
    const row = t.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.values ?? []).toEqual([]);
    expect((row?.withheld ?? []).map((w) => w.reason)).toEqual(["footnote-unresolved"]);
  });
});

describe("annual maximum is the overall plan limit", () => {
  it.each(["Annual maximum $1,000,000", "Overall maximum: $250,000"])("overall-limit line %# → policy-limit", (line) => {
    expect(valuesFor(["SCHEDULE OF BENEFITS", line], "policy-limit")).toEqual([line]);
  });

  it("a marked annual maximum whose footnote is not on the page is withheld (review N1)", () => {
    const lines = ["SCHEDULE OF BENEFITS", "Annual maximum3 $500,000"];
    expect(valuesFor(lines, "policy-limit")).toEqual([]);
    expect(withheldFor(lines, "policy-limit")).toEqual(["Annual maximum3 $500,000"]);
  });

  it("a marked annual maximum with its footnote resolves and cites it", () => {
    const lines = ["SCHEDULE OF BENEFITS", "Annual maximum3 $500,000", "1 Per policy year", "2 Network providers only", "3 Per covered person"];
    expect(valuesFor(lines, "policy-limit")).toEqual(["Annual maximum3 $500,000"]);
  });

  it.each([
    "Dental annual maximum $1,000",
    "Annual maximum out-of-pocket $5,000",
    "Annual maximum visits 20",
  ])("non-overall maximum %# is not the overall limit", (line) => {
    expect(valuesFor(["SCHEDULE OF BENEFITS", line], "policy-limit")).toEqual([]);
  });
});
