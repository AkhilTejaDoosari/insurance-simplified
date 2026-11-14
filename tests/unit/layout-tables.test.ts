import { describe, expect, it } from "vitest";
import { detectTables, positionItems, type RawTextItem } from "@/app/lib/pdf/layout-tables";
import { tablePageItems, columnX } from "./helpers/table-doc";

const FS = 9;
const it_ = (str: string, x: number, y: number, hasEOL = false, w?: number): RawTextItem =>
  ({ str, transform: [FS, 0, 0, FS, x, y], width: w ?? str.length * 4.5, hasEOL });

function read(items: RawTextItem[]) {
  const { text, items: positioned } = positionItems(items);
  return { text, tables: detectTables(text, positioned, 1) };
}

describe("positionItems", () => {
  it("reproduces the page-text join and exact item offsets", () => {
    const items = [it_("Deductible", 30, 700), it_(" ", 80, 700), it_("$500", 200, 700, true), it_("Next", 30, 680, true)];
    const { text, items: positioned } = positionItems(items);
    expect(text).toBe("Deductible $500\nNext\n");
    for (const p of positioned) expect(text.slice(p.start, p.end)).toBe(p.str);
    expect(positioned.map((p) => p.str)).toEqual(["Deductible", "$500", "Next"]); // blanks skipped
  });
});

