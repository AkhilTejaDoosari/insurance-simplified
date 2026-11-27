// Layout-anchored benefit tables.
//
// Page text (extract-pages.ts) is the text items of a page joined in content
// order, so a table's label cell and each tier/network column's value cell
// come out as separate lines. Which line belongs to which row and column is
// then lost, and any reading of the flattened text has to guess. This module
// keeps that relationship: it reads the positioned text items, finds tables
// with a column header line, and records each row's label cell and value
// cells as exact character spans into the SAME page text that citations are
// verified against.
//
// Scope and failure policy:
//   - only header-anchored tables (a line of ≥2 short column headings, with
//     value text aligned under them) are recognized; everything else is left
//     to the line engine;
//   - a value cell belongs to a row only by vertical overlap with that row's
//     label cell, and to the columns its horizontal extent covers;
//   - a cell is never extended over an empty neighbouring column, and is never
//     assigned when its row is unclear. An unread cell is a missing value,
//     never a guessed one.
//
// Pure and deterministic. Spans are [start, end) offsets into page text.

export interface PositionedItem {
  /** Offsets of `str` within the page text. */
  start: number;
  end: number;
  str: string;
  /** Baseline origin and advance width in PDF user space (y grows upwards). */
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface Span {
  start: number;
  end: number;
}

export interface LayoutText {
  text: string;
  spans: Span[];
}

export interface LayoutColumn extends LayoutText {
  /** Stacked heading lines, top first ("Travel Medical Basic", "Reliable Coverage"). */
  lines: string[];
  /** The column's horizontal zone [x0, x1). */
  x0: number;
  x1: number;
}

export interface LayoutCell extends LayoutText {
  /** Indexes into the table's `columns` this cell covers. */
  columns: number[];
}

export interface LayoutRow {
  label: LayoutText;
  cells: LayoutCell[];
  /** The nearest section heading above the row inside the table body
   *  ("EMERGENCY SERVICES AND ASSISTANCE*"): a label-column line or a line
   *  spanning label and value zones that carries no cells. Rows below it,
   *  up to the next such heading, are in its section. */
  section?: LayoutText;
}

/** A footnote block on the page: a line that starts with a marker ("*",
 *  "**", "†") and the lines of the same paragraph (same left edge, font size
 *  and line spacing). `complete` is false when the block's text ends without
 *  a sentence end or with ":", or when its geometric reading order differs
 *  from the page-text order (its citation would not be its text). */
export interface LayoutFootnote extends LayoutText {
  marker: string;
  complete: boolean;
}

export interface LayoutTable {
  /** 1-based page number. */
  page: number;
  /** The header line(s) as one contiguous page-text span. */
  header: Span;
  columns: LayoutColumn[];
  rows: LayoutRow[];
  /** Every footnote block on the table's page. */
  footnotes?: LayoutFootnote[];
  /** A paragraph directly above the header that declares it governs the
   *  table ("All benefits shown below …"), with the heading above it. */
  preamble?: LayoutText;
  /** An unmarked paragraph on the page, below the table, stating a
   *  restriction on the benefits in general. */
  postscript?: LayoutText;
  /** More than one such paragraph: which governs the table is unclear. */
  postscriptAmbiguous?: boolean;
  /** Page-text spans the reader saw inside the table but did not read:
   *  withheld rows, unplaced cells, unmodeled columns. */
  withheld?: Span[];
}

/** Raw pdf.js text-content item (the fields this module reads). */
export interface RawTextItem {
  str?: string | null;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

/** Positioned items with offsets reproducing unpdf's page-text join
 *  (`str + (hasEOL ? "\n" : "")`, items with a null `str` skipped). */
export function positionItems(items: readonly RawTextItem[]): { text: string; items: PositionedItem[] } {
  let text = "";
  const out: PositionedItem[] = [];
  for (const item of items) {
    if (item.str == null) continue;
    const start = text.length;
    text += item.str + (item.hasEOL ? "\n" : "");
    if (!item.str.trim()) continue;
    const [, b, c, d, x, y] = item.transform;
    // Rotated text (diagonal "SAMPLE" watermarks: a non-horizontal baseline,
    // b ≠ 0) is not part of any table row; it stays in the page text, only
    // the geometry ignores it. Italic text is skewed (c ≠ 0) on a horizontal
    // baseline and is read like any other text.
    if (Math.abs(b) > 1e-6) continue;
    out.push({ start, end: start + item.str.length, str: item.str, x, y, width: item.width, fontSize: Math.abs(d) || 1 });
  }
  return { text, items: out };
}

// ---------------------------------------------------------------- geometry

interface Segment {
  /** Set when same-line runs inside one zone were merged across a wide gap. */
  split?: boolean;
  items: PositionedItem[];
  x0: number;
  x1: number;
  y: number;
  fontSize: number;
}

interface Line {
  y: number;
  fontSize: number;
  segments: Segment[];
}

const segText = (s: Segment): string => s.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
const top = (y: number, fs: number) => y + 0.85 * fs;
const bottom = (y: number, fs: number) => y - 0.25 * fs;

function buildLines(items: readonly PositionedItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; fontSize: number; items: PositionedItem[] }[] = [];
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= 0.4 * Math.min(l.fontSize, item.fontSize));
    if (line) line.items.push(item);
    else lines.push({ y: item.y, fontSize: item.fontSize, items: [item] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const row = [...l.items].sort((a, b) => a.x - b.x);
      const segments: Segment[] = [];
      for (const item of row) {
        const last = segments[segments.length - 1];
        const gap = last ? item.x - last.x1 : Infinity;
        // Words of one run are separated by a space item (≈0.25em) or touch;
        // a wider gap is the next table column even when it is narrow.
        if (last && gap <= Math.max(1.5, 0.45 * item.fontSize)) {
          last.items.push(item);
          last.x1 = Math.max(last.x1, item.x + item.width);
        } else {
          segments.push({ items: [item], x0: item.x, x1: item.x + item.width, y: l.y, fontSize: item.fontSize });
        }
      }
      return { y: l.y, fontSize: l.fontSize, segments };
    });
}

