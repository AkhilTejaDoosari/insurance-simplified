// Server-side evidence verification + canonicalization boundary.
// Operates only on session documents/pages and core {documentId, page,
// quote} citations. Imports no extraction- or RAG-specific types: engines
// stay session-agnostic, and this module never mints evidence IDs.
//
// A citation is usable only if its quote can be PROVEN to occur on its
// claimed document/page. The registry and the UI must receive the canonical
// VERBATIM source span — never the model's condensed text.

import { normalizeForMatch } from "@/app/lib/pdf/text-match";

export interface SessionDocumentLike {
  documentId: string;
  pageCount: number;
  pages: string[];
}

export interface EvidenceInput {
  documentId: string;
  page: number;
  quote: string;
}

export type VerifyResult = { ok: true; quote: string } | { ok: false };

/** Conservative maximum source span (in original characters) an ellipsis
 *  repair may recover. Keeps recovered quotes citation-sized: a span wider
 *  than this fails closed instead of swallowing a page section. */
export const MAX_RECOVERED_SPAN_CHARS = 600;

interface NormText {
  /** Collapsed + trimmed searchable text. */
  text: string;
  /** Original offset per searchable char. */
  map: number[];
}

/** Collapse a normalized string exactly like a quote: runs to one space,
 *  trimmed ends, with an exact original-offset map. */
function collapseMapped(s: string): NormText {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === " " || ch === "\n") {
      let j = i + 1;
      while (j < s.length && (s[j] === " " || s[j] === "\n")) j++;
      if (text.length > 0 && j < s.length) {
        text += " ";
        map.push(i);
      }
      i = j;
    } else {
      text += ch;
      map.push(i);
      i++;
    }
  }
  return { text, map };
}

function preparePage(pageText: string): NormText {
  return collapseMapped(normalizeForMatch(pageText));
}

/** Drop hyphen-followed-by-whitespace (a line-wrap artifact, never genuine
 *  mid-word punctuation) while keeping the offset map exact. */
function stripWrapHyphens(page: NormText): NormText {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < page.text.length; ) {
    if (page.text[i] === "-") {
      let j = i + 1;
      while (j < page.text.length && page.text[j] === " ") j++;
      if (j > i + 1) {
        i = j;
        continue;
      }
    }
    text += page.text[i];
    map.push(page.map[i]);
    i++;
  }
  return { text, map };
}

function prepareNeedle(quote: string): string {
  return collapseMapped(normalizeForMatch(quote)).text;
}

/** Occurrences of needle capped at limit+1 (enough to prove ambiguity). */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return out;
    out.push(at);
    if (out.length > 1) return out;
    from = at + 1;
  }
}

/** Unique contiguous occurrence → verbatim source span, else null. */
function uniqueSpan(page: NormText, needle: string): { start: number; end: number } | null {
  const hits = occurrences(page.text, needle);
  if (hits.length !== 1) return null;
  const start = page.map[hits[0]];
  const end = page.map[hits[0] + needle.length - 1] + 1;
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

const ELLIPSIS = /\.\.\.|…/;

/** Deterministic source-span recovery from ordered literal anchors.
 *  Splits the model quote on explicit ellipsis markers; every non-empty
 *  fragment must occur in order; the chained span must be unique and fit
 *  MAX_RECOVERED_SPAN_CHARS. No reordering, no fuzzy matching — anything
 *  else fails closed. Returns the verbatim source span, not model text. */
function recoverEllipsisSpan(
  page: NormText,
  quote: string
): { start: number; end: number } | null {
  const fragments = quote
    .split(ELLIPSIS)
    .map((f) => prepareNeedle(f))
    .filter(Boolean);
  if (fragments.length < 2) return null;
  const completions: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const start = page.text.indexOf(fragments[0], from);
    if (start === -1) break;
    let pos = start + fragments[0].length;
    let ok = true;
    for (let i = 1; i < fragments.length; i++) {
      const next = page.text.indexOf(fragments[i], pos);
      if (next === -1) {
        ok = false;
        break;
      }
      pos = next + fragments[i].length;
    }
    if (ok) {
      completions.push({ start, end: pos });
      if (completions.length > 1) return null;
    }
    from = start + 1;
  }
  if (completions.length !== 1) return null;
  const span = completions[0];
  const origStart = page.map[span.start];
  const origEnd = page.map[span.end - 1] + 1;
  if (origStart === undefined || origEnd === undefined) return null;
  if (origEnd - origStart > MAX_RECOVERED_SPAN_CHARS) return null;
  return { start: origStart, end: origEnd };
}

