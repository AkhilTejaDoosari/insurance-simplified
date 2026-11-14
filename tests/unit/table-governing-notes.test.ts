// Governing table notes: a table claim carries every footnote / preamble that
// governs it (verbatim, cited) or is not made.
//
// Real-PDF cases use Seven Corners p2–p3 (licensed, git-ignored; SKIPPED when
// absent, never PASS). Their gold provisions below were written by hand from
// the source PDF text, not from the parser's output.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type CellValue, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { tableClaims, verifyTableAnchor } from "@/app/lib/extraction/table-facts";
import { governingNotes, markersAccounted, namedProvisions } from "@/app/lib/extraction/table-notes";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import { tableDocument, type TablePageSpec } from "./helpers/table-doc";

// ------------------------------------------------------------------ gold
const ASSIST_NOTE =
  "*Arrangement of the above benefits are not insurance and are handled by Seven Corners Assist. If you do not contact " +
  "Seven Corners Assist, the benefit will be limited to the amount we would have paid if Seven Corners Assist was utilized. " +
  "This requirement to use Seven Corners Assist does not apply to Return of Mortal Remains or Local Burial/Cremation.";
const URC_NOTE =
  "*URC means Usual, Reasonable, and Customary. It is the maximum amount we will pay for covered expenses based on several " +
  "factors. See the definition in the plan document for more details.";
const SCHEDULE_NOTE =
  "SCHEDULE OF BENEFITS All benefits shown below are in United States dollar amounts. All medical and dental benefits are " +
  "subject to deductible and/or copay and coinsurance. Unless otherwise stated, all benefits are per person, per period of " +
  "coverage, and they are provided up to the amount shown. You have 180 days to receive treatment from the date of an injury " +
  "or illness, and your initial treatment must occur within 30 days of the date of injury or illness.";
const BASIC = "Travel Medical Basic Reliable Coverage";
const CHOICE = "Travel Medical Choice Most popular";
const SECTION_ROWS = [
  ["Emergency Medical Evacuation & Repatriation", "$250,000 (separate from medical maximum)", "$500,000 (separate from medical maximum)"],
  ["Emergency Medical Reunion", "$2,000", "$2,000"],
  ["Return of Child(ren)", "$25,000", "$50,000"],
  ["Return of Mortal Remains or Local Burial/Cremation", "$25,000", "$50,000"],
  ["Natural Disaster Evacuation & Repatriation", "$25,000", "$25,000"],
] as const;
const UNMARKED_P3 = ["Trip Interruption", "Loss of Checked Baggage", "Teladoc Virtual Medical Care", "Personal Liability", "Adventure Activities"];

