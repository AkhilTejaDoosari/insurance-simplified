// M7 "honest reading" (agent C): per-page readability, honest absence,
// visible table-claim drops (review finding #2) and structural plan tiers
// (review finding #4). Synthetic text only.
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { assessPageReadability, classifyPage, readabilityFor, summarizeReadability } from "@/app/lib/pdf/page-readability";
import { pageCoverage } from "@/app/lib/ingestion/quality-gate";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { absenceFor, stripServerOnlyFields } from "@/app/lib/extraction/absence";
import { columnQualifiers, tableClaims } from "@/app/lib/extraction/table-facts";
import { tableDocument, type TablePageSpec, type TestDocument } from "./helpers/table-doc";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const LONG_TEXT = "Annual deductible: $500 per member per policy year for covered medical services in network.";

async function syntheticPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const png = await pdf.embedPng(PNG_1x1);
  const text = pdf.addPage([600, 800]);
  for (let i = 0; i < 4; i++) text.drawText(LONG_TEXT, { x: 20, y: 700 - i * 20, size: 9, font });
  pdf.addPage([600, 800]); // blank
  pdf.addPage([600, 800]).drawImage(png, { x: 0, y: 0, width: 600, height: 800 }); // image only
  const partly = pdf.addPage([600, 800]);
  partly.drawText("Schedule of Benefits", { x: 20, y: 760, size: 12, font });
  partly.drawImage(png, { x: 0, y: 0, width: 600, height: 700 }); // scanned insert
  return pdf.save();
}

describe("per-page readability record (task 1)", () => {
  it("extractPages records read, empty, image-only and partly read pages", async () => {
    const out = await extractPages(await syntheticPdf(), "synthetic.pdf");
    expect(out.readability.map((r) => r.status)).toEqual(["read", "empty", "unreadable", "partly-unreadable"]);
    expect(summarizeReadability(out.readability)).toEqual({ pagesRead: [1, 4], pagesNotRead: [2, 3], pagesPartlyRead: [4] });
  });

  it("the quality gate reports pages not read instead of passing on total characters alone", () => {
    const pages = [LONG_TEXT.repeat(3), "", "  \n "];
    expect(pageCoverage(pages)).toEqual({ pagesRead: [1], pagesNotRead: [2, 3], pagesPartlyRead: [], complete: false });
    expect(pageCoverage([LONG_TEXT]).complete).toBe(true);
  });

  it("classifies from text and image presence; unknown image presence never invents a status", () => {
    expect(classifyPage(1, "", true).status).toBe("unreadable");
    expect(classifyPage(1, "", false).status).toBe("empty");
    expect(classifyPage(1, "short", true).status).toBe("partly-unreadable");
    expect(classifyPage(1, "short").status).toBe("read");
    expect(assessPageReadability(["a", ""]).map((r) => r.status)).toEqual(["read", "empty"]);
  });

  it("a stored record cannot claim a text-less page was read", () => {
    const forged = [{ page: 1, status: "read" as const, textChars: 10 }, { page: 2, status: "read" as const, textChars: 10 }];
    expect(readabilityFor({ pages: ["text", ""], readability: forged }).map((r) => r.status)).toEqual(["read", "empty"]);
  });
});

const plainDoc = (documentId: string, pages: string[]) => ({ documentId, filename: `${documentId}.pdf`, pageCount: pages.length, pages });
const run = (docs: (TestDocument | ReturnType<typeof plainDoc>)[]): ComparisonTable =>
  verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);

