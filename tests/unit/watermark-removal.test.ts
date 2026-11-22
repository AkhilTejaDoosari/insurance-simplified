// Owner decision 2026-11-22 (6): watermark artifacts are removed at
// extraction. Text that repeats as a whole text item on most pages (e.g.
// "SAMPLE", "For Inquiry Purposes Only") is removed from page text,
// including when glued to an adjacent token ("$1,500SAMPLE" → "$1,500").
// Removal is recorded per page as counts only. Never removed: a token that
// carries a figure, or text that is a table cell on its own. Synthetic.
import { describe, expect, it } from "vitest";
import { positionItems, type RawTextItem } from "@/app/lib/pdf/layout-tables";
import { removeRepeatedArtifacts } from "@/app/lib/pdf/watermarks";

const FS = 9;
const item = (str: string, x: number, y: number, hasEOL = false): RawTextItem => ({ str, transform: [FS, 0, 0, FS, x, y], width: str.length * 4.5, hasEOL });
const text = (items: RawTextItem[]) => positionItems(items).text;

function page(n: number, extra: RawTextItem[] = []): RawTextItem[] {
  return [
    item(`Benefit page ${n}`, 30, 760, true),
    item("• Maximum Limit: $1,500", 30, 740),
    item("SAMPLE", 140, 740, true),
    item("For Inquiry Purposes Only", 30, 720, true),
    ...extra,
  ];
}

describe("repeated watermark text is removed from page text", () => {
  const pages = [1, 2, 3, 4, 5].map((n) => page(n));
  const out = removeRepeatedArtifacts(pages);
  it("glued and line watermarks are gone; content stays", () => {
    const t = text(out.items[2]);
    expect(t).toContain("• Maximum Limit: $1,500\n");
    expect(t).not.toContain("SAMPLE");
    expect(t).not.toContain("For Inquiry Purposes Only");
    expect(t).toContain("Benefit page 3");
  });
  it("removal is recorded per page as counts", () => {
    expect(out.removed).toEqual([1, 2, 3, 4, 5].map((p) => ({ page: p, count: 2 })));
  });
});

describe("never removed", () => {
  it("text on fewer than most pages", () => {
    const pages = [page(1), page(2), [item("Benefit page 3", 30, 760, true)], [item("Benefit page 4", 30, 760, true)], [item("Benefit page 5", 30, 760, true)]];
    expect(removeRepeatedArtifacts(pages).removed).toEqual([]);
  });
  it("a repeated item that carries a figure", () => {
    const pages = [1, 2, 3, 4].map((n) => [item(`Line ${n}`, 30, 760, true), item("Form 1234", 30, 740, true)]);
    expect(text(removeRepeatedArtifacts(pages).items[0])).toContain("Form 1234");
  });
  it("the plan title on page 1's first lines", () => {
    const pages = [1, 2, 3, 4].map((n) => [item("Example Health Plan", 30, 780, true), item(`Body ${n}`, 30, 760, true)]);
    const out = removeRepeatedArtifacts(pages);
    expect(text(out.items[0])).toContain("Example Health Plan");
  });
  it("text that is a table cell on its own", () => {
    const tablePage = (n: number) => [
      item("BENEFIT", 30, 760), item("ELITE", 200, 760), item("BASIC", 310, 760, true),
      item("Deductible", 30, 740), item("Covered", 200, 740), item("$250", 310, 740, true),
      item("Ambulance", 30, 720), item("Covered", 200, 720), item("$500", 310, 720, true),
      item("Maternity", 30, 700), item("Covered", 200, 700), item(`$${n}00`, 310, 700, true),
    ];
    const pages = [1, 2, 3, 4].map(tablePage);
    expect(text(removeRepeatedArtifacts(pages).items[1])).toContain("Covered");
  });
});
