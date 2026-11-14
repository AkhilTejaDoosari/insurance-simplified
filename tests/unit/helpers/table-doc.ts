// Synthetic positioned-PDF pages for layout-table tests. Items are laid out
// like a real benefit schedule (label column + one column per heading) and run
// through the production positionItems/detectTables, so tests exercise the
// same path as uploaded PDFs.
import { detectTables, positionItems, type LayoutTable, type RawTextItem } from "@/app/lib/pdf/layout-tables";

export interface TablePageSpec {
  /** Lines above the table (title, plan declaration…), one item per line. */
  preamble?: string[];
  caption?: string;
  headings: string[];
  /** label, then one cell text per heading ("" = empty cell). */
  rows: [string, ...string[]][];
  /** Lines below the table. */
  trailer?: string[];
}

const FS = 9;
const width = (s: string) => s.length * 4.5;
const item = (str: string, x: number, y: number, hasEOL = false): RawTextItem => ({
  str, transform: [FS, 0, 0, FS, x, y], width: width(str), hasEOL,
});

/** Column x positions: label at 30, headings from 200 every 110. */
export const columnX = (i: number) => 200 + i * 110;

export function tablePageItems(spec: TablePageSpec): RawTextItem[] {
  const raw: RawTextItem[] = [];
  const items = { push: (i: RawTextItem) => raw.push(i) };
  let y = 760;
  for (const line of spec.preamble ?? []) { items.push(item(line, 30, y, true)); y -= 14; }
  y -= 10;
  if (spec.caption) items.push(item(spec.caption, 30, y));
  spec.headings.forEach((h, i) => items.push(item(h, columnX(i), y, i === spec.headings.length - 1)));
  y -= 16;
  for (const [label, ...cells] of spec.rows) {
    items.push(item(label, 30, y, cells.every((c) => !c)));
    const last = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0).pop();
    cells.forEach((c, i) => { if (c) items.push(item(c, columnX(i), y, i === last)); });
    y -= 16;
  }
  y -= 10;
  for (const line of spec.trailer ?? []) { items.push(item(line, 30, y, true)); y -= 14; }
  // pdf.js emits a whitespace item between runs on one line, as real PDFs do.
  return raw.flatMap((i) => (i.hasEOL ? [i] : [i, { ...i, str: " ", width: 2, transform: [...i.transform.slice(0, 4), i.transform[4] + i.width, i.transform[5]] }]));
}

export interface TestDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
  tables: LayoutTable[];
}

/** A document whose pages are plain text lines or table pages. */
export function tableDocument(documentId: string, pages: (string | TablePageSpec)[]): TestDocument {
  const texts: string[] = [];
  const tables: LayoutTable[] = [];
  pages.forEach((page, index) => {
    if (typeof page === "string") { texts.push(page); return; }
    const { text, items } = positionItems(tablePageItems(page));
    texts.push(text);
    tables.push(...detectTables(text, items, index + 1));
  });
  return { documentId, filename: `${documentId}.pdf`, pageCount: texts.length, pages: texts, tables };
}