const FILE = "nonstandard/04_seven_corners_travel_medical_usa.pdf";
const available = existsSync(FILE);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe.skipIf(!available)("Seven Corners p3: EMERGENCY SERVICES AND ASSISTANCE* governs its section", () => {
  let doc: Awaited<ReturnType<typeof extractPages>> & { documentId: string; filename: string };
  let table: ComparisonTable;
  beforeAll(async () => {
    doc = { documentId: "doc-3", filename: basename(FILE), ...(await extractPages(new Uint8Array(readFileSync(FILE)), basename(FILE))) };
    table = verifyComparisonTable(validateTable(extractFallback([doc], {})), [doc]);
  }, 60_000);
  const attributed = (fact: string) => table.rows.find((r) => r.factName === fact)?.values.filter((v) => v.planId) ?? [];
  const all = () => table.rows.flatMap((r) => r.values.filter((v) => v.planId));
  const byLabel = (label: string) => all().filter((v) => v.display.startsWith(`${label} (`));

  it.each([
    ["emergency-evacuation", BASIC, "Basic", "$250,000 (separate from medical maximum)"],
    ["emergency-evacuation", CHOICE, "Choice", "$500,000 (separate from medical maximum)"],
    ["repatriation", BASIC, "Basic", "$250,000 (separate from medical maximum)"],
    ["repatriation", CHOICE, "Choice", "$500,000 (separate from medical maximum)"],
  ])("Emergency Medical Evacuation & Repatriation — %s, %s: value, tier, contact-Assist restriction, schedule note, evidence", (fact, heading, tier, cell) => {
    const v = attributed(fact).filter((x) => x.display.startsWith("Emergency Medical Evacuation & Repatriation") && x.qualifiers.planTier === tier);
    expect(v).toHaveLength(1);
    const [head, ...notes] = v[0].display.split("\n");
    expect(head).toBe(`Emergency Medical Evacuation & Repatriation (${heading}): ${cell}`);
    expect(notes.map(squash)).toEqual(["EMERGENCY SERVICES AND ASSISTANCE*", ASSIST_NOTE, SCHEDULE_NOTE]);
    const cited = v[0].evidence.map((e) => squash(e.quote));
    expect(cited).toContain(ASSIST_NOTE);
    expect(cited).toContain(SCHEDULE_NOTE);
    expect(v[0].evidence.every((e) => e.page === 3)).toBe(true);
  });

  it("every row of the section that yields a claim carries the restriction, in both tiers", () => {
    // Emergency Medical Reunion and Return of Child(ren) map to no fact in
    // the fact list: no claim is made for them at all.
    expect(byLabel("Emergency Medical Reunion")).toEqual([]);
    expect(byLabel("Return of Child(ren)")).toEqual([]);
    for (const [label, basic, choice] of SECTION_ROWS.filter(([l]) => !/Reunion|Child/.test(l))) {
      const v = byLabel(label);
      expect(v.length, label).toBeGreaterThanOrEqual(2);
      for (const x of v) expect(x.display.split("\n").map(squash), label).toContain(ASSIST_NOTE);
      expect(v.map((x) => x.display.split("\n")[0])).toEqual(expect.arrayContaining([`${label} (${BASIC}): ${basic}`, `${label} (${CHOICE}): ${choice}`]));
    }
  });

  it("Return of Mortal Remains / Local Burial is the named exception: marked exempt, note shown with its exemption", () => {
    const t = doc.tables!.findIndex((x) => x.page === 3);
    const r = doc.tables![t].rows.findIndex((row) => row.label.text === "Return of Mortal Remains or Local Burial/Cremation");
    const evac = doc.tables![t].rows.findIndex((row) => row.label.text.startsWith("Emergency Medical Evacuation"));
    const notesFor = (row: number) => governingNotes(doc.tables!, t, row, 0, doc.pages[2])!;
    expect(notesFor(r).find((n) => n.marker === "*")?.exempt).toBe(true);
    expect(notesFor(evac).find((n) => n.marker === "*")?.exempt).toBeUndefined();
    // The exemption sentence is part of what the exempt row shows: the
    // contact requirement is never presented as applying to it unqualified.
    for (const v of byLabel("Return of Mortal Remains or Local Burial/Cremation")) {
      expect(v.display).toMatch(/This requirement to use Seven Corners Assist does not apply to Return of Mortal Remains or Local Burial\/Cremation\./);
    }
  });

  it("unmarked rows in later sections do not get the restriction", () => {
    for (const label of UNMARKED_P3) for (const v of byLabel(label)) expect(v.display, label).not.toMatch(/Seven Corners Assist/);
    // nor do p2 rows (a different page's "*" is a different footnote)
    for (const v of all().filter((x) => x.evidence[0].page === 2)) expect(v.display).not.toMatch(/Seven Corners Assist/);
  });

  it("a cell marker (URC*) carries its own footnote; the unmarked cell beside it does not", () => {
    const rx = attributed("hospitalization").filter((v) => v.display.startsWith("Hospital Room and Board"));
    const basic = rx.find((v) => v.qualifiers.planTier === "Basic")!;
    const choice = rx.find((v) => v.qualifiers.planTier === "Choice")!;
    expect(basic.display.split("\n").map(squash)).toEqual([`Hospital Room and Board, Inpatient & Outpatient Medical Expenses, Prescription Drugs (${BASIC}): URC* to medical maximum`, "PROTECT YOUR HEALTH", URC_NOTE, SCHEDULE_NOTE]);
    expect(choice.display.split("\n").map(squash)).toEqual([`Hospital Room and Board, Inpatient & Outpatient Medical Expenses, Prescription Drugs (${CHOICE}): URC to medical maximum`, "PROTECT YOUR HEALTH", SCHEDULE_NOTE]);
  });

  it("no attributed Seven Corners claim shows a marker without its footnote", () => {
    for (const v of all()) {
      const [head, ...notes] = v.display.split("\n");
      for (const m of head.match(/\*+/g) ?? []) expect(notes.some((n) => n.startsWith(m) && !n.startsWith(m + "*")), head).toBe(true);
    }
  });

  it("the '**' pre-existing footnote is interleaved with other text (incomplete): nothing it governs is attributed", () => {
    expect(all().some((v) => /Pre-Existing Conditions\*\*/.test(v.display))).toBe(false);
  });

  it("a claim stripped of its note does not re-verify", () => {
    const v = attributed("emergency-evacuation")[0];
    const stripped: CellValue = { ...v, display: v.display.split("\n")[0], evidence: v.evidence.slice(0, 2) };
    expect(verifyTableAnchor("emergency-evacuation", v, [doc])).toBe(true);
    expect(verifyTableAnchor("emergency-evacuation", stripped, [doc])).toBe(false);
  });
});