describe("honest absence (task 2, EC-10)", () => {
  it("every NOT STATED row is 'not found in the pages read' and names the pages not read", () => {
    const docs = [plainDoc("d1", ["Annual deductible: $500 per policy year.", "", "Urgent care copay $25."])];
    const t = run(docs);
    expect(t.rows.find((r) => r.factName === "maternity-coverage")?.verdict).toBe("NOT STATED");
    expect(absenceFor(t, "maternity-coverage")).toEqual({
      reason: "not-found-in-pages-read",
      documents: [{ documentId: "d1", pagesRead: [1, 3], pagesNotRead: [2], pagesPartlyRead: [] }],
    });
    // One absence per NOT STATED row, none for stated rows.
    const notStated = t.rows.filter((r) => r.verdict === "NOT STATED").map((r) => r.factName);
    expect(t.coverage?.absences.map((a) => a.factName)).toEqual(notStated);
    expect(absenceFor(t, "annual-deductible")).toBeUndefined();
  });

  it("uses the upload's readability record (image pages) when the session carries one", () => {
    const docs = [{
      ...plainDoc("d1", ["Annual deductible: $500 per policy year.", "Benefits"]),
      readability: [
        { page: 1, status: "read" as const, textChars: 40 },
        { page: 2, status: "partly-unreadable" as const, textChars: 8, hasImages: true },
      ],
    }];
    expect(absenceFor(run(docs), "dental-coverage")?.documents[0]).toEqual({ documentId: "d1", pagesRead: [1, 2], pagesNotRead: [], pagesPartlyRead: [2] });
  });

  it("values dropped at the verification boundary are 'candidates withheld', not 'not found'", () => {
    const docs = [plainDoc("d1", ["Annual deductible: $500 per policy year."])];
    const table = validateTable(extractFallback(docs, {}));
    table.rows = table.rows.map((r) => (r.factName === "dental-coverage"
      ? { ...r, verdict: "SUPPORTED", values: [{ documentId: "d1", display: "Dental $50", qualifiers: {}, evidence: [{ documentId: "d1", page: 1, quote: "Dental cleanings $50" }] }] }
      : r));
    const t = verifyComparisonTable(table, docs);
    expect(t.rows.find((r) => r.factName === "dental-coverage")?.verdict).toBe("NOT STATED");
    expect(absenceFor(t, "dental-coverage")?.reason).toBe("candidates-withheld");
  });

  it("model-asserted coverage and withheld fields are discarded before use", () => {
    const raw = { rows: [{ factName: "x", verdict: "NOT STATED", values: [], withheld: [{}] }], coverage: { absences: [] } };
    expect(stripServerOnlyFields(raw)).toEqual({ rows: [{ factName: "x", verdict: "NOT STATED", values: [] }] });
  });

  it("the schema rejects an absence entry for a row that is not NOT STATED", () => {
    const table = extractFallback([plainDoc("d1", ["Annual deductible: $500 per policy year."])], {});
    expect(() => validateTable({ ...table, coverage: { documents: [], absences: [{ factName: "annual-deductible", reason: "not-found-in-pages-read" }] } }))
      .toThrow(/coverage absence/);
  });
});

// A section footnote marker with no footnote on the page: the governing
// context cannot be read, so the marked rows' table claims are withheld.
const unreadableNote: TablePageSpec = {
  headings: ["ELITE", "BASIC"],
  rows: [
    ["EMERGENCY SERVICES*", "", ""],
    ["Emergency Medical Evacuation", "$100,000", "$50,000"],
    ["Return of Mortal Remains", "$25,000", "$10,000"],
    ["OTHER BENEFITS", "", ""],
    ["Local Ambulance", "$1,000", "$500"],
    ["Urgent Care", "$50 copay", "$75 copay"],
  ],
};

