// Server-side per-page PDF text extraction (research decision 2).
// Page numbers are the citation unit, so extraction MUST preserve the
// 1-based page alignment of the source document.

import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { detectTables, positionItems, type LayoutTable, type RawTextItem } from "@/app/lib/pdf/layout-tables";
import { removeRepeatedArtifacts } from "@/app/lib/pdf/watermarks";
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
  /** Owner decision 2026-11-22 (6): watermark artifacts removed from page
   *  text, per page, as counts only (watermarks.ts). */
  artifactsRemoved: { page: number; count: number }[];
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>["getPage"]>>;

// pdf.js (v5+) transfers font buffers with ArrayBuffer#transferToFixedLength,
// which Node < 21 lacks (our production image is node:20). Without it the
// operator list of any page that loads a font is silently truncated, so an
// image after the first text run is never seen. Install a copying fallback
// only when the method is missing (no state; same result bytes).
const arrayBufferProto = ArrayBuffer.prototype as ArrayBuffer & { transferToFixedLength?: (length?: number) => ArrayBuffer };
if (typeof arrayBufferProto.transferToFixedLength !== "function") {
  Object.defineProperty(ArrayBuffer.prototype, "transferToFixedLength", {
    configurable: true,
    writable: true,
    value: function transferToFixedLength(this: ArrayBuffer, length = this.byteLength): ArrayBuffer {
      const out = new ArrayBuffer(length);
      new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
      return out;
    },
  });
}

interface ImageOperators {
  paint: ReadonlySet<number>;
  /** Paired operators a complete operator list balances (save/restore,
   *  beginText/endText). pdf.js "ignores" a page error by truncating the
   *  list, which leaves a pair open. */
  pairs: readonly (readonly [number, number])[];
}

/** True/false when the page's complete operator list shows whether it paints
 *  an image; "failed" when the list could not be read or is truncated (an
 *  unbalanced save/restore or beginText/endText). */
export function imagesInOperatorList(fnArray: readonly number[], ops: ImageOperators): boolean | "failed" {
  for (const [open, close] of ops.pairs) {
    let depth = 0;
    for (const fn of fnArray) {
      if (fn === open) depth++;
      else if (fn === close) depth--;
    }
    if (depth !== 0) return "failed";
  }
  return fnArray.some((fn) => ops.paint.has(fn));
}

async function pagePaintsImages(page: PdfPage, ops: ImageOperators): Promise<boolean | "failed"> {
  try {
    const list = await page.getOperatorList();
    return imagesInOperatorList(list.fnArray as number[], ops);
  } catch {
    return "failed";
  }
}

async function imageOperators(): Promise<ImageOperators | undefined> {
  try {
    const { OPS } = await getResolvedPDFJS();
    const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
      OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup,
      OPS.paintInlineImageXObjectGroup, OPS.paintSolidColorImageMask].filter((op) => typeof op === "number"));
    const pairs = ([[OPS.save, OPS.restore], [OPS.beginText, OPS.endText]] as const)
      .filter(([a, b]) => typeof a === "number" && typeof b === "number");
    return paint.size > 0 ? { paint, pairs } : undefined;
  } catch {
    return undefined;
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
  let imageOps: ImageOperators | undefined | null = null;
  // Two passes: every page's text items first, so text repeated on most
  // pages (a specimen watermark) is removed before page text is joined.
  const pdfPages: PdfPage[] = [];
  const rawItems: RawTextItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    pdfPages.push(page);
    rawItems.push((await page.getTextContent()).items as unknown as RawTextItem[]);
  }
  const { items: cleaned, removed: artifactsRemoved } = removeRepeatedArtifacts(rawItems);
  if (artifactsRemoved.length > 0) {
    // Counts only: never the removed text.
    console.info(`[extract] artifacts-removed pages=${artifactsRemoved.length} items=${artifactsRemoved.reduce((n, r) => n + r.count, 0)}`);
  }
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = pdfPages[p - 1];
    const { text, items } = positionItems(cleaned[p - 1]);
    pages.push(text);
    // Only sparse pages need the (costlier) operator list: a text-rich page
    // is "read" whether or not it also paints images.
    // A check that cannot complete is recorded as failed, never as "read".
    let images: boolean | "failed" | undefined;
    if (textCharCount(text) < PARTLY_READ_MAX_CHARS) {
      if (imageOps === null) imageOps = await imageOperators();
      images = imageOps ? await pagePaintsImages(page, imageOps) : "failed";
    }
    readability.push(images === "failed"
      ? classifyPage(p, text, undefined, "failed")
      : classifyPage(p, text, images));
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

  return { pageCount: pages.length, pages, tables, readability, artifactsRemoved };
}
