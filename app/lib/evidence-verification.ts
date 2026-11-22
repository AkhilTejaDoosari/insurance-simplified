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

// --- Field grammars beyond digits (M7, defect "Claim checks digits only") --
// A display can invert a claim without changing a single figure: "covered"
// for "not covered", "in-network" for "out-of-network", or dropping
// "except …" / "does not apply". These closed marker grammars are checked
// deterministically on both sides; no synonyms, no fuzzy matching.

type MarkerKind = "negation" | "exception" | "network";

interface Marker {
  id: string;
  kind: MarkerKind;
  re: RegExp;
}

/** Markers over grammar-normalized text (lowercase, hyphens as spaces). */
const MARKERS: readonly Marker[] = [
  { id: "not covered", kind: "negation", re: /\b(?:not|never)\s+(?:be\s+)?covered\b|\bno\s+coverage\b/g },
  { id: "excluded", kind: "negation", re: /\bexclu(?:ded|sions?)\b/g },
  { id: "does not apply", kind: "negation", re: /\b(?:does|do|will|shall)\s+not\s+apply\b|\bnot\s+applicable\b/g },
  { id: "not eligible", kind: "negation", re: /\bnot\s+eligible\b|\bineligible\b/g },
  { id: "not included", kind: "negation", re: /\bnot\s+included\b/g },
  { id: "no benefit", kind: "negation", re: /\bno\s+benefits?\b/g },
  { id: "not subject to", kind: "negation", re: /\bnot\s+subject\s+to\b/g },
  { id: "except", kind: "exception", re: /\bexcept(?:ing)?\b/g },
  { id: "excluding", kind: "exception", re: /\bexcluding\b/g },
  { id: "unless", kind: "exception", re: /\bunless\b/g },
  { id: "other than", kind: "exception", re: /\bother\s+than\b/g },
  { id: "out-of-network", kind: "network", re: /\bout\s+of\s+network\b/g },
  { id: "non-network", kind: "network", re: /\bnon\s*network\b/g },
  { id: "in-network", kind: "network", re: /\bin\s+network\b/g },
  { id: "non-preferred", kind: "network", re: /\bnon\s*preferred\b/g },
  { id: "preferred", kind: "network", re: /(?<!\bnon\s*)\bpreferred\b/g },
  { id: "non-participating", kind: "network", re: /\bnon\s*participating\b/g },
  { id: "participating", kind: "network", re: /(?<!\bnon\s*)\bparticipating\b/g },
];

/** Affirmative words whose meaning flips under a negation marker: a display
 *  may say "covered" only if a citation says it un-negated. */
const AFFIRMATIVES: readonly { id: string; re: RegExp }[] = [
  { id: "covered", re: /\bcovered\b/ },
  { id: "eligible", re: /\beligible\b/ },
  { id: "included", re: /\bincluded\b/ },
  { id: "applies", re: /\bappl(?:y|ies)\b/ },
];

function grammarText(s: string): string {
  return normalizeForMatch(s).toLowerCase().replace(/[-\u2010-\u2015]/g, " ").replace(/\s+/g, " ").trim();
}

function markersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of MARKERS) if (new RegExp(m.re.source).test(text)) out.add(m.id);
  return out;
}

/** True when text states a negation, exception or network-scope marker of
 *  the closed grammar above (P0-05: such a qualifier is never moved out of
 *  a claim's headline). */
export function statesScopingMarker(text: string): boolean {
  return markersIn(grammarText(text)).size > 0;
}

/** The text's negation/exception/network markers, as a stable key. */
export function scopingMarkers(text: string): string {
  return [...markersIn(grammarText(text))].sort().join(",");
}

function withoutNegations(text: string): string {
  let out = text;
  for (const m of MARKERS) if (m.kind === "negation") out = out.replace(new RegExp(m.re.source, "g"), " ");
  return out;
}

/** Sentence-level clauses (decimal points are not boundaries). */
function clausesOf(text: string): string[] {
  return text.split(/(?<!\d)\.(?!\d)|[;!?\n]+/).map((c) => c.trim()).filter(Boolean);
}