// ------------------------------------------------------------------ headers

const HEADER_MAX_WORDS = 6;
const HEADER_MAX_CHARS = 40;

/** A column heading: short, and not itself a value. */
function headingLike(text: string): boolean {
  if (!text || text.length > HEADER_MAX_CHARS) return false;
  if (/[$%:;]/.test(text) || /\d/.test(text)) return false;
  if (text.split(/\s+/).length > HEADER_MAX_WORDS) return false;
  // Headings start a label ("ELITE", "In-Network"); a lowercase start is the
  // wrapped continuation of a cell or of prose.
  if (!/^[A-Z]/.test(text) || /[,.]$/.test(text)) return false;
  return /[A-Za-z]{2}/.test(text);
}

interface HeaderCandidate {
  lineIndex: number;
  /** Header segments (left caption excluded), left to right. */
  segments: Segment[];
  /** Optional caption over the label column ("BENEFIT", "Benefit Levels"). */
  caption?: Segment;
}

/** A line whose two or more right-hand segments are all heading-like. The
 *  leftmost segment may be a caption for the label column. */
function headerCandidate(line: Line, lineIndex: number): HeaderCandidate | undefined {
  const segs = line.segments;
  if (segs.length < 2) return undefined;
  if (!segs.every((s) => headingLike(segText(s)))) return undefined;
  // With three or more segments the leftmost one is a caption when it sits
  // well left of the others; with exactly two, both are columns unless a
  // later alignment check promotes a caption (handled by the caller).
  return { lineIndex, segments: segs };
}

// ------------------------------------------------------------------ columns

type Alignment = "left" | "center";

/** Column zones. The LAST zone is bounded to one column pitch (the spacing
 *  of the previous columns) and its heading's width: text beyond it belongs
 *  to a column the header does not describe (e.g. an SBC "Limitations"
 *  column with a long heading) and must never be merged into a cell. */
