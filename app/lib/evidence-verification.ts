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

/** R5 claim-to-citation verifier (refusal only, no repair).
 *  Verifies three conditions:
 *  (a) every substantive generated sentence is covered by >=1 citation
 *  (b) every emitted citation occurs in the SUPPLIED chunk context
 *  (c) every citation resolves via evidence-verification against the ORIGINAL page
 *  ANY failure -> fixed refusal. No repair.
 */
export interface VerifyClaimsResult {
  ok: boolean;
  rationale?: string;
}

/** Split text into sentences using regex boundaries. */
function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Count whitespace-separated tokens in a segment. */
function countTokens(segment: string): number {
  return segment.split(/\s+/).filter(Boolean).length;
}

/** Normalize text for substring matching: lowercase, collapse whitespace, strip punctuation. */
function normalizeForClaim(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Check if a normalized sentence is covered by any normalized canonical quote. */
function isSentenceCovered(sentence: string, canonicalQuotes: string[]): boolean {
  const normSentence = normalizeForClaim(sentence);
  if (!normSentence) return false;
  for (const quote of canonicalQuotes) {
    const normQuote = normalizeForClaim(quote);
    if (normQuote.includes(normSentence)) return true;
    // Check token-level coverage: every non-stopword token in sentence appears in quote
    const sentenceTokens = normSentence.split(/\s+/).filter((t) => t.length > 2);
    if (sentenceTokens.length === 0) continue;
    const allTokensInQuote = sentenceTokens.every((t) => normQuote.includes(t));
    if (allTokensInQuote) return true;
  }
  return false;
}

/** Verify claims in answerText against supplied citations and chunk context.
 *  Returns { ok: true } if all checks pass, else { ok: false, rationale }.
 *  Any failure -> fixed refusal. No repair.
 */
export function verifyAnswerClaims(
  answerText: string,
  citations: Array<{ documentId: string; page: number; quote: string }>,
  suppliedChunks: Array<{ documentId: string; page: number; quote: string }>,
  sessionDocuments: Array<{ documentId: string; pages: string[] }>
): VerifyClaimsResult {
  // (b) Every emitted citation must occur in the SUPPLIED chunk context.
  // Normalized containment within the SAME document + page: the LLM may
  // reflow whitespace/line breaks from the prompt, so raw substring
  // inclusion rejects valid quotes. Wrong page or other document still fails.
  for (const citation of citations) {
    const normQuote = normalizeForClaim(citation.quote);
    const inSupplied = suppliedChunks.some(
      (c) =>
        c.documentId === citation.documentId &&
        c.page === citation.page &&
        normalizeForClaim(c.quote).includes(normQuote)
    );
    if (!inSupplied) {
      // Boolean-only diagnostics (no chunk text): where DID the quote appear?
      const suppliedDoc = suppliedChunks.some(
        (c) => c.documentId === citation.documentId && normalizeForClaim(c.quote).includes(normQuote)
      );
      const sourceDoc = (() => {
        const doc = sessionDocuments.find((d) => d.documentId === citation.documentId);
        if (!doc || !Number.isInteger(citation.page) || citation.page < 1 || citation.page > doc.pages.length) {
          return false;
        }
        const pageText = doc.pages[citation.page - 1];
        return typeof pageText === "string" && normalizeForClaim(pageText).includes(normQuote);
      })();
      return {
        ok: false,
        rationale: `Citation not in supplied context: ${citation.documentId} p${citation.page} suppliedDoc=${suppliedDoc} sourceDoc=${sourceDoc}`,
      };
    }
  }

  // (c) Every citation must verify against the original page
  const canonicalQuotes: string[] = [];
  for (const citation of citations) {
    const doc = sessionDocuments.find((d) => d.documentId === citation.documentId);
    if (!doc) {
      return { ok: false, rationale: `Citation document not found: ${citation.documentId}` };
    }
    if (!Number.isInteger(citation.page) || citation.page < 1 || citation.page > doc.pages.length) {
      return { ok: false, rationale: `Citation page out of range: ${citation.documentId} p${citation.page}` };
    }
    const pageText = doc.pages[citation.page - 1];
    if (typeof pageText !== "string" || !pageText.trim()) {
      return { ok: false, rationale: `Citation page empty: ${citation.documentId} p${citation.page}` };
    }
    if (typeof citation.quote !== "string" || !citation.quote.trim()) {
      return { ok: false, rationale: `Citation quote empty` };
    }
    // Simple exact normalized containment check
    const normPage = normalizeForClaim(pageText);
    const normQuote = normalizeForClaim(citation.quote);
    if (!normPage.includes(normQuote)) {
      return { ok: false, rationale: `Citation not found in source page: ${citation.documentId} p${citation.page}` };
    }
    canonicalQuotes.push(citation.quote);
  }

  // (a) Every substantive generated sentence must be covered by >=1 citation
  const sentences = splitSentences(answerText);
  for (const sentence of sentences) {
    if (countTokens(sentence) < 4) continue; // non-substantive
    if (!isSentenceCovered(sentence, canonicalQuotes)) {
      return { ok: false, rationale: `Unsupported claim: "${sentence}"` };
    }
  }

  return { ok: true };
}

/** R6 grounding classifier (FR-020): explicit = every substantive sentence is
 *  a normalized substring of some canonical quote; otherwise related.
 *  Call only after verifyAnswerClaims passes. */
export function classifyGrounding(answerText: string, canonicalQuotes: string[]): "explicit" | "related" {
  const sentences = splitSentences(answerText).filter((s) => countTokens(s) >= 4);
  if (sentences.length === 0) return "explicit";
  const normQuotes = canonicalQuotes.map(normalizeForClaim);
  for (const sentence of sentences) {
    const normSentence = normalizeForClaim(sentence);
    if (!normSentence) continue;
    if (!normQuotes.some((q) => q.includes(normSentence))) return "related";
  }
  return "explicit";
}