describe("detectTables — header-anchored tables", () => {
  const spec = {
    caption: "BENEFIT",
    headings: ["ELITE", "BASIC"],
    rows: [
      ["Deductible", "$0", "$250"],
      ["Maternity Care", "Up to $5,000", "No coverage"],
      ["Ambulance", "Up to $750", "Up to $500"],
    ] as [string, ...string[]][],
  };

  it("reads each row's label and the cell under each heading, with exact spans", () => {
    const { text, tables } = read(tablePageItems(spec));
    expect(tables).toHaveLength(1);
    const [t] = tables;
    expect(t.columns.map((c) => c.text)).toEqual(["ELITE", "BASIC"]);
    expect(t.rows.map((r) => [r.label.text, ...r.cells.map((c) => `${c.columns.join(",")}=${c.text}`)])).toEqual([
      ["Deductible", "0=$0", "1=$250"],
      ["Maternity Care", "0=Up to $5,000", "1=No coverage"],
      ["Ambulance", "0=Up to $750", "1=Up to $500"],
    ]);
    for (const row of t.rows) {
      for (const span of [...row.label.spans, ...row.cells.flatMap((c) => c.spans)]) {
        expect(row.label.text + row.cells.map((c) => c.text).join(" ")).toContain(text.slice(span.start, span.end));
      }
    }
  });

  it("keeps a negation cell verbatim under its own column only", () => {
    const { tables } = read(tablePageItems(spec));
    const maternity = tables[0].rows[1];
    expect(maternity.cells.find((c) => c.text === "No coverage")?.columns).toEqual([1]);
  });

  it("joins wrapped lines of one cell and of one label", () => {
    const items = [
      it_("BENEFIT", 30, 760), it_("ELITE", columnX(0), 760), it_("BASIC", columnX(1), 760, true),
      it_("Local Ambulance (Not", 30, 740, true), it_("subject to coinsurance)", 30, 729, true),
      it_("Up to $750 per injury", columnX(0), 740, true), it_("only when hospitalized", columnX(0), 729, true),
      it_("Up to $500", columnX(1), 740, true),
      it_("Deductible", 30, 710), it_("$0", columnX(0), 710), it_("$250", columnX(1), 710, true),
      it_("Copay", 30, 694), it_("$10", columnX(0), 694), it_("$20", columnX(1), 694, true),
    ];
    const { tables } = read(items);
    const row = tables[0].rows[0];
    expect(row.label.text).toBe("Local Ambulance (Not subject to coinsurance)");
    expect(row.cells.map((c) => c.text)).toEqual(["Up to $750 per injury only when hospitalized", "Up to $500"]);
  });

  it("a cell wider than its column covers the columns it overlaps (merged cell)", () => {
    const items = [
      it_("BENEFIT", 30, 760), it_("ELITE", columnX(0), 760), it_("SELECT", columnX(1), 760), it_("BASIC", columnX(2), 760, true),
      it_("Hospital Room", 30, 740), it_("Average semi-private room rate", columnX(0), 740, true, 190), it_("$100", columnX(2), 740, true),
      it_("Deductible", 30, 724), it_("$0", columnX(0), 724), it_("$0", columnX(1), 724), it_("$250", columnX(2), 724, true),
      it_("Copay", 30, 708), it_("$10", columnX(0), 708), it_("$20", columnX(1), 708), it_("$30", columnX(2), 708, true),
    ];
    const { tables } = read(items);
    expect(tables[0].rows[0].cells.map((c) => c.columns)).toEqual([[0, 1], [2]]);
  });

  it("never extends a narrow cell over an empty neighbouring column", () => {
    const items = [
      it_("BENEFIT", 30, 760), it_("ELITE", columnX(0), 760), it_("BASIC", columnX(1), 760, true),
      it_("ICU", 30, 740), it_("Up to max", columnX(0), 740, true),
      it_("Deductible", 30, 724), it_("$0", columnX(0), 724), it_("$250", columnX(1), 724, true),
      it_("Copay", 30, 708), it_("$10", columnX(0), 708), it_("$20", columnX(1), 708, true),
    ];
    const { tables } = read(items);
    expect(tables[0].rows[0].cells.map((c) => c.columns)).toEqual([[0]]);
  });

  it("drops a row whose values start in a later column (column identity would be guessed)", () => {
    const items = [
      it_("BENEFIT", 30, 760), it_("In-Network", columnX(0), 760), it_("Out-of-Network", columnX(1), 760, true),
      it_("Deductible", 30, 740), it_("$0", columnX(0), 740), it_("$250", columnX(1), 740, true),
      it_("Copayment per visit", 30, 724), it_("$5", columnX(1), 724, true),
      it_("Copay", 30, 708), it_("$10", columnX(0), 708), it_("$20", columnX(1), 708, true),
      it_("Coinsurance", 30, 692), it_("90%", columnX(0), 692), it_("80%", columnX(1), 692, true),
    ];
    const { tables } = read(items);
    expect(tables[0].rows.map((r) => r.label.text)).toEqual(["Deductible", "Copay", "Coinsurance"]);
  });

  it("drops a row where two runs sit far apart inside one column zone", () => {
    const items = [
      it_("BENEFIT", 30, 760), it_("Loss", columnX(0), 760), it_("Percent", columnX(1) + 60, 760, true),
      it_("Surgery", 30, 740), it_("90%", columnX(0), 740), it_("80%", columnX(0) + 90, 740), it_("100%", columnX(1) + 60, 740, true),
      it_("Copay", 30, 724), it_("$10", columnX(0), 724), it_("$20", columnX(1) + 60, 724, true),
      it_("Lab", 30, 708), it_("$1", columnX(0), 708), it_("$2", columnX(1) + 60, 708, true),
      it_("X-ray", 30, 692), it_("$3", columnX(0), 692), it_("$4", columnX(1) + 60, 692, true),
    ];
    const { tables } = read(items);
    expect(tables[0].rows.map((r) => r.label.text)).not.toContain("Surgery");
  });

  it("rejects repeated headings (a sub-label in every cell is not a header)", () => {
    const items = [
      it_("Coinsurance", 30, 760), it_("In PPO Network", columnX(0), 760), it_("In PPO Network", columnX(1), 760, true),
      it_("Inside US", 30, 744), it_("We pay 100%", columnX(0), 744), it_("We pay 100%", columnX(1), 744, true),
      it_("Outside US", 30, 728), it_("We pay 80%", columnX(0), 728), it_("We pay 90%", columnX(1), 728, true),
      it_("Abroad", 30, 712), it_("We pay 70%", columnX(0), 712), it_("We pay 60%", columnX(1), 712, true),
    ];
    expect(read(items).tables).toEqual([]);
  });

  it("finds no table in prose or in a lowercase-wrapped two-column layout", () => {
    const items = [
      it_("Plan overview text that runs across the page width.", 30, 760, true, 400),
      it_("travel and medical assistance", 30, 744), it_("emergency travel arrangements", columnX(1), 744, true),
      it_("services for members", 30, 728), it_("and translation", columnX(1), 728, true),
      it_("available all year", 30, 712), it_("assistance", columnX(1), 712, true),
    ];
    expect(read(items).tables).toEqual([]);
  });

  it("marks rows next to an unplaceable cell incomplete instead of losing its qualifier silently", () => {
    const items = [
      it_("BENEFIT", 30, 760), it_("ELITE", columnX(0), 760), it_("BASIC", columnX(1), 760, true),
      it_("Deductible", 30, 740), it_("$0", columnX(0), 740), it_("$250", columnX(1), 740, true),
      it_("Preventive", 30, 724), it_("Up to $200", columnX(0), 724), it_("No coverage", columnX(1), 724, true),
      // A detached continuation far below any label: whose qualifier is it?
      it_("after 6 months", columnX(0), 700, true),
      it_("Copay", 30, 670), it_("$10", columnX(0), 670), it_("$20", columnX(1), 670, true),
      it_("Lab", 30, 654), it_("$1", columnX(0), 654), it_("$2", columnX(1), 654, true),
    ];
    const labels = read(items).tables[0]?.rows.map((r) => r.label.text) ?? [];
    expect(labels).not.toContain("Preventive");
    expect(labels).not.toContain("Copay");
    expect(labels).toContain("Deductible");
  });

  const rot = (str: string, x: number, y: number): RawTextItem => ({ str, transform: [30, 30, -30, 30, x, y], width: 190, hasEOL: true });
  const grid = (extra: RawTextItem[]) => [
    it_("BENEFIT", 30, 760), it_("ELITE", columnX(0), 760), it_("BASIC", columnX(1), 760, true),
    it_("Deductible", 30, 740), it_("$0", columnX(0), 740), it_("$250", columnX(1), 740, true),
    ...extra,
    it_("Copay", 30, 600), it_("$10", columnX(0), 600), it_("$20", columnX(1), 600, true),
    it_("Lab", 30, 584), it_("$1", columnX(0), 584), it_("$2", columnX(1), 584, true),
  ];

  it("keeps bullet paragraphs of one label together across paragraph spacing", () => {
    const { tables } = read(grid([
      it_("Urgent Care", 30, 720, true),
      it_("• Copayment: $50", 30, 705), it_("90%", columnX(0), 705), it_("80%", columnX(1), 705, true),
      it_("• Waived if deductible is $0", 30, 688, true),
      it_("states otherwise", 30, 678, true),
    ]));
    const row = tables[0].rows.find((r) => r.label.text.startsWith("Urgent Care"));
    expect(row?.label.text).toBe("Urgent Care • Copayment: $50 • Waived if deductible is $0 states otherwise");
  });

  it("ignores a rotated watermark crossing a label line", () => {
    const { tables } = read(grid([
      it_("Reunion", 30, 720, true),
      it_("• Maximum $15,000", 30, 705), it_("100%", columnX(0), 705), it_("100%", columnX(1), 705, true),
      it_("• Reasonable travel costs and", 30, 690), rot("SAMPLE", 130, 690),
      it_("accommodations", 30, 680, true),
    ]));
    expect(tables[0].rows.find((r) => r.label.text.startsWith("Reunion"))?.label.text)
      .toBe("Reunion • Maximum $15,000 • Reasonable travel costs and accommodations");
  });

  it("withholds a row whose continuation line it cannot read (spans into the value columns)", () => {
    const { tables } = read(grid([
      it_("Ambulance Transfer", 30, 720, true),
      it_("• Up to the limit", 30, 705), it_("100%", columnX(0), 705), it_("100%", columnX(1), 705, true),
      it_("• Transfer must follow an inpatient admission to a hospital in network", 30, 690, true, 300),
    ]));
    expect(tables[0].rows.map((r) => r.label.text)).not.toContain("Ambulance Transfer • Up to the limit");
    expect(tables[0].rows.some((r) => r.label.text.startsWith("Ambulance Transfer"))).toBe(false);
  });

  it("withholds a row followed by an orphan continuation block it could not attach", () => {
    const { tables } = read(grid([
      it_("Evacuation", 30, 720, true),
      it_("• Maximum $50,000", 30, 705), it_("100%", columnX(0), 705), it_("100%", columnX(1), 705, true),
      // A continuation bullet farther than paragraph spacing allows.
      it_("• Must be approved in advance", 30, 670, true),
    ]));
    expect(tables[0].rows.some((r) => r.label.text.startsWith("Evacuation"))).toBe(false);
  });
});
