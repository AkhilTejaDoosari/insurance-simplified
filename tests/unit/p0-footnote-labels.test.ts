// Owner decision 2026-11-21, doc 02 fix 2: a footnote marker glued to a
// label ("Deductible1", "Annual maximum²") must not hide the fact, and a
// schedule line "Annual maximum $1,000,000" is the plan's overall limit.
// Markers are ignored for MATCHING only; the quote and display stay the
// verbatim source line. Reproduced on an owner PDF whose benefit schedule
// lost both deductibles and the annual maximum. Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { withoutFootnoteMarkers } from "@/app/lib/extraction/fact-list";

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

  it("a schedule deductible with a footnote marker is read, verbatim", () => {
    const shown = valuesFor(["SCHEDULE OF BENEFITS", "Deductible1 at the student health center $50", "Deductible1 elsewhere $100"], "annual-deductible");
    expect(shown).toEqual(["Deductible1 at the student health center $50", "Deductible1 elsewhere $100"]);
  });

  it("a per-illness deductible with a marker stays per-illness, not annual", () => {
    const lines = ["SCHEDULE OF BENEFITS", "Deductible2 per illness $250"];
    expect(valuesFor(lines, "annual-deductible")).toEqual([]);
    expect(valuesFor(lines, "per-illness-deductible")).toEqual(["Deductible2 per illness $250"]);
  });

  it("a per-visit deductible is not the annual deductible", () => {
    expect(valuesFor(["Deductible per visit $25"], "annual-deductible")).toEqual([]);
  });

  it("a deductible line that waives or credits is not a deductible amount", () => {
    expect(valuesFor(["Deductible waived for the first $500 of preventive care"], "annual-deductible")).toEqual([]);
  });
});

describe("annual maximum is the overall plan limit", () => {
  it.each(["Annual maximum $1,000,000", "Annual maximum3 $500,000", "Overall maximum: $250,000"])("overall-limit line %# → policy-limit", (line) => {
    expect(valuesFor(["SCHEDULE OF BENEFITS", line], "policy-limit")).toEqual([line]);
  });

  it.each([
    "Dental annual maximum $1,000",
    "Annual maximum out-of-pocket $5,000",
    "Annual maximum visits 20",
  ])("non-overall maximum %# is not the overall limit", (line) => {
    expect(valuesFor(["SCHEDULE OF BENEFITS", line], "policy-limit")).toEqual([]);
  });
});
