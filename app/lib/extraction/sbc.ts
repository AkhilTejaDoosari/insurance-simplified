// Summary of Benefits and Coverage (SBC) reader.
//
// The SBC is a federally standardized form: its header, its "Important
// Questions" and their explanations, the cost chart and the closing notices
// use the same words for every insurer. Everything here relies on that fixed
// wording only — never on an insurer, plan or document name — and abstains
// when the wording is not found exactly.

/** The form's title line. Older editions end "…& What it Costs". */
const HEADER =
  /^Summary of Benefits and Coverage:\s+What this Plan Covers\s+(?:&|and)\s+What (?:You Pay for Covered Services|it Costs)\b/i;
/** Header, possibly wrapped over a second line. */
const HEADER_START = /^Summary of Benefits and Coverage:\s+What this Plan Covers\b/i;
const INTRO_START = /^The Summary of Benefits and Coverage \(SBC\) document will help you choose\b/i;
const QUESTIONS_START = /^Important Questions\b/i;
const COVERAGE_FOR = /\bCoverage\s+for:/i;
const COVERAGE_PERIOD_TAIL = /\s*\bCoverage Period:.*$/i;
/** Lines of the header block that are never part of a plan name. */
const FURNITURE =
  /^(?:page\s+\d+(?:\s+of\s+\d+)?|coverage period\b.*|plan type\b.*|\d{1,2}\/\d{1,2}\/\d{2,4}.*|all (?:plans|coverage)\b.*\b(?:offered|underwritten|provided|administered)\b.*|(?:offered|underwritten|administered|insured|sponsored) by\b.*|[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+[A-Z0-9-]*)$/i;
const NOT_A_NAME =
  /\b(?:samples?|examples?|fictional|fictitious|illustrat\w*|hypothetical|dummy|placeholder|template)\b|\bInsurance Company \d|\[[^\]]*\]|[$%?!]|https?:|www\./i;
/** Words that describe a kind of plan and identify none. */
const GENERIC_WORDS =
  /^(?:(?:the|a|and|or|health|medical|insurance|benefits?|coverage|plan|plans|option|ppo|hmo|epo|pos|hdhp|hsa|cdhp|individual|family|group|employee|student|self|only|single|type|summary|of)[\s:|/+&-]*)+$/i;
const MAX_NAME = 120;

export interface SbcHeader {
  /** The plan as printed ("Insurer: Plan"), or undefined when unclear. */
  name?: string;
  /** The verbatim page line holding the name. */
  quote?: string;
}

const linesOf = (page: string) => page.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function cleanName(raw: string): string | undefined {
  const name = raw.replace(/\s+/g, " ").replace(/^[\s:|–-]+/, "").replace(/[\s|–-]+$/, "").trim();
  if (name.length < 3 || name.length > MAX_NAME) return undefined;
  // "Insurer:" with nothing after the colon names no plan.
  if (/[:.,;]$/.test(name) || !/[A-Za-z]{2}/.test(name)) return undefined;
  if (NOT_A_NAME.test(name) || GENERIC_WORDS.test(name)) return undefined;
  return name;
}

/** The SBC header block of a page, or undefined when the page has none. A
 *  page is an SBC start only with the form's own title line AND either its
 *  introduction or its questions heading; a continuation page may repeat the
 *  title. `name` is present only when exactly one plan name is printed. */
export function readSbcHeader(page: string): SbcHeader | undefined {
  const lines = linesOf(page);
  const at = lines.findIndex((line, i) => HEADER.test(line) || (HEADER_START.test(line) && HEADER.test(`${line} ${lines[i + 1] ?? ""}`)));
  if (at < 0) return undefined;
  const titleEnd = HEADER.test(lines[at]) ? at + 1 : at + 2;
  const stop = lines.findIndex((line, i) => i >= titleEnd && (INTRO_START.test(line) || QUESTIONS_START.test(line)));
  const end = stop < 0 ? Math.min(lines.length, titleEnd + 6) : stop;
  const block = lines.slice(titleEnd, end)
    .map((line) => ({ line, text: line.replace(COVERAGE_PERIOD_TAIL, "").trim() }))
    .filter(({ text }) => text && !FURNITURE.test(text));
  const marked = block.flatMap(({ text }, i) => (COVERAGE_FOR.test(text) ? [i] : []));
  if (marked.length > 1) return {};
  if (marked.length === 1) {
    const [i] = marked;
    // Anything printed after the "Coverage for … | Plan Type …" line may
    // continue the name: unclear.
    if (stop >= 0 && i !== block.length - 1) return {};
    // A name that wraps over lines has no single verbatim line to cite, and
    // half of it would be a different name: unclear.
    if (i !== 0) return {};
    const name = cleanName(block[0].text.slice(0, block[0].text.search(COVERAGE_FOR)));
    return name ? { name, quote: block[0].line } : {};
  }
  // "Coverage for" was printed elsewhere: the only other line of the block.
  if (stop < 0 || block.length !== 1) return {};
  const name = cleanName(block[0].text);
  return name ? { name, quote: block[0].line } : {};
}

/** True when the document's first page is an SBC. */
export function isSbcDocument(pages: readonly string[]): boolean {
  const first = pages[0] ?? "";
  return readSbcHeader(first) !== undefined && linesOf(first).some((l) => QUESTIONS_START.test(l));
}

/** The plan an SBC document is for. Page 1 must be an SBC that prints exactly
 *  one plan name; a later page that starts an SBC for another plan, or for a
 *  plan whose name cannot be read, makes the whole document unclear. */
export function sbcPlan(pages: readonly string[]): { name: string; quote: string } | undefined {
  if (!isSbcDocument(pages)) return undefined;
  const first = readSbcHeader(pages[0])!;
  if (!first.name || !first.quote) return undefined;
  for (const page of pages.slice(1)) {
    const later = readSbcHeader(page);
    if (!later) continue;
    if (later.name !== undefined && later.name.toLowerCase() !== first.name.toLowerCase()) return undefined;
    if (later.name === undefined && linesOf(page).some((l) => QUESTIONS_START.test(l))) return undefined;
  }
  return { name: first.name, quote: first.quote };
}
