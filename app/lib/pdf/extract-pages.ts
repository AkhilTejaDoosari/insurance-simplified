// Server-side per-page PDF text extraction (research decision 2).
// Page numbers are the citation unit, so extraction MUST preserve the
// 1-based page alignment of the source document.

import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { detectTables, positionItems, type LayoutTable, type RawTextItem } from "@/app/lib/pdf/layout-tables";
import {
  PARTLY_READ_MAX_CHARS,
  classifyPage,
  textCharCount,
  type PageReadability,
} from "@/app/lib/pdf/page-readability";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 200;

export type RejectionReason =
  | "not-pdf"
  | "unreadable"
  | "encrypted"
  | "non-english"
  | "over-size-limit"
  | "over-page-limit";

export interface ExtractedPdf {
  pageCount: number;
  /** One entry per page; index 0 === page 1. */
  pages: string[];
  /** Header-anchored benefit tables, spans into `pages` (layout-tables.ts). */
  tables: LayoutTable[];
  /** Per-page readability (page-readability.ts): which pages were read,
   *  empty, image-only or only partly read. One entry per page. */
  readability: PageReadability[];
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>["getPage"]>>;

/** True when the page paints at least one image; undefined when the
 *  operator list cannot be read (image presence then stays unknown). */
async function pagePaintsImages(page: PdfPage, imageOps: ReadonlySet<number>): Promise<boolean | undefined> {
  try {
    const ops = await page.getOperatorList();
    return ops.fnArray.some((fn: number) => imageOps.has(fn));
  } catch {
    return undefined;
  }
}

async function imageOperators(): Promise<ReadonlySet<number>> {
  try {
    const { OPS } = await getResolvedPDFJS();
    return new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
      OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup,
      OPS.paintInlineImageXObjectGroup, OPS.paintSolidColorImageMask].filter((op) => typeof op === "number"));
  } catch {
    return new Set();
  }
}

/** Very small heuristic: reject buffers with no extractable Latin text. */
function looksEnglish(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length > 0;
}

export async function extractPages(
  buffer: ArrayBuffer | Uint8Array,
  filename: string
): Promise<ExtractedPdf> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error(`${filename} exceeds the 20 MB limit`), {
      reason: "over-size-limit" satisfies RejectionReason,
    });
  }
  if (
    bytes.length < 5 ||
    String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
  ) {
    throw Object.assign(new Error(`${filename} is not a PDF`), {
      reason: "not-pdf" satisfies RejectionReason,
    });
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw Object.assign(
      new Error(`${filename} is encrypted or corrupt and cannot be read`),
      { reason: "encrypted" satisfies RejectionReason }
    );
  }

  if (pdf.numPages > MAX_PAGES) {
    throw Object.assign(
      new Error(`${filename} exceeds the 200-page limit`),
      { reason: "over-page-limit" satisfies RejectionReason }
    );
  }

  // One text-content pass per page. Page text is the same join unpdf's
  // extractText produces (str + "\n" on hasEOL), so citation offsets are
  // unchanged; the positioned items additionally feed table detection.
  const pages: string[] = [];
  const tables: LayoutTable[] = [];
  const readability: PageReadability[] = [];
  let imageOps: ReadonlySet<number> | undefined;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const { text, items } = positionItems(content.items as unknown as RawTextItem[]);
    pages.push(text);
    // Only sparse pages need the (costlier) operator list: a text-rich page
    // is "read" whether or not it also paints images.
    let hasImages: boolean | undefined;
    if (textCharCount(text) < PARTLY_READ_MAX_CHARS) {
      imageOps ??= await imageOperators();
      hasImages = imageOps.size > 0 ? await pagePaintsImages(page, imageOps) : undefined;
    }
    readability.push(classifyPage(p, text, hasImages));
    try {
      tables.push(...detectTables(text, items, p));
    } catch {
      // Layout reading is an enhancement: a failure leaves the page to the
      // line engine and never fails the upload.
    }
  }

  const joined = pages.join("\n");
  if (!joined.trim()) {
    throw Object.assign(
      new Error(`${filename} contains no extractable text`),
      { reason: "unreadable" satisfies RejectionReason }
    );
  }
  if (!looksEnglish(joined)) {
    throw Object.assign(
      new Error(`${filename} does not appear to be an English document`),
      { reason: "non-english" satisfies RejectionReason }
    );
  }

  return { pageCount: pages.length, pages, tables, readability };
}