describe("finding #2: a dropped table claim is visible, never a silent NOT STATED", () => {
  it("governing context unreadable → NEEDS VERIFICATION with the withheld source line", () => {
    const docs = [tableDocument("d1", [unreadableNote])];
    const row = run(docs).rows.find((r) => r.factName === "emergency-evacuation")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values).toEqual([]);
    expect(row.withheld).toEqual([expect.objectContaining({ documentId: "d1", page: 1, reason: "governing-context-unreadable" })]);
    expect(row.withheld![0].quote).toContain("Emergency Medical Evacuation");
    expect(docs[0].pages[0]).toContain(row.withheld![0].quote);
  });

  it("unmarked rows of the same table keep their verified claims", () => {
    const t = run([tableDocument("d1", [unreadableNote])]);
    const ambulance = t.rows.find((r) => r.factName === "ambulance")!;
    expect(ambulance.verdict).toBe("SUPPORTED");
    expect(ambulance.values.length).toBe(2);
    expect(ambulance.withheld).toBeUndefined();
  });

  it("a table line whose label names no fact is withheld for the fact its line mentions", () => {
    const spec: TablePageSpec = {
      headings: ["ELITE", "BASIC"],
      rows: [["Cleanings • dental only", "$50", "$25"], ["Local Ambulance", "$1,000", "$500"], ["Urgent Care", "$50 copay", "$75 copay"]],
    };
    const row = run([tableDocument("d1", [spec])]).rows.find((r) => r.factName === "dental-coverage")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.withheld?.map((w) => w.reason)).toEqual(["label-unrecognized"]);
  });

  it("another document's value does not hide this document's withheld line", () => {
    const docs = [tableDocument("d1", [unreadableNote]), plainDoc("d2", ["Emergency medical evacuation up to $200,000."])];
    const row = run(docs).rows.find((r) => r.factName === "emergency-evacuation")!;
    expect(row.values.map((v) => v.documentId)).toEqual(["d2"]);
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.withheld?.map((w) => w.documentId)).toEqual(["d1"]);
  });

  it("a NOT STATED row may not carry withheld lines", () => {
    const table = extractFallback([plainDoc("d1", ["Annual deductible: $500 per policy year."])], {});
    const row = table.rows.find((r) => r.factName === "dental-coverage")!;
    expect(() => validateTable({ ...table, coverage: undefined, rows: [{ ...row, withheld: [{ documentId: "d1", page: 1, quote: "Annual", reason: "label-unrecognized" }] }] }))
      .toThrow(/cannot be NOT STATED/);
  });
});

describe("finding #4: plan tier is stated by structure, not guessed from common words", () => {
  const premiumTable: TablePageSpec = {
    headings: ["Monthly Premium", "Annual Premium"],
    rows: [["Premium", "$100", "$1,200"], ["Local Ambulance", "$1,000", "$500"], ["Urgent Care", "$50 copay", "$75 copay"]],
  };

  it("'Monthly Premium' is a cost heading, never planTier 'Premium'", () => {
    expect(columnQualifiers("Monthly Premium")).toEqual({ conditions: "Monthly Premium" });
    const claims = tableClaims(tableDocument("d1", [premiumTable]));
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.some((c) => c.value.qualifiers.planTier !== undefined)).toBe(false);
    expect(claims.find((c) => c.factName === "premium")?.value.qualifiers).toEqual({ conditions: "Monthly Premium" });
  });

  it("a single common tier word among non-tier columns is not a tier", () => {
    const spec: TablePageSpec = {
      headings: ["Choice of Provider", "Limit"],
      rows: [["Local Ambulance", "$100", "$500"], ["Urgent Care", "$20 copay", "$75 copay"], ["Deductible", "$100", "$250"]],
    };
    const claims = tableClaims(tableDocument("d1", [spec]));
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.some((c) => c.value.qualifiers.planTier !== undefined)).toBe(false);
    expect(columnQualifiers("Choice of Provider", "Choice of Provider", ["Choice of Provider", "Limit"])).toEqual({ conditions: "Choice of Provider" });
  });

  it("genuine parallel tier columns keep their tiers", () => {
    const spec: TablePageSpec = {
      headings: ["Standard Option", "Basic Option"],
      rows: [["Deductible", "$350", "$0"], ["Local Ambulance", "$100", "$150"], ["Urgent Care", "$30 copay", "$40 copay"]],
    };
    const tiers = tableClaims(tableDocument("d1", [spec])).filter((c) => c.factName === "annual-deductible").map((c) => c.value.qualifiers.planTier);
    expect(tiers).toEqual(["Standard", "Basic"]);
  });
});
