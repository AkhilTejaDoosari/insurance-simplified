// Summary of Benefits and Coverage (SBC) reader.
//
// The SBC is a federally standardized form: its header, its "Important
// Questions" and their explanations, the cost chart and the closing notices
// use the same words for every insurer. Everything here relies on that fixed
// wording only — never on an insurer, plan or document name — and abstains
// when the wording is not found exactly.

/** Whitespace, hyphens, apostrophes and "&" as the form means them. Used for
 *  recognition only; names and quotes stay verbatim. */
function norm(text: string): string {
  return text
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

const linesOf = (page: string) => page.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const count = (text: string, re: RegExp) => (text.match(new RegExp(re.source, "gi")) ?? []).length;

const TITLE = "Summary of Benefits and Coverage: What this Plan Covers and What (?:You Pay for Covered Services|it Costs)";
const DATE = "\\d{1,2}/\\d{1,2}/\\d{2,4}";
const PERIOD = `Coverage Period:? (?:beginning on or after )?${DATE}(?: ?(?:-|to|through) ?${DATE})?`;
/** The whole title line: the form's title and at most its coverage period.
 *  Any other text on the line may be part of a name: not this line. */
const TITLE_LINE = new RegExp(`^${TITLE}(?: ${PERIOD})?$`, "i");
const PERIOD_LINE = new RegExp(`^${PERIOD}$`, "i");
/** "Coverage for: <who> | Plan Type: <one word>", nothing else. */
const COVERED = "(?:individual|family|self|only|plus|one|employee|single|couple|spouse|child|children|dependents?|student|eligible|all|coverage|types|tiers|two|person|member|and|or|[+/,])";
const COVERAGE_FOR_TAIL = `Coverage for: ?${COVERED}(?: ?${COVERED})* ?\\| ?Plan Type: ?[A-Za-z0-9+/-]{2,12}`;
const COVERAGE_FOR_LINE = new RegExp(`^(?<name>.*?) ?${COVERAGE_FOR_TAIL}$`, "i");
const INTRO = /^The Summary of Benefits and Coverage \(SBC\) document will help you choose\b/i;
const QUESTIONS = /^Important Questions\b/i;
/** The one sentence insurers print under the name. It names the insurer. */
const UNDERWRITER_LINE = /^All plans offered and underwritten by [A-Z][A-Za-z.,' -]{2,80}$/i;
const PAGE_LINE = /^page \d+ of \d+$/i;
const FORM_ID_LINE = /^[A-Z]{1,5}-\d{3,}(?:-\d+)?$/;

// ------------------------------------------------------------------- names

const PLAN_TYPE = "(?:PPO|HMO|EPO|POS|HDHP|HSA|HRA|CDHP|CDH)";
const PLACEHOLDER =
  /\b(?:samples?|examples?|fictional|fictitious|illustrat\w*|hypothetical|dummy|placeholder|template|draft|proposed|specimen)\b|\bInsurance Company\b|\bPlan (?:Name|Option)\b|\bXYZ\b|[<>{}[\]$%?!#@•*_…|]|https?:|www\.|\.(?:com|org|net|gov)\b|\d{3}-\d{4}|:\/\//i;
/** Wording of a list of plans, or of a relation between plans. */
const SEVERAL = /\s[/+]\s|,|;|\b(?:and|or|vs\.?|versus|replaces|formerly|all|any|plans|options)\b/i;
const METAL = /\b(?:platinum|gold|silver|bronze)\b/gi;
/** Organisations, places and people: who a plan is for, never a plan. */
const NOT_A_PRODUCT =
  /\b(?:city|county|state|town|township|village|district|schools?|university|college|corporation|corp|company|inc|llc|ltd|association|insurance|assurance|insurers?|holdings|underwriters|administrators|employees?|retirees?|members?|group|sponsor|employer|confidential|proprietary|effective|customer|service|questions)\b/i;
const GENERIC_WORDS =
  /^(?:(?:the|an?|of|for|with|health|medical|insurance|benefits?|coverage|care|plan|option|individual|family|employee|student|self|only|single|type|tier|base|standard|high|low|deductible|network|in-network|consumer|directed|ppo|hmo|epo|pos|hdhp|hsa|hra|cdhp|cdh|gold|silver|bronze|platinum|\d+)[\s:/+-]*)+$/i;
/** Words that introduce a field or a notice, never an insurer. */
const FIELD_LABEL =
  /^(?:plan|policy|group|insurer|issuer|employer|carrier|sponsor|plan sponsor|plan name|customer service|questions?|phone|tel|call|effective(?: date)?|coverage(?: period| for)?|español|spanish|note|notice|important|for|date|contact|administered by|underwritten by)$/i;
const NOT_AN_INSURER =
  /\b(?:administrators?|administered|underwritten|prepared|location|division|region|tty|compare|network|providers?|customer|service|phone|fax|web|claims|copy)\b|^(?:medical|dental|vision|pharmacy|health|benefits?)$/i;
const MAX_NAME = 100;

/** A plan part that names one product. */
function productPart(text: string): boolean {
  if (!/[A-Za-z]{2}/.test(text) || /[.,:;&/-]$/.test(text) || /\(\s*[^)]*$/.test(text) || /\b(?:with|of|for|and|the)$/i.test(text)) return false;
  if (SEVERAL.test(text) || (text.match(METAL) ?? []).length > 1) return false;
  if ((text.match(/\d/g) ?? []).length * 2 > text.replace(/\s/g, "").length) return false;
  if (NOT_A_PRODUCT.test(text)) return false;
  return text.split(/\s+/).length <= 10;
}

/** The plan the header prints, verbatim, or undefined.
 *  1. "<insurer>: <plan>" — the form's own shape;
 *  2. without an insurer (a logo, or ": <plan>"): only a name that carries a
 *     plan type and at least one word that is not generic, ending in "Plan". */
function planName(raw: string): string | undefined {
  const text = raw.trim().replace(/^:\s*/, "");
  if (!text || text.length > MAX_NAME || /\s{2,}/.test(text) || PLACEHOLDER.test(text)) return undefined;
  const colon = text.indexOf(":");
  if (colon >= 0) {
    const issuer = text.slice(0, colon).trim();
    const plan = text.slice(colon + 1).trim();
    if (plan.includes(":") || !/^[A-Z][A-Za-z.,'’& -]{2,60}$/.test(issuer) || FIELD_LABEL.test(issuer) || NOT_AN_INSURER.test(issuer)) return undefined;
    if (issuer.toLowerCase() === plan.toLowerCase()) return undefined;
    return productPart(plan) ? text : undefined;
  }
  if (GENERIC_WORDS.test(text) || !productPart(text)) return undefined;
  const typed = new RegExp(`\\b${PLAN_TYPE}\\b`).test(text);
  return typed && /\bPlan$/.test(text) && /^[A-Z]/.test(text) ? text : undefined;
}

// ------------------------------------------------------------------ header

interface Header { name: string; quote: string; scope: string }

/** The header block of an SBC's first page. `scope` is everything the block
 *  says besides the name (who is covered, plan type, period). */
function readHeader(page: string): Header | undefined {
  const raw = linesOf(page);
  const lines = raw.map(norm);
  const at = lines.findIndex((l) => TITLE_LINE.test(l));
  if (at < 0) return undefined;
  const stop = lines.findIndex((l, i) => i > at && (INTRO.test(l) || QUESTIONS.test(l)));
  if (stop < 0) return undefined;
  // Above the title: page number, form ids, the covered-for line, and the
  // form's own introduction. Anything else may be part of the name.
  const introAt = lines.findIndex((l, i) => i < at && INTRO.test(l));
  const above = lines.slice(0, introAt < 0 ? at : introAt);
  const coveredAbove = above.filter((l) => COVERAGE_FOR_LINE.exec(l)?.groups?.name === "");
  if (above.some((l) => !PAGE_LINE.test(l) && !FORM_ID_LINE.test(l) && !coveredAbove.includes(l))) return undefined;
  // Below it: an optional period, the name line, optionally the underwriter.
  let i = at + 1;
  const periods: string[] = [lines[at]];
  if (PERIOD_LINE.test(lines[i])) periods.push(lines[i++]);
  if (i >= stop) return undefined;
  const marked = COVERAGE_FOR_LINE.exec(lines[i]);
  if (count(lines[i], /Coverage for ?:/) > 1 || count(lines[i], /Plan Type/) > 1) return undefined;
  // With "Coverage for" above the title, the name line stands alone and must
  // open with the form's colon (its insurer is a logo).
  if (!marked && (coveredAbove.length !== 1 || !/^:\s*\S/.test(lines[i]))) return undefined;
  if (marked && coveredAbove.length > 0) return undefined;
  const rest = lines.slice(i + 1, stop);
  if (rest.length > 1 || rest.some((l) => !UNDERWRITER_LINE.test(l))) return undefined;
  const printed = marked ? raw[i].slice(0, raw[i].search(/Coverage\s+for:/i)) : raw[i];
  const name = planName(printed);
  if (!name) return undefined;
  const scope = [...periods, marked ? lines[i].slice(lines[i].search(/Coverage for:/i)) : coveredAbove[0]].join(" | ").toLowerCase();
  return { name, quote: raw[i], scope };
}

// ---------------------------------------------------------------- document

/** Whole federal sentences or heading pairs; a page that merely mentions the
 *  form is not part of it. */
const FORM_PARTS: readonly (readonly RegExp[])[] = [
  [/Important Questions Answers/i, /What is the overall deductible ?\?/i],
  [/Services You May Need/i, /You will pay the least/i, /You will pay the most/i],
  [/Excluded Services and Other Covered Services ?:/i, /Services Your Plan Generally Does NOT Cover/i],
  [/Your Rights to Continue Coverage ?: There are agencies that can help/i],
  [/Your Grievance and Appeals Rights ?: There are agencies that can help/i],
  [/About these Coverage Examples ?:/i, /This is not a cost estimator/i],
];
const isFormPage = (text: string) => FORM_PARTS.some((part) => part.every((re) => re.test(text)));
const NOTICE =
  /civil rights laws|language assistance|Interpreter Services|Notice of Nondiscrimination|Glossary of Health Coverage and Medical Terms/i;
/** A closing notice states no benefit: no amount and no cost word. */
const isNotice = (text: string) => NOTICE.test(text) && !/[$%]|copay|coinsurance|deductible|certificate of|policy name|plan name/i.test(text);

/** True when page 1 is the first page of an SBC form: its title opens a line
 *  and its questions table is on the page. */
export function isSbcDocument(pages: readonly string[]): boolean {
  const lines = linesOf(pages[0] ?? "").map(norm);
  const title = new RegExp(`^${TITLE}\\b`, "i");
  const opens = lines.some((l, i) => title.test(l) || (/^Summary of Benefits and Coverage:/i.test(l) && title.test(`${l} ${lines[i + 1] ?? ""}`)));
  return opens && /Important Questions Answers Why This Matters/i.test(lines.join(" "));
}

/** The plan an SBC document is for. The whole file must be ONE SBC: every
 *  page is a part of the form or a closing notice without amounts, the form's
 *  once-only parts appear once, and every covered-for line and title is the
 *  same. A file that also holds another SBC, a certificate or a guide proves
 *  no single plan. */
export function sbcPlan(pages: readonly string[]): { name: string; quote: string } | undefined {
  if (!isSbcDocument(pages)) return undefined;
  const header = readHeader(pages[0]);
  if (!header) return undefined;
  const normed = pages.map(norm);
  if (!normed.every((p) => isFormPage(p) || isNotice(p))) return undefined;
  if (new Set((normed.join(" ").match(new RegExp(PERIOD, "gi")) ?? []).map((t) => t.toLowerCase())).size > 1) return undefined;
  const all = normed.join(" ");
  for (const once of [/Important Questions/, /document will help you choose a health plan/, /What is the overall deductible ?\?/, /Your Rights to Continue Coverage: There are agencies/]) {
    if (count(all, once) > 1) return undefined;
  }
  const loose = "Summary of Benefits (?:and )?Coverage:? ?What this Plan Covers";
  const coveredFor = new Set<string>();
  for (const [index, page] of pages.entries()) {
    const lines = linesOf(page).map(norm);
    // A repeated title must be followed by the same name line.
    if (index > 0 && lines.some((l, k) => TITLE_LINE.test(l) && lines[k + 1] !== norm(header.quote))) return undefined;
    for (const line of lines) {
      if (/Coverage for ?:/i.test(line)) coveredFor.add(line.toLowerCase());
      if (new RegExp(loose, "i").test(line) && !TITLE_LINE.test(line)) return undefined;
    }
    // A title that wraps over lines is not a title line anywhere above.
    if (count(norm(page), new RegExp(loose)) !== lines.filter((l) => TITLE_LINE.test(l)).length) return undefined;
    const titles = lines.filter((l) => TITLE_LINE.test(l));
    if (titles.length > 1 || titles.some((t) => !header.scope.startsWith(t.toLowerCase()))) return undefined;
  }
  return coveredFor.size === 1 ? { name: header.name, quote: header.quote } : undefined;
}

/** A page span [start, end). */
interface PageSpan { start: number; end: number }

/** The form's coverage examples ("Peg is Having a Baby"): invented patients,
 *  never the plan's own terms. */
const EXAMPLES_HEADING = /(?<=^|\n)[ \t]*About these Coverage Examples\s*:/i;
const EXAMPLE_MARK = /\bThis EXAMPLE event includes\b|\bTotal Example Cost\b|\bthese EXAMPLE covered services\b|\bIn this example,\s+(?:Peg|Joe|Mia)\b/i;
/** Parts of the form that are not examples. */
const OTHER_PART = /\bImportant Questions\b|\bCommon\s+Medical\b|\bExcluded Services\b|\bYour Rights to Continue Coverage\b/i;

/** Coverage-example text per 1-based page. The whole page, unless another
 *  part of the form is printed on it: then from the examples' heading on. */
export function coverageExampleSpans(pages: readonly string[]): Map<number, PageSpan[]> {
  const out = new Map<number, PageSpan[]>();
  const sbc = isSbcDocument(pages);
  pages.forEach((page, i) => {
    const heading = EXAMPLES_HEADING.exec(page);
    if (sbc) {
      if (!heading && !EXAMPLE_MARK.test(page)) return;
      const start = heading && OTHER_PART.test(page.slice(0, heading.index)) ? heading.index : 0;
      out.set(i + 1, [{ start, end: page.length }]);
    } else if (heading && /This is not a cost estimator/i.test(norm(page))) {
      // Another document holding the form's examples: from their heading on.
      out.set(i + 1, [{ start: heading.index, end: page.length }]);
    }
  });
  return out;
}

/** True when the page text runs cell by cell: the limitation sentence every
 *  SBC prints (it always wraps) is contiguous in the text. */
export function readsCellByCell(pages: readonly string[]): boolean {
  return pages.some((page) =>
    /You may have to pay for services that aren't preventive\. Ask your provider if the services (?:you need|needed) are preventive\. Then check what your plan will pay for\./i.test(norm(page)));
}

const OTHER_COVERED = /Other\s+Covered\s+Services\s*\(Limitations\s+may\s+apply/i;
const RIGHTS = /Your\s+Rights\s+to\s+Continue\s+Coverage|Your\s+Grievance\s+and\s+Appeals\s+Rights/i;

/** Text of an SBC the line reader never reads: the whole form except its
 *  "Other Covered Services" list. Facts of the form come from its own
 *  structure (header, questions, chart). Pages that are not part of the form
 *  are untouched. */
export function sbcOwnedSpans(pages: readonly string[]): Map<number, PageSpan[]> {
  const out = new Map<number, PageSpan[]>();
  if (!isSbcDocument(pages)) return out;
  pages.forEach((page, i) => {
    const text = norm(page);
    if (i > 0 && !isFormPage(text) && !isNotice(text)) return;
    const list = OTHER_COVERED.exec(page);
    if (!list) {
      out.set(i + 1, [{ start: 0, end: page.length }]);
      return;
    }
    const rights = RIGHTS.exec(page.slice(list.index));
    const end = rights ? list.index + rights.index : page.length;
    // The list's own heading line is form text.
    const bodyAt = page.indexOf("\n", list.index);
    out.set(i + 1, [{ start: 0, end: bodyAt < 0 ? page.length : bodyAt + 1 }, { start: end, end: page.length }]);
  });
  return out;
}

/** Pages of the form's cost chart (1-based). */
export function sbcChartPages(pages: readonly string[]): Set<number> {
  return new Set(isSbcDocument(pages) ? pages.flatMap((p, i) => (/Services You May Need/i.test(norm(p)) ? [i + 1] : [])) : []);
}

/** "sbc-student" when the form's own header says the plan is for students. */
export function sbcFormOf(pages: readonly string[]): "sbc" | "sbc-student" | undefined {
  if (!isSbcDocument(pages)) return undefined;
  const top = norm(linesOf(pages[0]).slice(0, 20).join(" ")).split(/Important Questions/i)[0];
  return /\bstudents?\b/i.test(top) ? "sbc-student" : "sbc";
}
