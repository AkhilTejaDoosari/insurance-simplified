import { describe, expect, it } from "vitest";
import {
  matchEvidencePassage,
  normalizeForMatch,
  type PdfTextItemInput,
} from "@/app/lib/pdf/text-match";

const item = (
  str: string,
  opts: Partial<PdfTextItemInput> = {}
): PdfTextItemInput => ({
  str,
  hasEOL: false,
  transform: [10, 0, 0, 10, 72, 700],
  width: str.length * 5,
  height: 10,
  ...opts,
});

describe("normalizeForMatch", () => {
  it("unifies whitespace, NBSP, quotes, and dashes", () => {
    expect(normalizeForMatch("a  b\u00A0c")).toBe("a b c");
    expect(normalizeForMatch("\u201CHi\u201D")).toBe('"Hi"');
    expect(normalizeForMatch("\u2018Hi\u2019")).toBe("'Hi'");
    expect(normalizeForMatch("a\u2013b\u2014c\u2212d")).toBe("a-b-c-d");
    expect(normalizeForMatch("a\u00ADb")).toBe("ab");
  });
});

describe("matchEvidencePassage", () => {
  it("matches a single text item and returns its geometry", () => {
    const items = [item("Annual deductible: $250."), item("Something else.", { hasEOL: true })];
    const found = matchEvidencePassage(items, "Annual deductible: $250.");
    expect(found.status).toBe("unique");
    if (found.status !== "unique") return;
    expect(found.rects).toHaveLength(1);
    expect(found.rects[0].item).toBe(0);
    const [x0, y0, x1, y1] = found.rects[0].box;
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
  });

  it("matches across multiple adjacent items and lines", () => {
    const items = [
      item("Annual deductible: "),
      item("$250 in-", { transform: [10, 0, 0, 10, 200, 700] }),
      item("network.", { hasEOL: true, transform: [10, 0, 0, 10, 72, 680] }),
      item("Unrelated line."),
    ];
    const found = matchEvidencePassage(items, "Annual deductible: $250 in-network.");
    expect(found.status).toBe("unique");
    if (found.status !== "unique") return;
    expect(found.rects.map((r) => r.item).sort()).toEqual([0, 1, 2]);
  });

  it("tolerates a line break where the quote has a space", () => {
    const items = [
      item("Annual deductible:", { hasEOL: true }),
      item("$250 in-network.", { transform: [10, 0, 0, 10, 72, 680] }),
    ];
    const found = matchEvidencePassage(items, "Annual deductible: $250 in-network.");
    expect(found.status).toBe("unique");
    if (found.status !== "unique") return;
    expect(found.rects.map((r) => r.item).sort()).toEqual([0, 1]);
  });

  it("tolerates NBSP and Unicode quote/dash variants", () => {
    const items = [item("Emergency copay \u2014 $100, \u201Cwaived\u201D.")];
    const found = matchEvidencePassage(items, 'Emergency copay - $100, "waived".');
    expect(found.status).toBe("unique");
  });

  it("tolerates safe line-wrap hyphenation", () => {
    const items = [
      item("out-of-pocket maxi-", { hasEOL: true }),
      item("mum: $3,000.", { transform: [10, 0, 0, 10, 72, 680] }),
    ];
    const found = matchEvidencePassage(items, "out-of-pocket maximum: $3,000.");
    expect(found.status).toBe("unique");
  });

  it("returns none when the passage is absent", () => {
    const items = [item("Annual deductible: $250.")];
    expect(matchEvidencePassage(items, "Excluded until 12 months.").status).toBe("none");
  });

  it("returns ambiguous instead of guessing on duplicate passages", () => {
    const items = [item("Copay $10."), item("Copay $10.", { transform: [10, 0, 0, 10, 72, 680] })];
    expect(matchEvidencePassage(items, "Copay $10.").status).toBe("ambiguous");
  });

  it("returns none for empty quotes or no items", () => {
    expect(matchEvidencePassage([item("x")], "   ").status).toBe("none");
    expect(matchEvidencePassage([], "x").status).toBe("none");
  });

  it("scales partial-item geometry by matched fraction", () => {
    const items = [item("AA BB CC", { transform: [1, 0, 0, 1, 100, 500], width: 60, height: 10 })];
    const found = matchEvidencePassage(items, "BB");
    expect(found.status).toBe("unique");
    if (found.status !== "unique") return;
    const [x0, , x1] = found.rects[0].box;
    // "BB" is chars 3..5 of 8 → fractions 3/8..5/8 of width 60 from x=100.
    expect(x0).toBeCloseTo(100 + 60 * (3 / 8), 6);
    expect(x1).toBeCloseTo(100 + 60 * (5 / 8), 6);
  });
});
