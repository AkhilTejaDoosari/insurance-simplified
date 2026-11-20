// Per-page readability record (EC-10: absence is honest).
//
// The quality gate (ingestion/quality-gate.ts) rejects documents with no text
// at all, but a partly scanned PDF passes it on the strength of its readable
// pages. Every downstream "not found" must then say which pages were actually
// read. This module records, per 1-based page, whether its text was read:
//
//   read               — the page has extractable text
//   empty              — no extractable text and no images (blank page)
//   unreadable         — no extractable text but the page paints images
//                        (image-only / scanned: OCR is not implemented)
//   partly-unreadable  — some text, but little of it, and the page paints
//                        images (a scanned table or insert may hold content
//                        the text layer does not)
//
// The thresholds are heuristics, not spec. They err towards reporting a page
// as not fully read: a false "partly unreadable" only adds a caveat, while a
// false "read" would let a miss pass as an absence.

export type PageReadabilityStatus = "read" | "empty" | "unreadable" | "partly-unreadable";

export interface PageReadability {
  /** 1-based page number. */
  page: number;
  status: PageReadabilityStatus;
  /** Non-whitespace characters of extracted text on the page. */
  textChars: number;
  /** True when the page paints at least one image; absent when unknown. */
  hasImages?: boolean;
}

export interface DocumentReadability {
  /** Pages whose text was read (status "read" or "partly-unreadable"). */
  pagesRead: number[];
  /** Pages with no extractable text at all ("empty" or "unreadable"). */
  pagesNotRead: number[];
  /** Pages read only partly: some text, plus images that may hold more. */
  pagesPartlyRead: number[];
}

/** Below this many non-whitespace characters, a page that paints images is
 *  treated as partly unreadable. */
export const PARTLY_READ_MAX_CHARS = 200;

export function textCharCount(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/** Classify one page from its extracted text and (when known) whether it
 *  paints images. Pure. */
export function classifyPage(page: number, text: string, hasImages?: boolean): PageReadability {
  const textChars = textCharCount(text);
  const status: PageReadabilityStatus = textChars === 0
    ? (hasImages ? "unreadable" : "empty")
    : hasImages && textChars < PARTLY_READ_MAX_CHARS ? "partly-unreadable" : "read";
  return { page, status, textChars, ...(hasImages === undefined ? {} : { hasImages }) };
}

/** Readability for every page of a document. `imagePages` lists the 1-based
 *  pages known to paint images; when omitted, image presence is unknown and
 *  only text-less pages are reported (as "empty"). */
export function assessPageReadability(
  pages: readonly string[],
  imagePages?: ReadonlySet<number>,
): PageReadability[] {
  return pages.map((text, index) =>
    classifyPage(index + 1, typeof text === "string" ? text : "", imagePages ? imagePages.has(index + 1) : undefined));
}

/** Page-number summary of a readability record. */
export function summarizeReadability(records: readonly PageReadability[]): DocumentReadability {
  const pagesRead: number[] = [];
  const pagesNotRead: number[] = [];
  const pagesPartlyRead: number[] = [];
  for (const r of records) {
    if (r.status === "read") pagesRead.push(r.page);
    else if (r.status === "partly-unreadable") { pagesRead.push(r.page); pagesPartlyRead.push(r.page); }
    else pagesNotRead.push(r.page);
  }
  return { pagesRead, pagesNotRead, pagesPartlyRead };
}

/** Validate a stored readability record against the document's page texts:
 *  one entry per page in order, and never "read" for a page with no text.
 *  An inconsistent record is replaced by one derived from the text alone
 *  (fail closed: a stored record cannot hide an empty page). */
export function readabilityFor(doc: {
  pages: readonly string[];
  readability?: readonly PageReadability[];
}): PageReadability[] {
  const derived = assessPageReadability(doc.pages);
  const stored = doc.readability;
  if (!Array.isArray(stored) || stored.length !== doc.pages.length) return derived;
  const consistent = stored.every((r, i) =>
    r && r.page === i + 1 &&
    (r.status === "read" || r.status === "empty" || r.status === "unreadable" || r.status === "partly-unreadable") &&
    ((derived[i].status === "empty") === (r.status === "empty" || r.status === "unreadable")));
  return consistent ? stored.map((r) => ({ ...r })) : derived;
}
