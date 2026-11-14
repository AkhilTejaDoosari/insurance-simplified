// Governing notes of a table claim: the section heading run above its row,
// footnotes reached through a marker, a preamble above the table header, and
// an unmarked general restriction note below the table on the same page.
//
// A table cell rarely states its whole provision. A marker on the cell, its
// row label, its column heading or its section heading ("EMERGENCY SERVICES
// AND ASSISTANCE*") points to a footnote that restricts it ("If you do not
// contact Seven Corners Assist, the benefit will be limited …"). A claim
// therefore either carries every note that governs it (verbatim, cited) or is
// not made. Rules:
//
//   scope       — a marker governs: on a cell → that cell; on a row label →
//                 the row; on a column heading → that column; on a section
//                 heading → every row of the section (up to the next heading);
//   resolution  — exactly ONE complete footnote block with that marker on the
//                 same page (layout-tables.ts footnotes). Missing, duplicated
//                 or incomplete ⇒ the claim is withheld;
//   exceptions  — a multi-row note that exempts something ("does not apply
//                 to X") must name a governed row exactly; otherwise its scope
//                 is unclear and every row it governs is withheld. The exempt
//                 row still carries the note: it states the exemption;
//   continuation— a table continued from the previous page (same column
//                 headings, no section heading above its first rows) is
//                 governed by that page's last section; when that section is
//                 marked, the rows are withheld;
//   audit       — independently of the reader's row model, every marker in the
//                 page text between the table's first and last read span must
//                 lie in a span the model accounts for (a read row, heading,
//                 section, preamble, footnote, or withheld text). An
//                 unaccounted marker withholds the whole table.

import { GOVERNS_TABLE, type LayoutTable, type LayoutText, type Span } from "@/app/lib/pdf/layout-tables";

export interface GoverningNote extends LayoutText {
  /** "*", "**", … ; absent for a preamble. */
  marker?: string;
  /** The note exempts this row from (part of) what it states. */
  exempt?: boolean;
}

const MARKER = /\*+|†+|‡+|§+/g;
const markersIn = (text: string) => [...new Set(text.match(MARKER) ?? [])];
const EXCEPTION = /\b(?:does\s+not\s+apply\s+to|do\s+not\s+apply\s+to|except(?:\s+for)?|excluding|other\s+than)\s+([^.;]+)/gi;
const key = (t: string) => t.toLowerCase().replace(/^the\s+/, "").replace(/\s+/g, " ").replace(/[.,;:\s]+$/, "").trim();
const sameSection = (a?: LayoutText, b?: LayoutText) => !!a && !!b && a.spans[0]?.start === b.spans[0]?.start;

function resolve(table: LayoutTable, marker: string): LayoutText | undefined {
  const found = (table.footnotes ?? []).filter((f) => f.marker === marker);
  return found.length === 1 && found[0].complete ? found[0] : undefined;
}

/** Rows a multi-row note governs, and whether its exceptions name them. */
function exemptRows(note: LayoutText, governed: readonly number[], table: LayoutTable): Set<number> | undefined {
  const exempt = new Set<number>();
  for (const m of note.text.matchAll(EXCEPTION)) {
    const target = key(m[1]);
    const hits = governed.filter((r) => key(table.rows[r].label.text) === target);
    if (hits.length !== 1) return undefined;
    exempt.add(hits[0]);
  }
  return exempt;
}

/** Independent marker audit over the page text the table covers. */
export function markersAccounted(table: LayoutTable, pageText: string): boolean {
  const owned: Span[] = [
    table.header,
    ...table.columns.flatMap((c) => c.spans),
    ...table.rows.flatMap((r) => [...r.label.spans, ...r.cells.flatMap((c) => c.spans), ...(r.section?.spans ?? [])]),
    ...(table.preamble?.spans ?? []),
    ...(table.postscript?.spans ?? []),
    ...(table.withheld ?? []),
  ];
  const notes = (table.footnotes ?? []).flatMap((f) => f.spans);
  const read = [...owned];
  const from = Math.min(...read.map((s) => s.start));
  const to = Math.max(...read.map((s) => s.end));
  const inside = (spans: readonly Span[], i: number) => spans.some((s) => s.start <= i && i < s.end);
  for (const m of pageText.slice(from, to).matchAll(MARKER)) {
    const at = from + (m.index ?? 0);
    if (!inside(owned, at) && !inside(notes, at)) return false;
  }
  return true;
}

/** The previous page's table this one continues, if any. */
function continued(table: LayoutTable, tables: readonly LayoutTable[]): LayoutTable | undefined {
  const prev = tables.filter((t) => t.page === table.page - 1).at(-1);
  const heads = (t: LayoutTable) => t.columns.map((c) => c.text.toLowerCase()).join("|");
  return prev && heads(prev) === heads(table) ? prev : undefined;
}

/**
 * Every note governing the cell (row, column) of `tables[index]`, in order
 * section → label → column heading → cell → preamble; `undefined` when a
 * governing note cannot be resolved (the claim must not be made).
 */
