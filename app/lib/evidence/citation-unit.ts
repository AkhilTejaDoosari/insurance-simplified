// Server-side citation completion (owner decision 2026-11-22 (4)). The model
// references passage lines; the server expands each citation to its complete
// evidence unit before verification, and that unit is what the user sees:
//   (a) prose: the whole sentence — the cited lines extended over the lines
//       they continue from and onto (the same continuation rules the
//       verifier applies), whole lines, so a same-line "LABEL:" prefix is
//       included;
//   (b) a table row: the row's label and cells and the column headings of
//       those cells (and the row's section heading), each as its own verbatim
//       citation from the SAME detected table.
// Every completed quote is a verbatim substring of its page. Completion
// never crosses a line that ends a sentence and never adds another row.
// Pure: reads only the documents passed in.

import { continuesOnto, lineEndsSentence } from "@/app/lib/evidence-verification";
import type { LayoutTable, LayoutText } from "@/app/lib/pdf/layout-tables";

export interface UnitCitation {
  documentId: string;
  page: number;
  quote: string;
}

interface UnitDocument {
  documentId: string;
  pages: string[];
  tables?: LayoutTable[];
}

const MAX_BACK = 4;
const MAX_FORWARD = 6;
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

/** The cited quote extended to the whole lines of its sentence; the quote
 *  unchanged when it cannot be placed on the page exactly once. */
export function completeProseQuote(page: string, quote: string): string {
  const lines = page.split("\n");
  const want = quote.split("\n").map(ws).filter(Boolean);
  if (want.length === 0) return quote;
  const norm = lines.map(ws);
  // Every placement of the quote's lines (first line may start mid-line,
  // last may end mid-line); completion applies only to a unique placement.
  const at: number[] = [];
  for (let i = 0; i + want.length <= norm.length; i++) {
    const ok = want.every((w, j) => {
      const l = norm[i + j];
      if (want.length === 1) return l.includes(w);
      if (j === 0) return l.endsWith(w);
      if (j === want.length - 1) return l.startsWith(w);
      return l === w;
    });
    if (ok) at.push(i);
  }
  if (at.length !== 1) return quote;
  let a = at[0];
  let b = at[0] + want.length - 1;
  for (let k = 0; k < MAX_BACK && a > 0 && norm[a - 1] && continuesOnto(norm[a - 1], norm[a], false, a > 1 ? norm[a - 2] : undefined); k++) a--;
  // Review nit: a line ending in a value followed by a line stating its own
  // amount is the next row ("Primary care $30" / "telehealth $10").
  const nextRow = (cur: string, next: string) => /[\d%]\s*$/.test(cur) && /\$\s?\d|\d\s?%/.test(next);
  for (let k = 0; k < MAX_FORWARD && b + 1 < norm.length && norm[b + 1] && !lineEndsSentence(norm[b]) && !nextRow(norm[b], norm[b + 1]) && continuesOnto(norm[b], norm[b + 1], true); k++) b++;
  return lines.slice(a, b + 1).join("\n").trim();
}

/** Review of 4ccd625 (S1): a citation must be unique on its page. A span
 *  whose text repeats ("$0", "Covered") is cited by its whole page line
 *  when that line is unique; otherwise it is not added. */
function textsOf(page: string, t: LayoutText | undefined): string[] {
  const unique = (q: string) => !!q && page.indexOf(q) >= 0 && page.indexOf(q) === page.lastIndexOf(q);
  return (t?.spans ?? []).flatMap((s) => {
    const text = page.slice(s.start, s.end).trim();
    if (unique(text)) return [text];
    const from = page.lastIndexOf("\n", s.start - 1) + 1;
    const to = page.indexOf("\n", s.start);
    const line = page.slice(from, to < 0 ? page.length : to).trim();
    return unique(line) ? [line] : [];
  });
}

/** Table rows a quote overlaps (by page-text span), with their headings. */
function rowCitations(doc: UnitDocument, pageNo: number, quote: string): string[] {
  const page = doc.pages[pageNo - 1];
  const tables = (doc.tables ?? []).filter((t) => t.page === pageNo);
  if (!page || tables.length === 0) return [];
  const start = page.indexOf(quote);
  if (start < 0 || page.indexOf(quote, start + 1) >= 0) return [];
  const end = start + quote.length;
  const hit = (t: LayoutText) => t.spans.some((s) => s.start < end && s.end > start);
  const out: string[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      if (!hit(row.label) && !row.cells.some(hit)) continue;
      out.push(...textsOf(page, row.section), ...textsOf(page, row.label));
      for (const cell of row.cells) {
        out.push(...textsOf(page, cell));
        for (const c of cell.columns) out.push(...textsOf(page, table.columns[c]));
      }
      // The header line itself (one contiguous span) carries every heading.
      const header = page.slice(table.header.start, table.header.end).trim();
      if (page.indexOf(header) === page.lastIndexOf(header)) out.push(header);
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** Every citation completed: prose to its sentence; table rows gain their
 *  row label, cells and column headings as further citations. Order: each
 *  completed citation, then the row citations it adds; duplicates dropped. */
export function completeCitations(documents: readonly UnitDocument[], citations: readonly UnitCitation[]): UnitCitation[] {
  const out: UnitCitation[] = [];
  const add = (c: UnitCitation) => {
    if (!out.some((x) => x.documentId === c.documentId && x.page === c.page && x.quote === c.quote)) out.push(c);
  };
  for (const c of citations) {
    const doc = documents.find((d) => d.documentId === c.documentId);
    const page = doc?.pages[c.page - 1];
    if (!doc || typeof page !== "string") { add(c); continue; }
    const rows = rowCitations(doc, c.page, c.quote);
    add({ ...c, quote: rows.length > 0 ? c.quote : completeProseQuote(page, c.quote) });
    for (const q of rows) add({ documentId: c.documentId, page: c.page, quote: q });
  }
  return out;
}
