// Server-side per-page PDF text extraction (research decision 2).
// Page numbers are the citation unit, so extraction MUST preserve the
// 1-based page alignment of the source document.

import { extractText, getDocumentProxy } from "unpdf";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
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
    throw Object.assign(new Error(`${filename} exceeds the 15 MB limit`), {
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

  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t) =>
    typeof t === "string" ? t : String(t ?? "")
  );

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

  return { pageCount: pages.length, pages };
}