/** Verify one core citation against session documents. On success returns
 *  the CANONICAL verbatim source span to store/return instead of the
 *  model-supplied quote. Failure modes (unknown document, bad page,
 *  missing/empty text, no unique span) all fail closed. */
export function verifyEvidenceCitation(
  documents: SessionDocumentLike[],
  citation: EvidenceInput
): VerifyResult {
  const doc = documents.find((d) => d.documentId === citation.documentId);
  if (!doc) return { ok: false };
  if (!Number.isInteger(citation.page) || citation.page < 1 || citation.page > doc.pageCount) {
    return { ok: false };
  }
  const pageText = doc.pages[citation.page - 1];
  if (typeof pageText !== "string" || !pageText.trim()) return { ok: false };
  if (typeof citation.quote !== "string" || !citation.quote.trim()) return { ok: false };

  const page = preparePage(pageText);
  const needle = prepareNeedle(citation.quote);

  // Rule 2: exact normalized containment, unique — then the same with safe
  // line-wrap hyphenation tolerated. Both deterministic and contiguous.
  const exact = uniqueSpan(page, needle);
  if (exact) {
    return { ok: true, quote: pageText.slice(exact.start, exact.end) };
  }
  const wrapped = stripWrapHyphens(page);
  const wrappedNeedle = needle.replace(/-\s+/g, "");
  const wrappedExact = uniqueSpan(wrapped, wrappedNeedle);
  if (wrappedExact) {
    return { ok: true, quote: pageText.slice(wrappedExact.start, wrappedExact.end) };
  }
  // Rule 3: safe ellipsis repair — deterministic span recovery only.
  if (ELLIPSIS.test(citation.quote)) {
    const recovered = recoverEllipsisSpan(page, citation.quote);
    if (recovered) {
      return { ok: true, quote: pageText.slice(recovered.start, recovered.end) };
    }
  }
  return { ok: false };
}

export interface DisplayGrounding {
  supported: boolean;
  unsupportedTokens: string[];
  rationale: string | null;
}

const SURROUNDING_PUNCT = /^[.,;:"'()[\]{}]+|[.,;:"'()[\]{}]+$/g;

/** Coverage normalization: Unicode punctuation via normalizeForMatch, then
 *  lowercase, comma-stripped currency figures ("$3,000" -> "$3000"),
 *  collapsed "$ 250" -> "$250", single-spaced. Case, whitespace, Unicode
 *  punctuation, hyphens, and currency formatting ONLY — no synonyms. */
function normalizeForCoverage(s: string): string {
  return normalizeForMatch(s)
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\$\s+/g, "$")
    .replace(/\s+/g, " ")
    .trim();
}

/** Material tokens of a CellValue display: every token containing a digit is
 *  material (numeric, currency, percentage, date, and code figures all carry
 *  digits). Tokens without digits are stopwords, qualifiers, or generic
 *  insurance words — including words already represented by factName — and
 *  carry no checkable claim. Numeric tokens are ALWAYS material, never
 *  excused by factName. */
export function materialDisplayTokens(display: string, factName: string): string[] {
  const factTokens = new Set(factName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const out: string[] = [];
  for (const raw of normalizeForMatch(display).split(/\s+/)) {
    const cleaned = normalizeForCoverage(raw.replace(SURROUNDING_PUNCT, ""));
    if (!cleaned || !/[0-9]/.test(cleaned)) continue;
    if (factTokens.has(cleaned)) continue;
    out.push(cleaned);
  }
  return out;
}

/** Locked display material-token rule: every material token of display must
 *  appear in the UNION of the value's verified canonical citations (same
 *  coverage normalization on both sides). Deterministic substring check —
 *  no semantic, embedding, fuzzy, or LLM repair. Returns the concise
 *  NEEDS VERIFICATION rationale when unsupported, else null. */
export function checkDisplayGrounding(
  display: string,
  factName: string,
  canonicalQuotes: string[]
): DisplayGrounding {
  const tokens = materialDisplayTokens(display, factName);
  if (tokens.length === 0) return { supported: true, unsupportedTokens: [], rationale: null };
  const union = canonicalQuotes.map(normalizeForCoverage).join("\n");
  const unsupported = [...new Set(tokens.filter((t) => !union.includes(t)))];
  if (unsupported.length === 0) {
    return { supported: true, unsupportedTokens: [], rationale: null };
  }
  const listed = unsupported.map((t) => `"${t}"`).join(", ");
  return {
    supported: false,
    unsupportedTokens: unsupported,
    rationale: `Display material token(s) ${listed} not supported by verified citations for fact "${factName}".`,
  };
}