function zones(headers: readonly Segment[], alignment: Alignment, pageRight: number): { x0: number; x1: number }[] {
  const last = headers[headers.length - 1];
  if (alignment === "left") {
    const pitch = headers[headers.length - 1].x0 - headers[headers.length - 2].x0;
    return headers.map((h, i) => ({
      x0: h.x0 - 6,
      x1: i + 1 < headers.length ? headers[i + 1].x0 - 6 : Math.min(pageRight, Math.max(last.x1, last.x0 + pitch) + 6),
    }));
  }
  const centers = headers.map((h) => (h.x0 + h.x1) / 2);
  const pitch = centers[centers.length - 1] - centers[centers.length - 2];
  return headers.map((h, i) => ({
    x0: i === 0 ? Math.min(h.x0, centers[0] - (centers[1] - centers[0]) / 2) - 6 : (centers[i - 1] + centers[i]) / 2,
    x1: i + 1 < headers.length ? (centers[i] + centers[i + 1]) / 2 : Math.min(pageRight, Math.max(last.x1, centers[i] + pitch / 2) + 6),
  }));
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Columns a segment covers: zones it overlaps by ≥30% of the zone (or of
 *  itself, for a segment narrower than the zone). */
function coveredColumns(seg: Segment, zs: readonly { x0: number; x1: number }[]): number[] {
  const width = Math.max(1, seg.x1 - seg.x0);
  const out: number[] = [];
  zs.forEach((z, i) => {
    const o = overlap(seg.x0, seg.x1, z.x0, z.x1);
    if (o <= 0) return;
    if (o / Math.min(width, z.x1 - z.x0) >= 0.3) out.push(i);
  });
  return out;
}

// -------------------------------------------------------------------- cells

interface Block {
  segments: Segment[];
  columns: number[];
  top: number;
  bottom: number;
}

const blockTextSpans = (pageText: string, segs: readonly Segment[]): LayoutText => {
  const spans = segs.flatMap((s) => s.items.map((i) => ({ start: i.start, end: i.end })));
  return { text: segs.map(segText).join(" ").replace(/\s+/g, " ").trim(), spans };
};

/** True when only whitespace separates two items in the page text: wrapped
 *  lines of one PDF text block are consecutive in the content stream. */
function streamAdjacent(pageText: string, a: Segment, b: Segment): boolean {
  const aEnd = Math.max(...a.items.map((i) => i.end));
  const bStart = Math.min(...b.items.map((i) => i.start));
  if (bStart < aEnd) return false;
  return !pageText.slice(aEnd, bStart).trim();
}

/** Group a column's segments (top to bottom) into blocks of wrapped lines. */
function groupBlocks(pageText: string, segs: readonly { seg: Segment; columns: number[] }[], label: boolean): Block[] {
  const blocks: Block[] = [];
  for (const { seg, columns } of segs) {
    const last = blocks[blocks.length - 1];
    const lastSeg = last?.segments[last.segments.length - 1];
    const lineGap = lastSeg ? lastSeg.y - seg.y : Infinity;
    const close = lineGap <= 1.7 * Math.max(seg.fontSize, lastSeg?.fontSize ?? 0);
    const sameCols = last && columns.join() === last.columns.join();
    const text = segText(seg);
    // A label cell's own paragraphs (a new bullet, a lowercase wrap, a "(…)"
    // note) may sit farther apart than wrapped lines. Indentation is NOT a
    // signal: right-aligned label columns start every row at a different x.
    const nearby = lineGap <= 2.5 * Math.max(seg.fontSize, lastSeg?.fontSize ?? 0);
    const continuationShaped = CONTINUATION_START.test(text);
    const continues = label
      ? (close && streamAdjacent(pageText, lastSeg!, seg)) || (nearby && continuationShaped)
      : close && sameCols && streamAdjacent(pageText, lastSeg!, seg);
    if (last && continues) {
      last.segments.push(seg);
      last.bottom = bottom(seg.y, seg.fontSize);
    } else {
      blocks.push({ segments: [seg], columns, top: top(seg.y, seg.fontSize), bottom: bottom(seg.y, seg.fontSize) });
    }
  }
  return blocks;
}

// -------------------------------------------------------------------- tables

const MIN_ALIGNED_LINES = 3;
const MAX_PROSE_RUN = 4;

/** Detect header-anchored tables on one page. */
export function detectTables(pageText: string, items: readonly PositionedItem[], page: number): LayoutTable[] {
  const lines = buildLines(items);
  if (lines.length === 0) return [];
  const pageRight = Math.max(...items.map((i) => i.x + i.width)) + 1;
  const tables: LayoutTable[] = [];

  let i = 0;
  while (i < lines.length) {
    const cand = headerCandidate(lines[i], i);
    if (!cand) { i++; continue; }
    const table = readTable(pageText, lines, cand, pageRight, page);
    if (table) {
      tables.push({ ...table.table, footnotes: footnotes(pageText, lines) });
      i = table.nextLine;
    } else {
      i++;
    }
  }
  // A general restriction note governs every table above it on the page.
  const owned = tables.flatMap((t) => [t.header, ...t.columns.flatMap((c) => c.spans), ...(t.preamble?.spans ?? []),
    ...t.rows.flatMap((r) => [...r.label.spans, ...r.cells.flatMap((c) => c.spans), ...(r.section?.spans ?? [])])]);
  const notes = tables.length ? generalNotes(pageText, lines, owned) : [];
  return tables.map(({ top: y, ...t }: LayoutTable & { top?: number }) => {
    const below = notes.filter((n) => y === undefined || n.y < y);
    if (below.length !== 1) return below.length > 1 ? { ...t, postscriptAmbiguous: true } : t;
    const { y: _y, ...postscript } = below[0];
    return { ...t, postscript };
  });
}

// ---------------------------------------------------------------- notes

const MARKER_START = /^(\*+|†+|‡+|§+)\s*(?=\S)/;
const sameText = (a: string, b: string) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
const lineText = (l: Line) => l.segments.map(segText).join(" ");
const lineSegsItems = (ls: readonly Line[]) => ls.flatMap((l) => l.segments.flatMap((s) => s.items));

/** Footnote blocks: geometry decides a note's extent, not punctuation. */
function footnotes(pageText: string, lines: readonly Line[]): LayoutFootnote[] {
  const out: LayoutFootnote[] = [];
  lines.forEach((line, i) => {
    const m = lineText(line).match(MARKER_START);
    if (!m) return;
    const x0 = line.segments[0].x0;
    const block = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      const prev = block[block.length - 1];
      if (prev.y - next.y > 1.8 * next.fontSize) break;
      if (Math.abs(next.segments[0].x0 - x0) > 3 || Math.abs(next.fontSize - line.fontSize) > 0.5) break;
      if (MARKER_START.test(lineText(next))) break;
      block.push(next);
    }
    const items = lineSegsItems(block);
    const text = block.map(lineText).join(" ").replace(/\s+/g, " ").trim();
    const covering = coveringSpan(items.map((it) => ({ start: it.start, end: it.end })));
    const complete = /[.!?]["”)]?$/.test(text) && sameText(pageText.slice(covering.start, covering.end), text);
    out.push({ marker: m[1], text, spans: items.map((it) => ({ start: it.start, end: it.end })), complete });
  });
  return out;
}

/** Words by which a paragraph states that it governs the table below it. */
/** Restriction language in a paragraph next to a table. */
export const RESTRICTS = /\b(?:subject\s+to|unless|limited\s+to|not\s+covered|except|only\s+if|must|per\s+(?:certificate|period))\b/i;
const TABLE_WIDE = /\b(?:eligible\s+(?:medical\s+)?expenses|all\s+benefits|benefits\s+(?:are|shown|listed))\b/i;
export const GOVERNS_TABLE = /\b(?:shown\s+below|listed\s+below|benefits\s+below|the\s+following\s+(?:benefits|table|schedule)|this\s+(?:schedule|table|chart))\b/i;

/** The paragraph directly above a table header, with its heading, when it
 *  declares that it governs the table. */
function preambleAbove(pageText: string, lines: readonly Line[], headerLine: number): LayoutText | undefined {
  const header = lines[headerLine];
  const first = lines[headerLine - 1];
  if (!first || first.y - header.y > 5 * header.fontSize) return undefined;
  const para = [first];
  for (let j = headerLine - 2; j >= 0; j--) {
    const l = lines[j];
    if (l.y - para[0].y > 1.8 * l.fontSize || Math.abs(l.fontSize - first.fontSize) > 0.5) {
      // A short heading line directly above the paragraph names it.
      if (l.y - para[0].y <= 2.5 * l.fontSize && lineText(l).split(/\s+/).length <= 8 && !/[.:;]$/.test(lineText(l))) para.unshift(l);
      break;
    }
    para.unshift(l);
  }
  const body = para.map(lineText).join(" ");
  if (!GOVERNS_TABLE.test(body) && !RESTRICTS.test(body)) return undefined;
  const items = lineSegsItems(para);
  const spans = items.map((it) => ({ start: it.start, end: it.end }));
  const text = body.replace(/\s+/g, " ").trim();
  const covering = coveringSpan(spans);
  // Cited as one contiguous passage, so stream order must be reading order.
  if (!sameText(pageText.slice(covering.start, covering.end), text)) return undefined;
  return { text, spans };
}

/** Unmarked paragraphs that state a restriction on a page's benefits in
 *  general ("Eligible expenses are subject to applicable copayments …
 *  unless specifically indicated otherwise."): left-aligned paragraphs (same
 *  left edge, font and line spacing) that start a sentence at the page's
 *  left margin, end with a sentence end, read in stream order, and are not
 *  text a table owns. */
function generalNotes(pageText: string, lines: readonly Line[], owned: readonly Span[]): (LayoutText & { y: number })[] {
  const out: (LayoutText & { y: number })[] = [];
  const margin = Math.min(...lines.map((l) => l.segments[0].x0));
  const isOwned = (it: PositionedItem) => owned.some((s) => s.start <= it.start && it.start < s.end);
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    if (first.segments[0].x0 > margin + 20 || !/^[A-Z]/.test(lineText(first)) || MARKER_START.test(lineText(first))) continue;
    const para = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      const prev = para[para.length - 1];
      const center = (l: Line) => (l.segments[0].x0 + l.segments[l.segments.length - 1].x1) / 2;
      const aligned = Math.abs(next.segments[0].x0 - first.segments[0].x0) <= 3 || Math.abs(center(next) - center(first)) <= 3;
      if (prev.y - next.y > 1.8 * next.fontSize || !aligned || Math.abs(next.fontSize - first.fontSize) > 0.5 || next.segments.length > 1) break;
      para.push(next);
    }
    i += para.length - 1;
    if (para.some((l) => l.segments.length > 1)) continue; // a row line, not a paragraph
    const items = lineSegsItems(para);
    if (items.some(isOwned)) continue;
    const text = para.map(lineText).join(" ").replace(/\s+/g, " ").trim();
    if (!RESTRICTS.test(text) || !TABLE_WIDE.test(text) || !/[.!?]["”)]?$/.test(text)) continue;
    const spans = items.map((it) => ({ start: it.start, end: it.end }));
    const covering = coveringSpan(spans);
    if (!sameText(pageText.slice(covering.start, covering.end), text)) continue;
    out.push({ text, spans, y: first.y });
  }
  return out;
}

function readTable(
  pageText: string,
  lines: readonly Line[],
  cand: HeaderCandidate,
  pageRight: number,
  page: number,
): { table: LayoutTable; nextLine: number } | undefined {
  // Try the whole line as columns, then the leftmost segment as a caption.
  // The leftmost heading is a caption for the label column ("BENEFIT") only
  // when body labels start where it starts.
  const attempts: HeaderCandidate[] = [cand];
  const first = cand.segments[0];
  const below = lines.slice(cand.lineIndex + 1, cand.lineIndex + 9);
  const labelsUnderFirst = below.filter((l) => Math.abs(l.segments[0].x0 - first.x0) <= 10).length;
  if (cand.segments.length >= 3 && labelsUnderFirst >= 3) {
    attempts.unshift({ ...cand, caption: first, segments: cand.segments.slice(1) });
  }
  for (const attempt of attempts) {
    const result = readTableWith(pageText, lines, attempt, pageRight, page);
    if (result) return result;
  }
  return undefined;
}

function readTableWith(
  pageText: string,
  lines: readonly Line[],
  cand: HeaderCandidate,
  pageRight: number,
  page: number,
): { table: LayoutTable; nextLine: number } | undefined {
  const headerSegs = [...cand.segments];
  // Stacked header lines directly below with the same column count and
  // aligned segments ("United States / In-Network").
  const headerLines = [cand.lineIndex];
  const stacked: Segment[][] = headerSegs.map((s) => [s]);
  for (let j = cand.lineIndex + 1; j < Math.min(lines.length, cand.lineIndex + 4); j++) {
    const line = lines[j];
    const prev = lines[headerLines[headerLines.length - 1]];
    if (prev.y - line.y > 2.6 * line.fontSize) break;
    const right = line.segments.filter((s) => s.x1 > headerSegs[0].x0 - 6);
    // A caption line over the label column only ("Benefit") sits between
    // stacked heading lines; it neither ends nor joins the header.
    if (right.length === 0) continue;
    // Repeated sub-headings ("Plan Pays" under every column) are part of
    // each column's heading: they state what the cells mean.
    if (right.length !== headerSegs.length || !right.every((s) => headingLike(segText(s)))) break;
    const aligned = right.every((s, k) => overlap(s.x0, s.x1, headerSegs[k].x0 - 10, headerSegs[k].x1 + 10) > 0);
    if (!aligned) break;
    right.forEach((s, k) => stacked[k].push(s));
    headerLines.push(j);
  }
  const firstX0 = headerSegs[0].x0;

  // Body: lines after the header until the next header or a prose run.
  const body: Line[] = [];
  let proseRun = 0;
  let next = headerLines[headerLines.length - 1] + 1;
  for (; next < lines.length; next++) {
    const line = lines[next];
    if (headerCandidate(line, next) && line.segments.filter((s) => s.x0 >= firstX0 - 10).length >= 2 &&
        line.segments.every((s) => s.x0 >= firstX0 - 10 || headingLike(segText(s))) && body.length > 0) {
      // A new header line of the same shape ends this table.
      const nextHeader = line.segments.filter((s) => s.x0 >= firstX0 - 10);
      if (nextHeader.length >= 2 && nextHeader.every((s) => headingLike(segText(s))) && distinct(nextHeader.map(segText))) break;
    }
    const inColumns = line.segments.some((s) => s.x0 >= firstX0 - 10);
    const spanning = line.segments.some((s) => s.x0 < firstX0 - 10 && s.x1 > firstX0 + 20);
    if (!inColumns || spanning) {
      proseRun = spanning ? proseRun + 1 : proseRun;
      if (proseRun > MAX_PROSE_RUN) break;
    } else {
      proseRun = 0;
    }
    body.push(line);
  }

  // Alignment mode: value segments left-aligned to header starts, or centered.
  const valueSegs = body.flatMap((l) => l.segments.filter((s) => s.x0 >= firstX0 - 10 && !(s.x0 < firstX0 - 10)));
  if (valueSegs.length === 0) return undefined;
  const leftHits = valueSegs.filter((s) => headerSegs.some((h) => Math.abs(h.x0 - s.x0) <= 6)).length;
  const alignment: Alignment = leftHits / valueSegs.length >= 0.5 ? "left" : "center";
  const zs = zones(headerSegs, alignment, pageRight);
  const labelLimit = zs[0].x0;

  // Assign body segments: label column, value columns, or neither (spanning).
  const labelSegs: { seg: Segment; columns: number[] }[] = [];
  const valueByLine: { seg: Segment; columns: number[] }[] = [];
  /** Segments in an unmodeled column right of the last zone. */
  const unmodeled: Segment[] = [];
  /** Spanning segments assigned to no cell. */
  const dropped: Segment[] = [];
  const lastX1 = zs[zs.length - 1].x1;
  let alignedLines = 0;
  for (const line of body) {
    let lineHasValue = false;
    for (const seg of line.segments) {
      if (seg.x0 >= lastX1 - 4 || seg.x1 > lastX1 + 12) {
        unmodeled.push(seg);
        continue;
      }
      if (seg.x1 <= labelLimit + 4) {
        labelSegs.push({ seg, columns: [] });
      } else if (seg.x0 >= labelLimit - 4) {
        const columns = coveredColumns(seg, zs);
        if (columns.length) {
          valueByLine.push({ seg, columns });
          lineHasValue = true;
        }
      }
      else dropped.push(seg);
      // Otherwise the segment spans label and value zones: a section heading
      // or prose line. It belongs to no cell — and a row it sits inside is
      // incomplete (see below).
    }
    if (lineHasValue) alignedLines++;
  }
  const usedColumns = new Set(valueByLine.flatMap((v) => v.columns));
  if (alignedLines < MIN_ALIGNED_LINES || usedColumns.size < 2) return undefined;

  // Merge same-line label segments ("Hospital Room  and Board,") first.
  const labelBlocks = groupBlocks(pageText, mergeSameLine(labelSegs), true);
  // Value blocks per column set, each column's segments top to bottom.
  const byColumns = new Map<string, { seg: Segment; columns: number[] }[]>();
  for (const v of valueByLine) {
    const key = v.columns.join();
    (byColumns.get(key) ?? byColumns.set(key, []).get(key)!).push(v);
  }
  const valueBlocks = [...byColumns.values()].flatMap((segs) => groupBlocks(pageText, mergeSameLine(segs), false));

  // Rows: a value block joins the label block it overlaps most vertically.
  const rows = labelBlocks.map((label) => ({ label, cells: [] as Block[], incomplete: false }));
  /** Seen but not read: cited nowhere, accounted for by the marker audit. */
  const unread: Segment[] = [...unmodeled];
  /** A cell that cannot be placed may be the wrapped tail (a qualifier) of a
   *  neighbouring row's cell: the rows next to it are incomplete. */
  const markNeighbours = (block: Block) => {
    const above = rows.filter((r) => r.label.top >= block.top).sort((a, b) => a.label.top - b.label.top)[0];
    const below = rows.filter((r) => r.label.top < block.top).sort((a, b) => b.label.top - a.label.top)[0];
    if (above) above.incomplete = true;
    if (below) below.incomplete = true;
  };
  // A row with text in an unmodeled column has content the reader cannot
  // place (a limitation, an exception): it is not read.
  for (const seg of unmodeled) {
    const t = top(seg.y, seg.fontSize);
    const b = bottom(seg.y, seg.fontSize);
    let hit = false;
    for (const row of rows) if (overlap(b, t, row.label.bottom, row.label.top) > 0) { row.incomplete = true; hit = true; }
    if (!hit) markNeighbours({ segments: [seg], columns: [], top: t, bottom: b });
  }
  for (const block of valueBlocks) {
    let best = -1;
    let bestOverlap = 0;
    rows.forEach((row, k) => {
      const o = overlap(block.bottom, block.top, row.label.bottom, row.label.top);
      if (o > bestOverlap) { bestOverlap = o; best = k; }
    });
    if (best < 0) { markNeighbours(block); unread.push(...block.segments); continue; } // row unclear: the cell is not read
    // A block that also overlaps another label block is ambiguous unless
    // the winner dominates.
    const others = rows.filter((row, k) => k !== best && overlap(block.bottom, block.top, row.label.bottom, row.label.top) > 0.5 * bestOverlap);
    if (others.length) { markNeighbours(block); unread.push(...block.segments); continue; }
    rows[best].cells.push(block);
  }

  const columns: LayoutColumn[] = headerSegs.map((_, k) => {
    const segs = stacked[k];
    const text = dedupeWords(segs.map(segText).join(" "));
    return { text, lines: segs.map(segText), spans: segs.flatMap((s) => s.items.map((it) => ({ start: it.start, end: it.end }))), x0: zs[k].x0, x1: zs[k].x1 };
  });

  // Column headings name what distinguishes columns: a repeated heading
  // ("Plan Pays | Plan Pays", "In PPO Network | In PPO Network") is a
  // sub-label inside cells, not a header.
  if (!distinct(columns.map((c) => c.text))) return undefined;

  // Completeness: the reader must account for every line of a row. A line it
  // dropped inside a row's extent, or an orphan continuation block (bullet /
  // lowercase / "(" start, no cells) right below a row, is part of that row's
  // provision the claim would lose — the row is withheld instead.
  const extentOf = (row: (typeof rows)[number]) => ({
    top: Math.max(row.label.top, ...row.cells.map((c) => c.top)),
    bottom: Math.min(row.label.bottom, ...row.cells.map((c) => c.bottom)),
  });
  const ordered = [...rows].sort((a, b) => b.label.top - a.label.top);
  const labelStartX = Math.min(...labelBlocks.map((b) => b.segments[0].x0));
  ordered.forEach((row, k) => {
    if (row.cells.length === 0) return;
    const e = extentOf(row);
    const bandBottom = ordered[k + 1]?.label.top ?? -Infinity;
    for (const seg of dropped) {
      const inside = seg.y <= e.top && seg.y >= e.bottom - 0.5 * seg.fontSize;
      // Below the row but above the next row: a continuation line (starting
      // in the label column, not a centered heading) the reader could not keep.
      const continuation = seg.y < e.bottom && top(seg.y, seg.fontSize) > bandBottom && seg.x0 <= labelStartX + 15 &&
        e.bottom - top(seg.y, seg.fontSize) <= 2.5 * seg.fontSize && CONTINUATION_START.test(segText(seg));
      if (inside || continuation) row.incomplete = true;
    }
  });
  ordered.forEach((row, k) => {
    if (row.cells.length > 0 || k === 0) return;
    const first = row.label.segments[0];
    if (!CONTINUATION_START.test(segText(first))) return;
    // A continuation-shaped orphan close below a row (beyond label paragraph
    // spacing, within 4 lines) is that row's lost text; farther down it is a
    // page note, not this row's.
    const above = ordered[k - 1];
    if (above.cells.length > 0 && extentOf(above).bottom - row.label.top <= 4 * first.fontSize) above.incomplete = true;
  });

  // Section headings: label-column blocks without cells, and lines spanning
  // label and value zones, that lie between rows (not inside a row).
  const sections: Block[] = [
    ...rows.filter((r) => r.cells.length === 0).map((r) => r.label),
    ...mergeSameLine(dropped.map((seg) => ({ seg, columns: [] }))).map(({ seg }) => ({ segments: [seg], columns: [], top: top(seg.y, seg.fontSize), bottom: bottom(seg.y, seg.fontSize) })),
  ].filter((b) => !rows.some((r) => r.cells.length > 0 && b.top < extentOf(r).top && b.bottom > extentOf(r).bottom - 0.5 * b.segments[0].fontSize))
    // A label-column caption level with the header band ("BENEFIT" a line
    // below single-line column headings) is part of the header, not a section.
    .filter((b) => {
      const last = lines[headerLines[headerLines.length - 1]];
      return last.y - b.segments[0].y > 1.6 * last.fontSize;
    });
  // A section is the whole run of heading lines between two rows (title plus
  // restriction lines: "Emergency Services / NOT Subject to Deductible unless
  // otherwise noted / …"); it governs the rows below it up to the next run.
  const ordered2 = [
    ...rows.filter((r) => r.cells.length > 0).map((r) => ({ top: r.label.top, row: r as (typeof rows)[number] | undefined, block: undefined as Block | undefined })),
    ...sections.map((b) => ({ top: b.top, row: undefined, block: b })),
  ].sort((a, b) => b.top - a.top);
  const sectionByRow = new Map<(typeof rows)[number], LayoutText>();
  let run: Block[] = [];
  let closed = true;
  for (const entry of ordered2) {
    if (entry.block) { if (closed) { run = []; closed = false; } run.push(entry.block); }
    else if (entry.row) { closed = true; if (run.length) sectionByRow.set(entry.row, blockTextSpans(pageText, run.flatMap((b) => b.segments))); }
  }
  const sectionOf = (row: (typeof rows)[number]): LayoutText | undefined => sectionByRow.get(row);
  const withheld: Span[] = [];
  const withhold = (row: (typeof rows)[number]) => {
    for (const seg of [...row.label.segments, ...row.cells.flatMap((c) => c.segments)]) withheld.push(...seg.items.map((i) => ({ start: i.start, end: i.end })));
  };
  for (const seg of unread) withheld.push(...seg.items.map((i) => ({ start: i.start, end: i.end })));

  const layoutRows: LayoutRow[] = [];
  for (const row of rows) {
    if (row.cells.length === 0) continue;
    if (row.incomplete) { withhold(row); continue; }
    // A label names a benefit in words; bullets or numbers alone do not.
    if ((segsText(row.label.segments).match(/[A-Za-z]/g) ?? []).length < 3) { withhold(row); continue; }
    if (row.cells.some((c) => c.segments.some((sg) => sg.split))) { withhold(row); continue; }
    // Merge blocks of the same column set in reading order. Lines of one
    // merged cell can differ in width ("Physician Office Visit: Maximum of 30
    // visits" spans two columns, the shorter "Inpatient: …" line one): a block
    // whose columns are a subset of another block's joins it. Partially
    // overlapping column sets are unclear and drop the row below.
    const sets = row.cells.map((c) => c.columns);
    const widest = (cols: number[]) =>
      sets.filter((o) => cols.every((c) => o.includes(c))).sort((a, b) => b.length - a.length)[0];
    const byCols = new Map<string, Block[]>();
    for (const cell of row.cells.sort((a, b) => b.top - a.top)) {
      const key = widest(cell.columns).join();
      (byCols.get(key) ?? byCols.set(key, []).get(key)!).push(cell);
    }
    const claimed = [...byCols.keys()].flatMap((k) => k.split(",").map(Number));
    if (new Set(claimed).size !== claimed.length) { withhold(row); continue; }
    const cells: LayoutCell[] = [...byCols.entries()]
      .map(([key, blocks]) => ({
        ...blockTextSpans(pageText, blocks.flatMap((b) => b.segments)),
        columns: key.split(",").map(Number),
      }))
      .sort((a, b) => a.columns[0] - b.columns[0]);
    // A merged cell extends rightwards from where it starts; an empty FIRST
    // column cannot be such a continuation. A row whose values start in a
    // later column belongs to a different (e.g. single-column) layout, so its
    // column headings would be guessed. Not read.
    if (cells[0].columns[0] !== 0) { withhold(row); continue; }
    const section = sectionOf(row);
    layoutRows.push({ label: blockTextSpans(pageText, row.label.segments), cells, ...(section ? { section } : {}) });
  }
  if (layoutRows.length === 0) return undefined;
  // A table, not prose that happens to sit in columns: most rows carry
  // separate cells for at least two columns…
  const multi = layoutRows.filter((r) => r.cells.length >= 2).length;
  if (multi * 2 < layoutRows.length) return undefined;
  // …and a benefit table's cells state values (an amount, a share, or a
  // coverage word) — two columns of item names or prose are not one.
  const cells = layoutRows.flatMap((r) => r.cells);
  const valued = cells.filter((c) => VALUE_TOKEN.test(c.text)).length;
  if (valued < 0.6 * cells.length) return undefined;

  const headerItems = [...(cand.caption ? [cand.caption] : []), ...stacked.flat()].flatMap((s) => s.items);
  const header = {
    start: Math.min(...headerItems.map((it) => it.start)),
    end: Math.max(...headerItems.map((it) => it.end)),
  };
  const preamble = preambleAbove(pageText, lines, cand.lineIndex);
  return { table: { page, header, columns, rows: layoutRows, ...(preamble ? { preamble } : {}), withheld, top: lines[cand.lineIndex].y } as LayoutTable, nextLine: next };
}

function mergeSameLine(segs: readonly { seg: Segment; columns: number[] }[]): { seg: Segment; columns: number[] }[] {
  const out: { seg: Segment; columns: number[] }[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.seg.y - s.seg.y) < 0.1 && last.columns.join() === s.columns.join()) {
      // Two runs far apart inside one column zone ("90%      80%") are two
      // columns the header does not describe: the cell is unreadable.
      const split = s.seg.x0 - last.seg.x1 > 3 * s.seg.fontSize;
      last.seg = { ...last.seg, items: [...last.seg.items, ...s.seg.items], x1: Math.max(last.seg.x1, s.seg.x1), split: last.seg.split || split };
    } else {
      out.push({ seg: { ...s.seg, items: [...s.seg.items] }, columns: s.columns });
    }
  }
  return out;
}

/** A line that continues the text above it: a bullet, a lowercase wrap, a "(" note. */
const CONTINUATION_START = /^[a-z(•·\-–]/;

const VALUE_TOKEN =
  /[\d$%€£¥]|\b(?:no coverage|not covered|covered|included|not included|n\/a|not applicable|no charge|nothing|none|unlimited|up to|maximum|limit|excluded|refer to|varies)\b/i;
const segsText = (segs: readonly Segment[]): string => segs.map(segText).join(" ");

const headingKey = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function distinct(texts: readonly string[]): boolean {
  return new Set(texts.map(headingKey)).size === texts.length;
}

/** "International International" → "International" (stacked header repeat). */
function dedupeWords(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const half = words.length / 2;
  if (Number.isInteger(half) && words.slice(0, half).join(" ").toLowerCase() === words.slice(half).join(" ").toLowerCase()) {
    return words.slice(0, half).join(" ");
  }
  return words.join(" ");
}

/** Smallest contiguous page-text span covering every given span. */
export function coveringSpan(spans: readonly Span[]): Span {
  return { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) };
}
