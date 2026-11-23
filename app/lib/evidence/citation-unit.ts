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

import { continuesOnto, isTopicHeading, isUniqueOnPage, lineEndsSentence } from "@/app/lib/evidence-verification";
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
  // Review of ca46603 (S2): unique as the verifier judges it.
  const unique = (q: string) => !!q && isUniqueOnPage(page, q);
  return (t?.spans ?? []).flatMap((s) => {
    const text = page.slice(s.start, s.end).trim();
    if (unique(text)) return [text];
    const from = page.lastIndexOf("\n", s.start - 1) + 1;
    const to = page.indexOf("\n", s.start);
    const line = page.slice(from, to < 0 ? page.length : to).trim();
    return unique(line) ? [line] : [];
  });
}

type LayoutRow = LayoutTable["rows"][number];

/** Owner decision 2026-11-22 (7): a row whose label or cells cannot be cited
 *  piece by piece is cited by ONE contiguous verbatim span of its page — the
 *  row from its first piece through its last cell. Review of ca46603 (B1):
 *  between the row's own pieces there may be only whitespace — no other row,
 *  section heading, column header or footnote (never across rows). When that
 *  span is not unique on the page as the verifier judges it (the same row
 *  under two sections), or the row's section heading is not citable on its
 *  own, the span starts at the row's section heading instead, again with only
 *  whitespace between the heading and the row — so only the first row under
 *  a heading can use it; a heading placed after the row's first piece is not
 *  used. Otherwise undefined (the caller fails closed). A piece with no page
 *  spans is never covered (S1). `withSection` says the section is inside. */
function rowSpanCitation(page: string, row: LayoutRow, sectionCitable: boolean): { quote: string; withSection: boolean } | undefined {
  const pieces = [row.label, ...row.cells];
  if (pieces.some((p) => p.spans.length === 0)) return undefined;
  const own = pieces.flatMap((t) => t.spans);
  const first = Math.min(...own.map((s) => s.start));
  const end = Math.max(...own.map((s) => s.end));
  const quoteFrom = (from: number, spans: { start: number; end: number }[]) => {
    let rest = "";
    let cur = from;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      if (s.start > cur) rest += page.slice(cur, s.start);
      cur = Math.max(cur, s.end);
    }
    if (cur < end) rest += page.slice(cur, end);
    if (rest.trim()) return undefined;
    const quote = page.slice(from, end).trim();
    return quote && isUniqueOnPage(page, quote) ? quote : undefined;
  };
  const plain = quoteFrom(first, own);
  if (plain && (!row.section || sectionCitable)) return { quote: plain, withSection: false };
  if (!row.section?.spans.length) return undefined;
  const sectionStart = Math.min(...row.section.spans.map((s) => s.start));
  if (sectionStart > first) return undefined;
  const withSection = quoteFrom(sectionStart, [...own, ...row.section.spans]);
  return withSection ? { quote: withSection, withSection: true } : undefined;
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

/** Owner decision 2026-11-22 (5) rule 2: server-rendered table answers. When
 *  a model citation completes to a table row (its quote overlaps a row's
 *  label or cells), the model has only SELECTED that row: the server writes
 *  each of its cells as "<row label> (<column header>): <cell>", plus the
 *  row's governing footnotes, from the row's own spans — never the model's
 *  wording. Every piece is cited verbatim (unique on its page, or by its
 *  unique row line; a label, cell or section that is neither is cited by the
 *  row's own span — decision (7), `rowSpanCitation`); a piece that cannot be
 *  cited fails the whole answer
 *  closed (undefined result → the caller treats it as not answerable here).
 *  Returns undefined when no citation touches a table. */