export interface GrammarOptions {
  /** Qualifier values carried with the display (a scope recorded there, e.g.
   *  networkTier "Out-of-Network", is not dropped). */
  qualifiers?: Readonly<Record<string, unknown>>;
  /** The display is a structurally re-derived claim (verified table cell or
   *  statement anchor), verbatim by construction: only the "no flipped or
   *  invented marker" rule applies, not the clause-drop rule. */
  structural?: boolean;
}

/** Marker violations of a display against its verified citations:
 *  1. every negation / exception / network marker the display states must be
 *     stated by a citation (no invented or flipped scope);
 *  2. an affirmative word ("covered", "eligible", "included", "applies") in a
 *     display with no negation must occur un-negated in a citation;
 *  3. (non-structural) a negation or exception marker in a citation clause
 *     that states every figure of the display must be kept in the display or
 *     its qualifiers (no dropped "not covered", "except …"). A network scope
 *     omitted from a display is NOT flagged here: that case is pinned as
 *     SUPPORTED by extract-verify-boundary test 20 and governed by EC-4
 *     qualifier rules; an invented or flipped network marker is (rule 1).
 *  Returns human-readable violation ids (empty when grounded). */
export function displayGrammarViolations(
  display: string,
  canonicalQuotes: readonly string[],
  options: GrammarOptions = {},
): string[] {
  const shown = grammarText(display);
  const union = grammarText(canonicalQuotes.join("\n"));
  const violations: string[] = [];
  const shownMarkers = markersIn(shown);
  const citedMarkers = markersIn(union);
  for (const id of shownMarkers) if (!citedMarkers.has(id)) violations.push(`marker "${id}" not in citations`);
  const shownNegated = MARKERS.some((m) => m.kind === "negation" && shownMarkers.has(m.id));
  if (!shownNegated) {
    const positiveUnion = withoutNegations(union);
    for (const a of AFFIRMATIVES) {
      if (a.re.test(shown) && !a.re.test(positiveUnion)) violations.push(`"${a.id}" is only stated negated in citations`);
    }
  }
  if (!options.structural) {
    const figures = materialDisplayTokens(display, "");
    if (figures.length > 0) {
      const kept = new Set([...shownMarkers, ...markersIn(grammarText(Object.values(options.qualifiers ?? {})
        .filter((v): v is string => typeof v === "string").join(" ")))]);
      for (const quote of canonicalQuotes) {
        for (const clause of clausesOf(quote)) {
          if (!figures.every((f) => normalizeForCoverage(clause).includes(f))) continue;
          for (const id of markersIn(grammarText(clause))) {
            if (MARKERS.find((m) => m.id === id)?.kind === "network") continue;
            if (!kept.has(id)) violations.push(`marker "${id}" dropped from display`);
          }
        }
      }
    }
  }
  return [...new Set(violations)];
}

/** Locked display material-token rule: every material token of display must
 *  appear in the UNION of the value's verified canonical citations (same
 *  coverage normalization on both sides). Deterministic substring check —
 *  no semantic, embedding, fuzzy, or LLM repair. Field grammars
 *  (displayGrammarViolations) additionally keep negation, exceptions and
 *  network scope from being dropped or flipped. Returns the concise
 *  NEEDS VERIFICATION rationale when unsupported, else null. */