export function governingNotes(
  tables: readonly LayoutTable[],
  index: number,
  rowIndex: number,
  column: number,
  pageText: string,
): GoverningNote[] | undefined {
  const table = tables[index];
  const row = table?.rows[rowIndex];
  const cell = row?.cells.find((c) => c.columns.includes(column));
  if (!table || !row || !cell) return undefined;
  if (!markersAccounted(table, pageText)) return undefined;

  const notes: GoverningNote[] = [];
  const seen = new Set<string>();
  const add = (marker: string, governed: readonly number[]): boolean => {
    if (seen.has(marker)) return true;
    seen.add(marker);
    const note = resolve(table, marker);
    if (!note) return false;
    const exempt = governed.length > 1 ? exemptRows(note, governed, table) : new Set<number>();
    if (!exempt) return false;
    notes.push({ ...note, marker, ...(exempt.has(rowIndex) ? { exempt: true } : {}) });
    return true;
  };

  const allRows = table.rows.map((_, r) => r);
  const sectionRows = allRows.filter((r) => sameSection(table.rows[r].section, row.section));
  // A preamble that declares the whole table ("All benefits shown below")
  // governs every row; one that only states restrictions is the heading of
  // the rows before the first in-body section (IMG: "Subject to Deductible
  // unless otherwise noted"), superseded by a later section's own heading
  // ("NOT Subject to Deductible unless otherwise noted").
  const preamble = table.preamble;
  const tableWide = !!preamble && GOVERNS_TABLE.test(preamble.text);
  const prev = continued(table, tables);
  if (row.section) {
    notes.push({ ...row.section });
    for (const m of markersIn(row.section.text)) if (!add(m, sectionRows)) return undefined;
  } else if (preamble && !tableWide) {
    notes.push({ ...preamble });
    for (const m of markersIn(preamble.text)) if (!add(m, allRows.filter((r) => !table.rows[r].section))) return undefined;
  } else if (prev?.rows.at(-1)?.section || (prev?.preamble && !GOVERNS_TABLE.test(prev.preamble.text))) {
    // Rows above the first heading of a continued table belong to the
    // previous page's last section, which is not restated here.
    return undefined;
  }
  for (const m of markersIn(row.label.text)) if (!add(m, [rowIndex])) return undefined;
  for (const m of markersIn(table.columns[column]?.text ?? "")) if (!add(m, allRows)) return undefined;
  for (const m of markersIn(cell.text)) if (!add(m, [rowIndex])) return undefined;

  if (preamble && tableWide) {
    for (const m of markersIn(preamble.text)) if (!add(m, allRows)) return undefined;
    notes.push({ ...preamble });
  } else if (!preamble && prev?.preamble && GOVERNS_TABLE.test(prev.preamble.text)) {
    // The governing preamble is on the previous page: not restated here.
    return undefined;
  }
  if (table.postscriptAmbiguous) return undefined;
  if (table.postscript) {
    if (markersIn(table.postscript.text).length > 0) return undefined;
    notes.push({ ...table.postscript });
  }
  return notes;
}

/** A provision elsewhere in the document that names a row's benefit exactly. */
export interface NamedProvision {
  page: number;
  /** Verbatim page text of the provision (bullet through its sentence end). */
  quote: string;
}

const NAMED = /^[ \t]*[•·][ \t]*([^:\n]{3,80}?):[ \t]+\S/gm;

/**
 * Bulleted provisions anywhere in the document of the form
 * "• <Benefit name>: <rule>" whose name equals the row's benefit name
 * (`head`, the label's concept part) exactly, ignoring case and spacing —
 * e.g. IMG p3 "• Interfacility Ambulance Transfer: No coverage if
 * Pre-certification requirements are not met." governs that p6 row. A name
 * match is the only link: no proximity, no partial names. The provision
 * runs to its first sentence end that is followed by a new bullet, a line
 * end or the page end (wrapped lines are followed).
 */
export function namedProvisions(pages: readonly string[], head: string, exclude?: { page: number; spans: readonly Span[] }): NamedProvision[] {
  const want = key(head);
  if (!want) return [];
  const out: NamedProvision[] = [];
  pages.forEach((text, i) => {
    for (const m of text.matchAll(NAMED)) {
      if (key(m[1]) !== want) continue;
      const start = m.index ?? 0;
      if (exclude && exclude.page === i + 1 && exclude.spans.some((s) => s.start <= start + m[0].length && start < s.end)) continue;
      const rest = text.slice(start);
      const end = rest.search(/[.!?](?=[ \t]*(?:\n[ \t]*[•·]|\n[ \t]*\n|$))|\n[ \t]*[•·]/);
      const quote = (end < 0 ? rest : rest.slice(0, rest[end] === "\n" ? end : end + 1)).trim();
      out.push({ page: i + 1, quote });
    }
  });
  return out;
}