export function renderTableAnswer(
  documents: readonly UnitDocument[],
  citations: readonly UnitCitation[],
): { answerText: string; citations: UnitCitation[] } | undefined | "uncitable" | "mixed" {
  const lines: string[] = [];
  const cites: UnitCitation[] = [];
  const cite = (documentId: string, page: number, quote: string) => {
    if (!cites.some((c) => c.documentId === documentId && c.page === page && c.quote === quote)) cites.push({ documentId, page, quote });
  };
  let touched = false;
  let prose = false;
  for (const c of citations) {
    const doc = documents.find((d) => d.documentId === c.documentId);
    const page = doc?.pages[c.page - 1];
    if (!doc || typeof page !== "string") continue;
    const start = page.indexOf(c.quote);
    if (start < 0 || page.indexOf(c.quote, start + 1) >= 0) continue;
    const end = start + c.quote.length;
    let inTable = false;
    const pageTables = (doc.tables ?? []).filter((t) => t.page === c.page);
    for (const table of pageTables) {
      const hit = (t: LayoutText) => t.spans.some((s) => s.start < end && s.end > start);
      for (const row of table.rows) {
        if (!hit(row.label) && !row.cells.some(hit)) continue;
        touched = true;
        inTable = true;
        const label = ws(row.label.text);
        // Review R2-a: the row's section heading ("OUT-OF-NETWORK SERVICES")
        // is part of what the row means.
        const section = row.section ? ws(row.section.text) : "";
        if (!label || (row.section && !section)) return "uncitable";
        let labelCites = textsOf(page, row.label);
        let sectionCites = row.section ? textsOf(page, row.section) : [];
        const pieceCites = row.cells.map((cell) => textsOf(page, cell));
        // Decision (7): a piece that cannot be cited on its own — not every
        // one of its spans (review S3) — is cited by the row's span (or
        // section-through-row span); the rendered answer is unchanged.
        const partial = (t: LayoutText, cites: string[]) => cites.length < t.spans.length;
        let span: string[] = [];
        const sectionMissing = !!row.section && partial(row.section, sectionCites);
        const cellMissing = row.cells.map((cell, i) => partial(cell, pieceCites[i]));
        if (partial(row.label, labelCites) || sectionMissing || cellMissing.some(Boolean)) {
          const unit = rowSpanCitation(page, row, !sectionMissing);
          if (!unit) return "uncitable";
          span = [unit.quote];
          if (partial(row.label, labelCites)) labelCites = span;
          if (unit.withSection) sectionCites = span;
        }
        const head = section ? `${label} — ${section}` : label;
        for (const [i, cell] of row.cells.entries()) {
          const header = cell.columns.map((k) => ws(table.columns[k]?.text ?? "")).filter(Boolean).join(" / ");
          const cellText = ws(cell.text);
          const cellCites = cellMissing[i] ? span : pieceCites[i];
          const headerCites = cell.columns.flatMap((k) => textsOf(page, table.columns[k]));
          if (!header || !cellText || cellCites.length === 0 || headerCites.length === 0) return "uncitable";
          const line = `${head} (${header}): ${cellText}`;
          if (!lines.includes(line)) lines.push(line);
          for (const q of [...labelCites, ...sectionCites, ...headerCites, ...cellCites]) cite(c.documentId, c.page, q);
        }
        // Review R2-b/c: every footnote marker on the row label, a cell, a
        // cell's column heading or the section — anywhere in the text — must
        // resolve to a complete footnote with EXACTLY that marker ("*" is not
        // "**"); otherwise the row cannot be rendered.
        const markedTexts = [row.label.text, row.section?.text ?? "", ...row.cells.map((x) => x.text), ...row.cells.flatMap((x) => x.columns.map((k) => table.columns[k]?.text ?? ""))];
        const markers = new Set(markedTexts.flatMap((t) => t.match(/\*+|†+|‡+/g) ?? []));
        for (const m of markers) {
          const note = (table.footnotes ?? []).find((n) => n.marker === m);
          const noteCites = note ? textsOf(page, note) : [];
          if (!note || !note.complete || noteCites.length === 0) return "uncitable";
          const text = ws(note.text);
          if (!lines.includes(text)) lines.push(text);
          for (const q of noteCites) cite(c.documentId, c.page, q);
        }
      }
    }
    // A bare heading line (no figure, at most six words, no lower-case
    // sentence) beside a table row is not a separate claim.
    // Follow-up review (B): only an ALL-CAPS heading whose words are on the
    // topic allow-list; a short condition ("Not covered", "Prior
    // Authorization Required") is prose.
    const heading = c.quote.split("\n").filter((l) => l.trim()).every((l) => isTopicHeading(l.replace(/:\s*$/, "")));
    if (!inTable && !heading) prose = true;
  }
  if (!touched) return undefined;
  // Review R2-d: prose and a table row cited together — the prose would be
  // dropped from a server-rendered answer, so nothing is rendered.
  if (prose) return "mixed";
  return lines.length > 0 ? { answerText: lines.join("\n"), citations: cites } : "uncitable";
}
