// P3-B ingestion quality gate: broken extractions never become searchable.
//
// This module sits between PDF text extraction (app/lib/pdf/extract-pages.ts)
// and chunking/indexing (app/lib/rag/chunks.ts). The upload route calls
// checkExtraction() on the extracted pages and classifyExtractorError() on
// caught errors; any non-ok result becomes a per-file FAILED outcome with a
// plain-language message — the document is never chunked, embedded, or
// persisted.
//
// Machine-readable reasons (stable contract for lifecycle FAILED + UI):
//   * document_unreadable  — zero extractable text (blank or image-only pages)
//   * extraction_failed    — extractor threw, returned empty/non-array, or an
//                            unknown failure with no header/trailer signal
//   * unsupported_document — corrupt/encrypted/not-a-PDF (PDF header/trailer
//                            failure detected from extractor errors)
//   * implausible_volume   — total extracted chars outside plausibility bounds
//
// Volume thresholds are HEURISTICS, not spec:
//   MIN_EXTRACTED_CHARS = 50 (below this a "brochure" is a stub, not content)
//   MAX_EXTRACTED_CHARS = 20_000_000 (~20MB of text; above this the file was
//   almost certainly mis-extracted or adversarial).
//
// OCR IS NOT IMPLEMENTED: scanned/image-only PDFs are rejected as
// document_unreadable with copy that says so explicitly. Never claim
// scanned-PDF support anywhere in this path.

export type QualityGateReason =
  | "document_unreadable"
  | "extraction_failed"
  | "unsupported_document"
  | "implausible_volume";

export type QualityGateResult =
  | { ok: true }
  | { ok: false; reason: QualityGateReason; detail?: string };

/** Heuristic lower bound: fewer chars than this is not indexable content. */
export const MIN_EXTRACTED_CHARS = 50;
/** Heuristic upper bound: more chars than this signals mis-extraction. */
export const MAX_EXTRACTED_CHARS = 20_000_000;

/**
 * Gate extracted page text before it becomes searchable.
 * Pure: safe to call from the upload route and from unit tests.
 */
export function checkExtraction(pages: unknown): QualityGateResult {
  if (!Array.isArray(pages) || pages.length === 0) {
    return { ok: false, reason: "extraction_failed", detail: "no pages extracted" };
  }
  for (const p of pages) {
    if (typeof p !== "string") {
      return { ok: false, reason: "extraction_failed", detail: "non-text page entry" };
    }
  }
  const joined = (pages as string[]).join("\n");
  if (!joined.trim()) {
    return { ok: false, reason: "document_unreadable", detail: "zero extractable text" };
  }
  const total = joined.length;
  if (total < MIN_EXTRACTED_CHARS || total > MAX_EXTRACTED_CHARS) {
    return {
      ok: false,
      reason: "implausible_volume",
      detail: `extracted ${total} chars (bounds ${MIN_EXTRACTED_CHARS}..${MAX_EXTRACTED_CHARS})`,
    };
  }
  return { ok: true };
}

const UNSUPPORTED_SIGNALS = [
  "%pdf",
  "header",
  "trailer",
  "xref",
  "corrupt",
  "encrypt",
  "password",
  "not a pdf",
  "not-a-pdf",
  "is not a pdf",
];

const UNREADABLE_SIGNALS = ["no extractable text", "unreadable"];

/**
 * Map an extractor throw (notably the `reason`-tagged errors from
 * extract-pages.ts) to a machine-readable gate reason. Detects PDF
 * header/trailer failure from the error message for the
 * unsupported_document case.
 */
export function classifyExtractorError(err: unknown): QualityGateResult & { ok: false } {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const reason = (err as { reason?: unknown } | null)?.reason;
  const haystack = `${String(reason ?? "")} ${message}`.toLowerCase();

  if (
    reason === "encrypted" ||
    reason === "not-pdf" ||
    UNSUPPORTED_SIGNALS.some((s) => haystack.includes(s))
  ) {
    return { ok: false, reason: "unsupported_document", detail: message || undefined };
  }
  if (reason === "unreadable" || UNREADABLE_SIGNALS.some((s) => haystack.includes(s))) {
    return { ok: false, reason: "document_unreadable", detail: message || undefined };
  }
  if (
    reason === "over-size-limit" ||
    reason === "over-page-limit" ||
    reason === "non-english"
  ) {
    // Size/page-limit and language rejections are volume-class: the bytes
    // decoded, but the result is outside what the pipeline indexes.
    return { ok: false, reason: "implausible_volume", detail: message || undefined };
  }
  return { ok: false, reason: "extraction_failed", detail: message || undefined };
}

/**
 * Plain-language, user-visible message per reason. The unreadable copy
 * states explicitly that scanned-PDF (OCR) support is not implemented —
 * never imply image PDFs will work.
 */
export function userVisibleMessage(reason: QualityGateReason): string {
  switch (reason) {
    case "document_unreadable":
      return (
        "We couldn't read any text from this PDF. It may be a scanned image — " +
        "scanned-PDF (OCR) support is not implemented, so please upload a PDF with selectable text."
      );
    case "unsupported_document":
      return "This file looks corrupt, encrypted, or isn't a readable PDF. Please upload an unencrypted PDF.";
    case "implausible_volume":
      return "This document's extracted text looks unusually short or large, so it wasn't indexed. Please check the file and try again.";
    case "extraction_failed":
      return "Something went wrong while reading this PDF. Please try uploading it again.";
  }
}
