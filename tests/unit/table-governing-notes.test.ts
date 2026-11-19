// Governing table notes: a table claim carries every footnote / preamble that
// governs it (verbatim, cited) or is not made.
//
// Real-PDF cases live in table-governing-notes-real.test.ts (REAL_FIXTURES_DIR;
// SKIPPED when absent, never PASS).
import { describe, expect, it } from "vitest";
import { tableClaims } from "@/app/lib/extraction/table-facts";
import { governingNotes, markersAccounted, namedProvisions } from "@/app/lib/extraction/table-notes";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import { tableDocument, type TablePageSpec } from "./helpers/table-doc";

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
    "Pre-certification\n• Interfacility Ambulance Transfer: Not covered unless Pre-certification\nis obtained in advance.\n• All other Treatments & supplies: 50% reduction.",
    "Ambulance: covered in full.\n• Ambulance Transfer: see page 9.",
  ];
  it("matches the exact name, case/spacing-insensitive, following wrapped lines to the sentence end", () => {
    expect(namedProvisions(pages, "interfacility  ambulance transfer")).toEqual([
      { page: 1, quote: "• Interfacility Ambulance Transfer: Not covered unless Pre-certification\nis obtained in advance." },
    ]);
  });
  it.each(["Ambulance", "Interfacility Ambulance", "Transfer", "Treatments & supplies"])("does not match a partial or different name: %s", (head) => {
    expect(namedProvisions(pages, head).filter((p) => p.page === 1 && p.quote.includes("Interfacility"))).toEqual([]);
  });
  it("a non-bulleted mention is not a provision", () => {
    expect(namedProvisions(pages, "Ambulance").map((p) => p.quote)).toEqual([]);
  });
});
