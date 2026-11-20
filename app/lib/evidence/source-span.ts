// Exact source spans and verbatim-quote checks against registered pages.
// Pure; reads only the page texts passed in.

import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { normalizeForMatch } from "@/app/lib/pdf/text-match";

/** An exact span of a registered document's stored page text.
 *  `pages[page - 1].slice(start, end) === text` must hold. */
export interface SourceSpan {
  documentId: string;
  /** 1-based page number. */
  page: number;
  /** Character offsets into the stored page text, `end` exclusive. */
  start: number;
  end: number;
  /** The exact source text at that span. */
  text: string;
}

/** Quote-style evidence (same shape as extraction's `EvidenceCitation`). */
export interface EvidenceQuote {
  documentId: string;
  /** 1-based page number. */
  page: number;
  /** Verbatim source text; must re-verify as a unique span on that page. */
  quote: string;
}

export interface PageSource {
  documentId: string;
  pageCount: number;
  pages: readonly string[];
}

/** True only when the span is in range and its text equals the stored page
 *  text at exactly those offsets. */
export function spanIsBound(doc: PageSource, span: SourceSpan): boolean {
  if (!span || span.documentId !== doc.documentId) return false;
  if (!Number.isInteger(span.page) || span.page < 1 || span.page > doc.pageCount) return false;
  const page = doc.pages[span.page - 1];
  if (typeof page !== "string") return false;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) return false;
  if (span.start < 0 || span.end <= span.start || span.end > page.length) return false;
  if (typeof span.text !== "string" || !span.text.trim()) return false;
  return page.slice(span.start, span.end) === span.text;
}

/** True only when the quote re-verifies on its page AND is already the
 *  canonical verbatim span the verifier returns (a sealed quote must not be
 *  a condensed or repaired paraphrase). */
export function quoteReverifies(doc: PageSource, evidence: EvidenceQuote): boolean {
  if (!evidence || evidence.documentId !== doc.documentId) return false;
  const result = verifyEvidenceCitation(
    [{ documentId: doc.documentId, pageCount: doc.pageCount, pages: [...doc.pages] }],
    evidence,
  );
  return result.ok && result.quote === evidence.quote;
}

/** Literal containment under the shared match normalization, case-folded.
 *  Used for EC-4: a scope value is kept only when literally stated. */
export function literallyStates(sourceText: string, value: string): boolean {
  const needle = squash(value);
  return needle.length > 0 && squash(sourceText).includes(needle);
}

function squash(s: string): string {
  return normalizeForMatch(s).trim().toLowerCase();
}