// ---------------------------------------------------------------- synthetic
const NOTE = "*If you do not call the assistance line first, the benefit is limited to $500.";
const spec = (trailer: string[], section = "EMERGENCY SERVICES*"): TablePageSpec => ({
  headings: ["ELITE", "BASIC"],
  rows: [
    [section, "", ""],
    ["Emergency Medical Evacuation", "$100,000", "$50,000"],
    ["Return of Mortal Remains", "$25,000", "$10,000"],
    ["OTHER BENEFITS", "", ""],
    ["Local Ambulance", "$1,000", "$500"],
    ["Emergency Room Services", "$100 copay", "$200 copay"],
  ],
  trailer,
});
const claimsOf = (s: TablePageSpec) => tableClaims(tableDocument("d", [s]));
const labels = (s: TablePageSpec) => [...new Set(claimsOf(s).map((c) => c.value.display.split(" (")[0]))];

describe("governing notes (synthetic layout through the production reader)", () => {
  it("a resolved section footnote is carried, verbatim and cited, by every row of its section only", () => {
    const c = claimsOf(spec([NOTE]));
    const evac = c.filter((x) => x.value.display.startsWith("Emergency Medical Evacuation"));
    expect(evac.length).toBeGreaterThan(0);
    for (const x of evac) {
      expect(x.value.display.split("\n").slice(1)).toEqual(["EMERGENCY SERVICES*", NOTE]);
      expect(x.value.evidence.some((e) => e.quote.includes("call the assistance line first"))).toBe(true);
    }
    for (const x of c.filter((y) => /^(Local Ambulance|Emergency Room)/.test(y.value.display))) expect(x.value.display).not.toContain("assistance line");
  });

  it.each([
    ["missing footnote", []],
    ["duplicate footnote", [NOTE, "Other text here.", "*A second, different note with the same marker."]],
    ["unreadable footnote (no sentence end)", ["*If you do not call the assistance line first, the benefit is"]],
    ["footnote ending in an unread list", ["*The benefit is limited when any of the following apply:"]],
    ["exception naming no governed row", [NOTE, "This does not apply to Pet Transport."]],
  ])("%s → the marked section is withheld, unmarked rows are kept", (_l, trailer) => {
    const l = labels(spec(trailer as string[]));
    expect(l).not.toContain("Emergency Medical Evacuation");
    expect(l).not.toContain("Return of Mortal Remains");
    expect(l).toEqual(expect.arrayContaining(["Local Ambulance", "Emergency Room Services"]));
  });

  it("an exception that names a governed row exactly marks that row exempt and keeps the others governed", () => {
    const doc = tableDocument("d", [spec([`${NOTE.slice(0, -1)}. This requirement does not apply to Return of Mortal Remains.`])]);
    const rowOf = (label: string) => doc.tables[0].rows.findIndex((r) => r.label.text === label);
    const star = (label: string) => governingNotes(doc.tables, 0, rowOf(label), 0, doc.pages[0])!.find((n) => n.marker === "*")!;
    expect(star("Return of Mortal Remains").exempt).toBe(true);
    expect(star("Emergency Medical Evacuation").exempt).toBeUndefined();
  });

  it("a marker on a row label governs that row only", () => {
    const s: TablePageSpec = { ...spec([NOTE], "EMERGENCY SERVICES"), rows: spec([], "EMERGENCY SERVICES").rows.map((r) => (r[0] === "Local Ambulance" ? ["Local Ambulance*", "$1,000", "$500"] : r)) as TablePageSpec["rows"] };
    const c = claimsOf(s);
    expect(c.filter((x) => x.value.display.startsWith("Local Ambulance*")).every((x) => x.value.display.endsWith(NOTE))).toBe(true);
    expect(c.filter((x) => !x.value.display.startsWith("Local Ambulance*")).some((x) => x.value.display.includes(NOTE))).toBe(false);
  });

  it("the marker audit fails closed on a marker the reader's model does not account for", () => {
    const doc = tableDocument("d", [spec([NOTE])]);
    const t = doc.tables[0];
    expect(markersAccounted(t, doc.pages[0])).toBe(true);
    // Forget the section headings: the "*" between rows is now unaccounted.
    const forgetful: LayoutTable = { ...t, rows: t.rows.map(({ section: _s, ...r }) => r) };
    expect(markersAccounted(forgetful, doc.pages[0])).toBe(false);
    expect(governingNotes([forgetful], 0, 0, 0, doc.pages[0])).toBeUndefined();
  });

  it("a table continued from a page whose last section is marked is withheld until its own heading", () => {
    const cont: TablePageSpec = { headings: ["ELITE", "BASIC"], rows: [["Emergency Medical Reunion", "$2,000", "$1,000"], ["Emergency Room Visit", "$50 copay", "$75 copay"], ["Ambulance Transport", "$300", "$200"]] };
    const first: TablePageSpec = { headings: ["ELITE", "BASIC"], rows: [["EMERGENCY SERVICES*", "", ""], ["Emergency Medical Evacuation", "$100,000", "$50,000"], ["Return of Mortal Remains", "$25,000", "$10,000"], ["Local Ambulance", "$1,000", "$500"]], trailer: [NOTE] };
    const doc = tableDocument("d", [first, cont]);
    expect(doc.tables.map((t) => t.page)).toEqual([1, 2]);
    expect(tableClaims(doc).filter((c) => c.value.anchor?.kind === "table-cell" && c.value.anchor.page === 2)).toEqual([]);
    // An unmarked section heading on the previous page also governs the
    // continued rows and is not restated: withheld. With no section heading
    // at all, the continued rows are read.
    const titled = tableDocument("d", [{ ...first, rows: first.rows.map((r) => (r[0] === "EMERGENCY SERVICES*" ? ["EMERGENCY SERVICES", "", ""] : r)) as TablePageSpec["rows"], trailer: [] }, cont]);
    expect(tableClaims(titled).filter((c) => c.value.anchor?.kind === "table-cell" && c.value.anchor.page === 2)).toEqual([]);
    const plain = tableDocument("d", [{ ...first, rows: first.rows.filter((r) => r[0] !== "EMERGENCY SERVICES*"), trailer: [] }, cont]);
    expect(tableClaims(plain).some((c) => c.value.anchor?.kind === "table-cell" && c.value.anchor.page === 2)).toBe(true);
  });
});

describe("named provisions: exact benefit-name cross-references only", () => {
  const pages = [
    "Pre-certification\n• Interfacility Ambulance Transfer: No coverage if Pre-certification\nrequirements are not met.\n• All other Treatments & supplies: 50% reduction.",
    "Ambulance: covered in full.\n• Ambulance Transfer: see page 9.",
  ];
  it("matches the exact name, case/spacing-insensitive, following wrapped lines to the sentence end", () => {
    expect(namedProvisions(pages, "interfacility  ambulance transfer")).toEqual([
      { page: 1, quote: "• Interfacility Ambulance Transfer: No coverage if Pre-certification\nrequirements are not met." },
    ]);
  });
  it.each(["Ambulance", "Interfacility Ambulance", "Transfer", "Treatments & supplies"])("does not match a partial or different name: %s", (head) => {
    expect(namedProvisions(pages, head).filter((p) => p.page === 1 && p.quote.includes("Interfacility"))).toEqual([]);
  });
  it("a non-bulleted mention is not a provision", () => {
    expect(namedProvisions(pages, "Ambulance").map((p) => p.quote)).toEqual([]);
  });
});