export function checkDisplayGrounding(
  display: string,
  factName: string,
  canonicalQuotes: string[],
  options: GrammarOptions = {},
): DisplayGrounding {
  const tokens = materialDisplayTokens(display, factName);
  const union = canonicalQuotes.map(normalizeForCoverage).join("\n");
  const unsupported = [...new Set(tokens.filter((t) => !union.includes(t)))];
  const grammar = displayGrammarViolations(display, canonicalQuotes, options);
  if (unsupported.length === 0 && grammar.length === 0) {
    return { supported: true, unsupportedTokens: [], rationale: null };
  }
  const parts: string[] = [];
  if (unsupported.length > 0) {
    const listed = unsupported.map((t) => `"${t}"`).join(", ");
    parts.push(`Display material token(s) ${listed} not supported by verified citations for fact "${factName}".`);
  }
  if (grammar.length > 0) {
    parts.push(`Display qualifier/negation wording not faithful to verified citations for fact "${factName}": ${grammar.join("; ")}.`);
  }
  return {
    supported: false,
    unsupportedTokens: [...unsupported, ...grammar.map((g) => `grammar:${g}`)],
    rationale: parts.join(" "),
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

/** A sentence that states coverage is substantive however short. */
const COVERAGE_STATEMENT = /\b(?:covered|covers?|cover|provided|not|no|excluded|exclud\w*|except|unless|only|waived?|included|pays?|payable|reimburs\w*|limited)\b/i;

/** Whole figures a text states ("$1,000,000" → "1000000", "80%" → "80"). */
function figuresOf(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "").replace(/\.0+$/, ""));
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
function tokensCovered(normSentence: string, text: string): boolean {
  const normText = normalizeForClaim(text);
  // Word-level coverage (confirmation review): every word (> 2 chars) of the
  // sentence must begin a word of the text — "visit" is covered by "visits",
  // "limited" is NOT covered by "unlimited".
  const words = normText.split(/\s+/).filter(Boolean);
  const sentenceTokens = normSentence.split(/\s+/).filter((t) => t.length > 2);
  return sentenceTokens.length > 0 && sentenceTokens.every((t) => words.some((w) => w.startsWith(t)));
}

/** Negation and qualifier words a faithful sentence must keep exactly,
 *  including ones the marker grammar does not know ("not payable",
 *  "waived if admitted", "covered after 12 months"; follow-up review). */
const QUALIFIER_WORD = /\b(?:not|no|never|nil|none|without|cannot|waived?|except|excluding|excluded|unless|only|if|after|until)\b|n['’]t\b/gi;
function qualifierKey(text: string): string {
  return [...new Set((text.match(QUALIFIER_WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'")))].sort().join(",");
}

function sameMarkers(a: string, b: string): boolean {
  const x = markersIn(grammarText(a));
  const y = markersIn(grammarText(b));
  return x.size === y.size && [...x].every((m) => y.has(m)) && qualifierKey(a) === qualifierKey(b);
}

/** Figure–label binding (owner directive 2026-11-22, blocking; tightened
 *  after two independent reviews). On a line that states two or more values
 *  (repeats included), each value owns its own label words, and a sentence
 *  stating a value must use that value's label and no other value's.
 *  - Separators ("|", "/", tabs, commas) are ignored: a table cell is never
 *    shared context. Words before a colon that precedes the first value are
 *    a header shared by every value ("Copays: $30 primary care, …").
 *  - A value is a number with "$", "%", digit grouping, a decimal, or a
 *    following unit word ("12 months", "40 percent"). Other numbers
 *    ("Tier 1") are read both ways — as label words and as values — and the
 *    sentence must pass under both readings (fail-closed). A footnote digit
 *    glued to a word ("out-of-network2") stays part of that word, so it
 *    never matches the bare word: fail-closed.
 *  - A capital letter after a word ("Part A", "Plan B") is a label word.
 *  - Layout: words, then values, ending on a value → label-first (each
 *    value owns the words before it); starting on a value and ending on
 *    words → figure-first (the words after it); otherwise ambiguous: the
 *    sentence must repeat the words on both sides, each on its own side. On
 *    a label-first line a value with no label of its own inherits the
 *    previous one ("Out-of-pocket maximum $1,000 per person $2,000 per
 *    family"); elsewhere such a value owns nothing and is rejected.
 *  - Unit words directly after a value ("per visit") are that value's own.
 *  - A sentence names at least one label word of its value (a figure-only
 *    sentence such as "$300." is rejected); a sentence with several values
 *    states them as a contiguous, same-order run of the line's values. */
const UNIT_WORD = /^(?:days?|weeks?|months?|years?|hours?|visits?|times?|percent)$/;
const UNIT_LEAD = /^(?:per|each|every)$/;
const BINDING_FILLER = new Set([
  "a", "an", "the", "and", "or", "of", "to", "up", "is", "be", "as", "at", "by",
  "for", "are", "you", "your", "this", "that", "from", "has", "have", "will", "its", "was",
]);

type BindingToken = { value: string } | { word: string };

function bindingTokens(text: string, plainAsValues: boolean, letterLabels = false): { tokens: BindingToken[]; plain: boolean } {
  // A range of two like numbers ("$0 - $5,000", "12 to 18") is one value.
  const NUM = String.raw`\d[\d,]*(?:\.\d+)?%?`;
  const rangeRe = new RegExp(String.raw`\$\s?${NUM}\s*(?:-|–|—|to)\s*\$\s?${NUM}|(?<![a-z0-9$])${NUM}\s*(?:-|–|—|to)\s*${NUM}`, "i");
  const raw = [...text.matchAll(new RegExp(String.raw`${rangeRe.source}|\$\s?${NUM}|(?<![a-z0-9])${NUM}|[a-z][a-z0-9']*`, "gi"))].map((m) => m[0]);
  const isNumber = (t: string) => /^[$\d]/.test(t);
  const norm = (t: string) =>
    t.split(/\s*(?:-|–|—|to)\s*(?=[$\d])/i).map((p) => p.replace(/[$%,\s]/g, "").replace(/\.0+$/, "")).join("-");
  const marked = raw.map((t, i) =>
    isNumber(t) && (t.startsWith("$") || t.endsWith("%") || /,\d{3}/.test(t) || /\.\d/.test(t) || UNIT_WORD.test((raw[i + 1] ?? "").toLowerCase())),
  );
  const anyMarked = marked.some(Boolean);
  const plain = raw.some((t, i) => isNumber(t) && !marked[i]);
  const tokens = raw.map((t, i): BindingToken => {
    if (isNumber(t)) return marked[i] || !anyMarked || plainAsValues ? { value: norm(t) } : { word: norm(t) };
    const letterLabel = (letterLabels ? /^[a-z]$/i : /^[A-Z]$/).test(t) && i > 0 && !isNumber(raw[i - 1]);
    return { word: letterLabel ? t.toUpperCase() : t.toLowerCase() };
  });
  return { tokens, plain: plain && anyMarked };
}

interface ValueSlot {
  value: string;
  before: string[];
  after: string[];
  /** Label words this value owns. */
  own: string[];
  units: string[];
  /** Ambiguous layout: words the sentence must repeat. */
  required: string[];
}

interface ParsedLine {
  slots: ValueSlot[];
  header: string[];
  ambiguous: boolean;
  plain: boolean;
}

const meaningful = (words: readonly string[]) => words.filter((w) => !BINDING_FILLER.has(w));

function parseValues(text: string, plainAsValues: boolean, letterLabels = false): ParsedLine {
  const { tokens, plain } = bindingTokens(text, plainAsValues, letterLabels);
  const values: { value: string; units: string[] }[] = [];
  const runs: string[][] = [[]];
  let unitRun = false;
  let afterLead = false;
  for (const t of tokens) {
    if ("value" in t) {
      values.push({ value: t.value, units: [] });
      runs.push([]);
      unitRun = true;
      afterLead = false;
      continue;
    }
    if (unitRun && (afterLead || UNIT_WORD.test(t.word) || UNIT_LEAD.test(t.word))) {
      values[values.length - 1].units.push(t.word);
      afterLead = UNIT_LEAD.test(t.word);
      continue;
    }
    unitRun = false;
    runs[runs.length - 1].push(t.word);
  }
  const k = values.length;
  // "Copays: $30 …" — words before a colon that precedes the first value.
  // A second colon means "Label: $X, Label: $Y" — labels, not a header.
  const header = k > 0 && (text.match(/:/g) ?? []).length === 1 && /^[^$\d]*:\s*[^a-z]*\$?\d/i.test(text) ? runs[0] : [];
  if (header.length > 0) runs[0] = [];
  const first = runs[0].length > 0;
  const last = runs[k].length > 0;
  const mode = first && !last ? "label" : !first && last ? "figure" : "ambiguous";
  const inherit = (i: number, step: -1 | 1): string[] => {
    for (let j = i; j >= 0 && j <= k; j += step) if (meaningful(runs[j]).length > 0) return runs[j];
    return [];
  };
  const slots = values.map((v, i) => {
    const sides = { before: runs[i], after: runs[i + 1] };
    if (mode === "label") {
      const own = meaningful(runs[i]).length > 0 ? runs[i] : [...runs[i], ...inherit(i, -1)];
      return { ...v, ...sides, own, required: [] };
    }
    if (mode === "figure") {
      // No inheritance here (third review): a leading value without its own
      // words may belong to the previous line after a wrap — it owns nothing.
      if (meaningful(runs[i + 1]).length === 0) return { ...v, ...sides, own: [], units: [], required: [] };
      return { ...v, ...sides, own: runs[i + 1], required: [] };
    }
    // A value with no words on one side cannot be bound (undecidable):
    // it owns nothing, so any sentence stating it is rejected.
    if (meaningful(runs[i]).length === 0 || meaningful(runs[i + 1]).length === 0) return { ...v, ...sides, own: [], units: [], required: [] };
    const own = [...runs[i], ...runs[i + 1]];
    return { ...v, ...sides, own, required: meaningful(own) };
  });
  return { slots, header, ambiguous: mode === "ambiguous", plain };
}

/** A sentence word matches a line word: numbers and letter labels exactly,
 *  words by prefix ("visit" ↔ "visits"), the same rule as word coverage. */
function wordMatches(sentenceWord: string, lineWord: string): boolean {
  return /^(?:\d|[A-Z]$)/.test(sentenceWord) ? sentenceWord === lineWord : lineWord.startsWith(sentenceWord);
}
const allMatch = (words: readonly string[], allowed: readonly string[]) =>
  meaningful(words).every((w) => allowed.some((a) => wordMatches(w, a)));

function boundUnder(sentence: string, line: string, plainAsValues: boolean): boolean {
  const L = parseValues(line, plainAsValues);
  // A range counts as two values: one end of it is never a value of its own.
  if (L.slots.length < 2 && !L.slots.some((s) => s.value.includes("-"))) return true;
  const lineHasLetterLabels = bindingTokens(line, plainAsValues).tokens.some((t) => "word" in t && /^[A-Z]$/.test(t.word));
  const S = parseValues(sentence, plainAsValues, lineHasLetterLabels);
  if (S.slots.length === 0) return true;
  // A multi-value sentence's header must be the line's header (a single-value
  // sentence's header words are checked against the value's own label below).
  if (S.slots.length > 1 && !allMatch(S.header, L.header)) return false;
  if (S.slots.length > 1) {
    const lineSeq = L.slots.map((s) => s.value);
    const said = S.slots.map((s) => s.value);
    const contiguous = lineSeq.some((_, i) => said.every((v, j) => lineSeq[i + j] === v));
    if (!contiguous) return false;
  }
  const single = S.slots.length === 1;
  return S.slots.every((s) => {
    const words = single ? [...S.header, ...s.before, ...s.after, ...s.units] : [...s.own, ...s.units];
    return L.slots.some((l) => {
      if (l.value !== s.value) return false;
      if (!allMatch(words, [...l.own, ...l.units, ...L.header])) return false;
      const label = meaningful(l.own).length > 0 ? meaningful(l.own) : meaningful(l.units);
      if (!meaningful(words).some((w) => label.some((a) => wordMatches(w, a)))) return false;
      if (!l.required.every((r) => words.some((w) => wordMatches(w, r)))) return false;
      // Ambiguous line: each word stays on its own side of the value.
      if (L.ambiguous && !(allMatch([...S.header, ...s.before], [...l.before, ...L.header]) && allMatch(s.after, [...l.after, ...l.units]))) return false;
      return true;
    });
  });
}

/** True unless the sentence ties a value to label words the line ties to a
 *  different value. Lines with fewer than two values are unaffected. Plain
 *  numbers on a line that also has marked values are read both ways. */
function figuresBoundToLabels(sentence: string, line: string): boolean {
  if (!boundUnder(sentence, line, false)) return false;
  return parseValues(line, false).plain || parseValues(sentence, false).plain ? boundUnder(sentence, line, true) : true;
}

/** The whole source lines (joined by one space) of the quote that contain
 *  the sentence as a contiguous span, when the sentence equals that span
 *  except for whitespace and line breaks — same case, words, figures and
 *  punctuation, starting and ending on word boundaries. A trailing period
 *  the answer adds to end its sentence is not part of the span. */
function verbatimSpanLines(sentence: string, quote: string, page?: string): string | undefined {
  const target = sentence.replace(/\s+/g, " ").trim().replace(/(?<=[^.])\.$/, "");
  if (!target) return undefined;
  const lines = quote.split("\n");
  // Joined text with each character mapped back to its line.
  let joined = "";
  const lineOf: number[] = [];
  const lineStart = new Map<number, number>();
  const lineEnd = new Map<number, number>();
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) return;
    if (joined) { joined += " "; lineOf.push(i); }
    lineStart.set(i, joined.length);
    for (const ch of line) { joined += ch; lineOf.push(i); }
    lineEnd.set(i, joined.length);
  });
  const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
  // Review B1: only a sentence wrapped onto continuation lines may be joined
  // — each later line opens in lower case (not a list item) and the line
  // above does not end a sentence; a new table row never continues one.
  const listItem = /^\s*\(?(?:\d+|[a-z]|[ivxlc]+)[).]\s/i;
  // Fourth review: ":" is never a sentence end here (a label line ends in
  // ":"); a line opening with a figure continues only an open phrase
  // ("payable up to / $5,000 per pregnancy.").
  const endsSentence = (l: string) => /[.;!?]["'’”)\]]*\s*$/.test(l);
  const openPhrase = /\b(?:up to|of|is|are|maximum|max|to|at|than|per|from|limit(?:ed to)?)\s*$/i;
  const continues = (k: number) =>
    !listItem.test(lines[k]) &&
    !endsSentence(lines[k - 1]) &&
    (/^\s*(?:[a-z]|\([a-z])/.test(lines[k]) || (/^\s*\$?\d/.test(lines[k]) && openPhrase.test(lines[k - 1].trim())));
  for (let at = joined.indexOf(target); at >= 0; at = joined.indexOf(target, at + 1)) {
    const end = at + target.length;
    if (isWordChar(joined[at - 1]) && isWordChar(joined[at])) continue;
    if (isWordChar(joined[end - 1]) && isWordChar(joined[end])) continue;
    // Review B2: never start or end inside a number ("$1,000" in "$1,000,000").
    if (/^[.,]\d/.test(joined.slice(end)) || /\d[.,]$/.test(joined.slice(0, at))) continue;
    const first = lineOf[at];
    const last = lineOf[end - 1];
    if (first === last) continue; // one line: the line rule already decided
    let wrapped = true;
    for (let k = first + 1; k <= last; k++) if (lines[k].trim() && !continues(k)) wrapped = false;
    if (!wrapped) continue;
    // Third review (N1): the span must be a whole sentence on the PAGE — the
    // model can cite exactly two lines of a table, so the cited quote alone
    // cannot show that "$30 copay / emergency room" are two rows.
    const startsHere = at === lineStart.get(first) || endsSentence(joined.slice(lineStart.get(first), at));
    const endsHere = end === lineEnd.get(last) || /[.;!?]$/.test(joined.slice(at, end)) || /^\s*[.;!?]/.test(joined.slice(end));
    if (!startsHere || !endsHere) continue;
    const spanned = lines.slice(first, last + 1).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Reaching the line end apart from trailing punctuation counts as the end.
    const toLineEnd = /^[\s.,;:!?"'’”)\]]*$/.test(joined.slice(end, lineEnd.get(last)));
    if (!wholeSentenceOnPage(spanned, at === lineStart.get(first), toLineEnd, page)) continue;
    return spanned.join(" ");
  }
  return undefined;
}

/** The spanned lines are one whole sentence on the page: the line before
 *  them does not run on into the first, and the last does not run on into
 *  the next (a following line opening in lower case or with a figure
 *  continues the sentence or the row). Every occurrence on the page must
 *  pass; a span not found on the page fails (fail-closed). */
function wholeSentenceOnPage(spanned: string[], fromLineStart: boolean, toLineEnd: boolean, page: string | undefined): boolean {
  if (page === undefined) return false;
  const pageLines = page.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const ends = (l: string) => /[.;!?]["'’”)\]]*$/.test(l); // ":" is a label, not an end
  const runsOn = (l: string) => /^(?:[a-z]|\([a-z]|\$?\d)/.test(l);
  const opensWithFigure = (l: string) => /^\$?\d/.test(l);
  let found = false;
  for (let i = 0; i + spanned.length <= pageLines.length; i++) {
    if (!spanned.every((l, j) => pageLines[i + j] === l)) continue;
    found = true;
    const prev = pageLines[i - 1];
    const next = pageLines[i + spanned.length];
    if (fromLineStart && prev !== undefined && !ends(prev) && runsOn(spanned[0])) return false;
    if (toLineEnd && next !== undefined && !ends(spanned[spanned.length - 1]) && runsOn(next)) return false;
    // A figure on the next line belongs to this row whatever ends the line.
    if (toLineEnd && next !== undefined && opensWithFigure(next)) return false;
  }
  return found;
}

/** The cited quote that covers a sentence, or undefined. Review 2026-11-21
 *  (B1): coverage keeps meaning — the covering source line (or, failing
 *  that, the whole quote) must state exactly the sentence's negation,
 *  exception and network markers ("Dental is covered" is not covered by
 *  "Dental treatment is not covered"). Fail-closed: a long quote whose
 *  markers differ from the sentence covers it only line by line. */
function coveringQuote(sentence: string, canonicalQuotes: string[], quotePages: (string | undefined)[] = []): string | undefined {
  const normSentence = normalizeForClaim(sentence);
  if (!normSentence) return undefined;
  const statesFigure = figuresOf(sentence).length > 0;
  for (const [qi, quote] of canonicalQuotes.entries()) {
    // The covering LINE is returned, so the sentence's figures are checked
    // against that line only (follow-up review: no borrowing a figure from
    // another line of the same quote).
    const line = clausesOf(quote).find(
      (l) => tokensCovered(normSentence, l) && sameMarkers(sentence, l) && figuresBoundToLabels(sentence, l),
    );
    if (line) return line;
    // A sentence spread over several lines is covered by the whole quote
    // only when it states no figure.
    if (!statesFigure && tokensCovered(normSentence, quote) && sameMarkers(sentence, quote)) return quote;
    // Owner decision 2026-11-22: a figure sentence that is the quote's own
    // wording across line breaks — identical except whitespace — is covered
    // by the whole lines it spans (figures stay bound to their labels).
    if (statesFigure) {
      const block = verbatimSpanLines(sentence, quote, quotePages[qi]);
      if (block !== undefined && sameMarkers(sentence, block) && figuresBoundToLabels(sentence, block)) return block;
    }
  }
  return undefined;
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
  const quotePages: string[] = [];
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
    // Owner decision 2026-11-21: the SAME strict verbatim rule as every other
    // citation check (verifyEvidenceCitation: exact, unique, contiguous;
    // whitespace and line wraps normalized, punctuation and wording not).
    const strict = verifyEvidenceCitation(
      [{ documentId: doc.documentId, pageCount: doc.pages.length, pages: doc.pages }],
      citation,
    );
    if (!strict.ok) {
      return { ok: false, rationale: `Citation not found in source page: ${citation.documentId} p${citation.page}` };
    }
    canonicalQuotes.push(strict.quote);
    quotePages.push(pageText);
  }

  // (a) Every substantive generated sentence must be covered by >=1 citation.
  // A sentence that states a figure is always checked, whatever its length,
  // and each figure must equal (whole value) a figure of a cited passage:
  // "Annual maximum $2,000,000" against "$1,000,000" fails; token substring
  // coverage alone would accept "100" inside "1000000" (2026-11-21).
  // Review B1/S8: a short sentence is skipped only when it states neither a
  // figure nor coverage; figures must come from the COVERING passage.
  const sentences = splitSentences(answerText);
  for (const sentence of sentences) {
    const figures = figuresOf(sentence);
    // No short-sentence skip (confirmation review: "Dental is free." must not
    // pass against "not covered"); only a sentence with no word of more than
    // two characters and no figure is non-substantive.
    if (figures.length === 0 && !normalizeForClaim(sentence).split(/\s+/).some((t) => t.length > 2)) continue;
    const quote = coveringQuote(sentence, canonicalQuotes, quotePages);
    const quoteFigures = new Set(quote ? figuresOf(quote) : []);
    if (figures.some((f) => !quoteFigures.has(f))) {
      return { ok: false, rationale: `Unsupported claim: figure not in the covering passage` };
    }
    if (!quote) {
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
