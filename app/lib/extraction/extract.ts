// Extraction path: builds the comparison table (constitution principle II).
// This module MUST NOT be imported by the RAG path (app/lib/rag/*).
//
// Two engines, one output contract:
// - Deterministic fallback (default; no credentials needed): pattern-based
//   line matching against FACTS with qualifier-preserving displays.
// - LLM engine (opt-in via useLlm when configured): schema-constrained call
//   over safe-prompt-wrapped documents; output validated with validateTable.

import {
  purchaseAttested,
  validateTable,
  type CellValue,
  type ComparisonTable,
  type Qualifiers,
  type SelectionStatus,
  type TableRow,
  type WithheldClaim,
} from "@/app/lib/extraction/types";
import {
  FACTS,
  FACT_LIST_VERSION,
  VAGUE_PATTERNS,
  extractQualifiers,
  resolveFootnotes,
  withoutFootnoteMarkers,
} from "@/app/lib/extraction/fact-list";
import { wrapDocuments } from "@/app/lib/llm/safe-prompt";
import { completeJson } from "@/app/lib/llm/client";
import { stripNullProperties } from "@/app/lib/llm/json-schema";
import { COMPARISON_TABLE_SCHEMA } from "@/app/lib/extraction/llm-schema";
import { withEligibilityRow, contextFieldRulesOut } from "@/app/lib/extraction/eligibility";
import { interpretCoinsuranceShare } from "@/app/lib/extraction/coinsurance";
import { summarizeCareDisplay } from "@/app/lib/extraction/care-display";
import { summarizeRulesDisplay } from "@/app/lib/extraction/rules-display";
import { applyPremiumPersonalization } from "@/app/lib/extraction/premium";
import { SECTIONS } from "@/app/lib/extraction/sections";
import { hasSameScopeContradiction, applicabilityScopeKey, benefitScope, scopeSignature, SCOPE_KEYS } from "@/app/lib/extraction/contradictions";
import { attestedQualifiers, MATERIAL_QUALIFIERS, scopedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
export { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import {
  amounts,
  conditionBindingKnown,
  offersChoices,
} from "@/app/lib/extraction/conditions";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import { quoteInTable, tableClaims, tableDrops, tableOwnedSpans, unrecognizedLabelDrops, type TableDrop } from "@/app/lib/extraction/table-facts";
import { annotateAbsence, stripServerOnlyFields, WITHHELD_ROW_RATIONALE } from "@/app/lib/extraction/absence";
import type { PageReadability } from "@/app/lib/pdf/page-readability";
import { statementClaims, statementOwnedSpans } from "@/app/lib/extraction/statement-facts";
import { scanExclusionSections } from "@/app/lib/evidence/proposer/exclusion-sections";
import type { Span } from "@/app/lib/pdf/layout-tables";

const CARE_FACTS: ReadonlySet<string> = new Set(
  SECTIONS.find((s) => s.title === "Coverage")?.factNames ?? []
);
const RULES_FACTS: ReadonlySet<string> = new Set(
  SECTIONS.find((s) => s.title === "Limits & Risks")?.factNames ?? []
);
/** Benefit and cost facts: an item of an exclusions list states what is NOT
 *  covered and is never one of their values (owner decision 2026-11-21).
 *  The pre-existing-condition rule is commonly stated as an exclusion item
 *  and stays readable from one; Limits & Risks facts are unaffected. */
const BENEFIT_FACTS: ReadonlySet<string> = new Set(
  SECTIONS.filter((s) => s.title === "Coverage" || s.title === "My Costs")
    .flatMap((s) => s.factNames)
    .filter((name) => name !== "pre-existing-conditions"),
);

/** A label or heading with no value of its own ("Specialist", "REPATRIATION
 *  OF REMAINS", "EXCLUSIONS"): at most five words, no amount, percentage or
 *  digit, no "label: value" colon, and no word that states something.
 *  Never a value of any fact. */
const STATING_WORD = /\b(?:covered|not|no|none|nothing|yes|included|includes|excluded|exclud\w*|waived?|unlimited|paid|payable|pays?|free|in full|full (?:cost|amount|charges?|coverage)|required|requires?|needed|appl(?:y|ies|ied)|available|only|except|unless|subject|must|limit(?:s|ed)?|maximum|up to|same as|usual|customary|reasonable|renewable|worldwide|after|before (?:the |a |an )?(?:deductible|admission|treatment|surgery|coverage|services?)|once|twice|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:visits?|days?|times?|treatments?|sessions?|weeks?|months?|years?|per)|n\/a)\b/i;
/** Words that state coverage even in an ALL-CAPS line ("NOT COVERED"). */
const COVERAGE_WORD = /\b(?:covered|not|no|none|nothing|included|excluded|exclud\w*|waived?|unlimited|paid|payable|free)\b/i;
export function isValuelessLabel(line: string): boolean {
  // Figures are read on the RAW line: a glued digit may be a value
  // ("visits20"), not only a footnote marker (review S2).
  if (/[\d$%]/.test(line)) return false;
  const text = line.replace(/^\s*[•·▪\-–*]\s*/, "").replace(/:\s*$/, "").trim();
  // "Label: value" states its value after the colon.
  if (!text || /:\s*\S/.test(text)) return false;
  // Review N4: an ALL-CAPS line is a heading unless it states coverage.
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return !COVERAGE_WORD.test(text) && text.split(/\s+/).length <= 5;
  if (STATING_WORD.test(text)) return false;
  return text.split(/\s+/).length <= 5;
}
/** A value-less line naming a Coverage benefit ("Physical therapy"); a
 *  section heading ("SCHEDULE OF BENEFITS") names none. */
let careLabelPatterns: RegExp[] | undefined;
function namesABenefit(line: string): boolean {
  if (!isValuelessLabel(line)) return false;
  careLabelPatterns ??= FACTS.filter((f) => CARE_FACTS.has(f.name)).flatMap((f) => f.patterns.map((p) => new RegExp(p, "i")));
  return careLabelPatterns.some((re) => re.test(line));
}
/** Facts whose row is decided by a basis a footnote may state (per illness,
 *  per policy year, …): an unresolved footnote marker withholds the line. */
const BASIS_DEPENDENT_FACTS: ReadonlySet<string> = new Set(["annual-deductible", "per-illness-deductible", "policy-limit", "out-of-pocket-maximum"]);
/** Facts whose value IS a name ("Northwind PPO Network"): a short line
 *  without figures is their value, not a label. */
const NAME_VALUED_FACTS: ReadonlySet<string> = new Set(["network"]);
/** "<Term> means …": a definition names a term; it states no benefit. A
 *  line opening "This/That/It means" explains, and a definition carrying a
 *  figure states the value (review S3): neither is a definition here. */
const TERM_DEFINITION = /^\s*(?!(?:this|that|it|which|what)\s)["“]?[A-Z][\w’'&-]*(?:\s+[A-Za-z][\w’'&-]*){0,5}["”]?\s+means\b(?![^\n]*[$%])/i;

/** Page spans of the enumerated/bulleted items of every exclusion section,
 *  found structurally by the shared C1 scanner (heading grammar + list
 *  markers; framed/example sections yield nothing). */
export function exclusionItemSpans(doc: { pages: readonly string[] }): Map<number, Span[]> {
  const owned = new Map<number, Span[]>();
  for (const item of scanExclusionSections(doc.pages).items) {
    const spans = owned.get(item.page) ?? owned.set(item.page, []).get(item.page)!;
    spans.push({ start: item.markerStart, end: item.end });
  }
  return owned;
}

export interface ExtractInputDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
  tables?: LayoutTable[];
  /** Per-page readability from upload (absent on legacy sessions; derived
   *  from `pages` then). */
  readability?: PageReadability[];
}

/** Rationale for a row whose only statements of the fact were withheld. */
export const WITHHELD_RATIONALE = WITHHELD_ROW_RATIONALE;

function normalize(display: string): string {
  return display.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "");
}

function isVague(line: string): boolean {
  const lower = line.toLowerCase();
  return VAGUE_PATTERNS.some((p) => lower.includes(p));
}

// --- Unresolved cross-document disagreement (V1.1 M2 task 8) ---------------
// Two documents may state different values for the same fact in the same
// qualifier scope. That is never CONFLICTED (cross-document conflict is
// owner-approved protected semantics), but it also must not vanish silently:
// when plan identity does not explain the difference, the disagreement is
// reported with one citation per disagreeing document so a human can trace
// both sources. Differences between two attested, distinct plans are ordinary
// comparison data and are not reported.

export interface DisagreementSource {
  documentId: string;
  /** First-page citation of this document's value in the disputed scope. */
  page: number;
  quote: string;
  display: string;
}

export interface UnresolvedDisagreement {
  factName: string;
  /** Human-readable qualifier scope the disagreement lives in. */
  scope: string;
  /** One entry per disagreeing document, each with its own citation. */
  sources: DisagreementSource[];
}

function scopeLabel(value: { qualifiers: unknown; display?: unknown; evidence?: readonly unknown[] }): string {
  const q =
    typeof value.qualifiers === "object" && value.qualifiers !== null
      ? (value.qualifiers as Record<string, unknown>)
      : {};
  const parts = SCOPE_KEYS.filter((k) => typeof q[k] === "string" && q[k]).map(
    (k) => `${k}: ${String(q[k])}`
  );
  const implicit = benefitScope(value);
  if (implicit) parts.push(`scope: ${implicit}`);
  return parts.length > 0 ? parts.join(", ") : "document-wide";
}

/** Rows whose values disagree across documents in the same qualifier scope,
 *  with both sides' citations. Pure; never changes a verdict. */
export function unresolvedDisagreements(
  table: ComparisonTable
): UnresolvedDisagreement[] {
  const out: UnresolvedDisagreement[] = [];
  for (const row of table.rows) {
    if (row.values.length < 2) continue;
    // A genuine same-document contradiction is reported as CONFLICTED; do not
    // re-report it here as a cross-document disagreement.
    if (hasSameScopeContradiction(row.values)) continue;
    const scopes = new Map<
      string,
      { representative: (typeof row.values)[number]; byDoc: Map<string, (typeof row.values)[number]> }
    >();
    for (const value of row.values) {
      const sig = applicabilityScopeKey(value);
      let scope = scopes.get(sig);
      if (!scope) {
        scope = { representative: value, byDoc: new Map() };
        scopes.set(sig, scope);
      }
      if (!scope.byDoc.has(value.documentId)) scope.byDoc.set(value.documentId, value);
    }
    for (const { representative, byDoc } of scopes.values()) {
      // A different proven plan is ordinary comparison data. Partition first
      // instead of suppressing ALL disagreements when any pair differs.
      const byPlan = new Map<string, typeof row.values>();
      for (const value of byDoc.values()) {
        const planKey = value.planId || "__unattributed__";
        const group = byPlan.get(planKey) ?? [];
        group.push(value);
        byPlan.set(planKey, group);
      }
      for (const values of byPlan.values()) {
        if (values.length < 2 || new Set(values.map((v) => normalize(v.display))).size < 2) continue;
        const sources: DisagreementSource[] = [];
        for (const value of values) {
          const citation = value.evidence[0];
          if (!citation) continue;
          sources.push({
            documentId: value.documentId,
            page: citation.page,
            quote: citation.quote,
            display: value.display,
          });
        }
        if (sources.length < 2) continue;
        out.push({ factName: row.factName, scope: scopeLabel(representative), sources });
      }
    }
  }
  return out;
}

// --- Material condition bindings (V1.1 M2 task 5) -------------------------
// A material number must keep the conditions needed to understand it. When a
// display carries several amounts, each figure's type/scope must come from
// the source: an option set is labelled selectable, a labelled slice stays
// supported, and anything else is shown as unresolved rather than with an
// invented label. Selection state is derived, never model-asserted. The
// attribution rule itself lives in conditions.ts so the renderer asks the
// exact same question the extractor answers.

/** Currencies the document states explicitly. `$` stays implicit so existing
 *  qualifier payloads remain byte-identical; a stated non-default currency is
 *  recorded so it is never equated with a dollar figure. */
const STATED_CURRENCIES: readonly (readonly [RegExp, string])[] = [
  [/€|\bEUR(?=\s|\d)/i, "EUR"],
  [/£|\bGBP(?=\s|\d)/i, "GBP"],
  [/¥|\bJPY(?=\s|\d)/i, "JPY"],
  [/₹|\bINR(?=\s|\d)/i, "INR"],
  [/\bCAD\b|C\$(?=\s|\d)/i, "CAD"],
  [/\bAUD\b|A\$(?=\s|\d)/i, "AUD"],
];

const COST_TYPE_PHRASE =
  /\b(out-of-pocket maximum|out of pocket maximum|out-of-pocket limit|annual deductible|emergency room deductible|emergency deductible|deductible|premium|copayment|copay|coinsurance|lifetime maximum|maximum coverage|policy limit)\b/i;

function deriveCurrency(value: CellValue): string | undefined {
  const declared = value.qualifiers.currency;
  if (typeof declared === "string" && declared.trim()) return declared.trim();
  const text = [value.display, ...value.evidence.map((e) => e.quote)].join("\n");
  return STATED_CURRENCIES.find(([pattern]) => pattern.test(text))?.[1];
}

/** Retained only where one display holds several figures: a single amount's
 *  kind is already named by the row's fact. */
function deriveCostType(value: CellValue): string | undefined {
  if (amounts(value.display).length < 2) return undefined;
  // A cost word inside a condition ("not subject to coinsurance", "after
  // deductible") names what the amount is conditioned on, not what it is.
  const text = [value.display, ...value.evidence.map((e) => e.quote)].join("\n").replace(COST_CONDITION_PHRASE, " ");
  return COST_TYPE_PHRASE.exec(text)?.[0].toLowerCase();
}

const COST_CONDITION_PHRASE =
  /\b(?:not\s+subject\s+to|subject\s+to|after|before|in\s+addition\s+to|separate\s+from|waived|toward|towards|applies\s+to|apply\s+to)\s+(?:the\s+|a\s+|any\s+|applicable\s+|your\s+)?(?:calendar[-\s]year\s+|annual\s+)?(?:out[-\s]of[-\s]pocket\s+(?:maximum|limit)|deductibles?|coinsurance|copay(?:ment)?s?|premiums?|lifetime\s+maximum|policy\s+limit)\b/gi;

function deriveSelectionStatus(value: CellValue): SelectionStatus | undefined {
  const text = [value.display, ...value.evidence.map((e) => e.quote)].join("\n");
  if (purchaseAttested(value.evidence, value.display)) return "purchased";
  if (amounts(value.display).length < 2) return undefined;
  return offersChoices(value.display, text) ? "selectable" : undefined;
}

/** Bind source-attested conditions onto every value and downgrade any row
 *  whose figures cannot be attributed. Preserves display, evidence and the
 *  closed verdict vocabulary; never invents a label. */
export function applyConditionBindings<T extends ComparisonTable>(table: T): T {
  return {
    ...table,
    rows: table.rows.map((row) => {
      if (row.values.length === 0) return row;
      const values: CellValue[] = row.values.map((value) => {
        const currency = deriveCurrency(value);
        const costType = deriveCostType(value);
        const selectionStatus = deriveSelectionStatus(value);
        const qualifiers: Qualifiers = { ...value.qualifiers };
        if (currency !== undefined) qualifiers.currency = currency;
        if (costType !== undefined) qualifiers.costType = costType;
        if (selectionStatus !== undefined) qualifiers.selectionStatus = selectionStatus;
        return { ...value, qualifiers: scopedQualifiers({ ...value, qualifiers }) };
      });
      const unresolved = row.verdict === "SUPPORTED" || row.verdict === "CONFLICTED"
        ? values.some((value) => !conditionBindingKnown(value))
        : false;
      return unresolved
        ? {
            ...row,
            verdict: "NEEDS VERIFICATION" as const,
            rationale:
              "Several amounts appear without the conditions that identify which one applies; confirm the applicable figure against the source.",
            values,
          }
        : { ...row, values };
    }),
  };
}

interface TierHeader {
  page: number;
  lineIndex: number;
  tiers: string[];
  columnStarts: number[];
}

function detectTierHeaders(pageText: string, pageNum: number): TierHeader[] {
  const lines = pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const headers: TierHeader[] = [];
  const tierNamePattern = /\b(elite|select|budget|smart|lite|plus|platinum|gold|silver|bronze|basic|enhanced|premium|standard|choice|reliable|ultimate|supreme|premier)\b/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(tierNamePattern)];
    if (matches.length >= 2) {
      const tiers = matches.map(m => m[0]).filter((t, idx, arr) => arr.indexOf(t) === idx);
      if (tiers.length >= 2) {
        const columnStarts = tiers.map(tier => line.toLowerCase().indexOf(tier.toLowerCase()));
        headers.push({ page: pageNum, lineIndex: i, tiers, columnStarts });
      }
    }
  }
  return headers;
}

function parseTieredLine(
  line: string,
  header: TierHeader
): { tier: string; value: string }[] {
  const results: { tier: string; value: string }[] = [];
  const { tiers } = header;
  const sourceValues = line.match(
    /\$[\d,]+(?:\.\d+)?(?:\s*-\s*\$?[\d,]+(?:\.\d+)?)*(?:\s+per\s+(?:visit|day|month|year))?|\b\d+(?:\.\d+)?\s*%/gi
  ) ?? [];
  // A positional split is safe only when the source line supplies exactly one
  // explicit numeric value for each tier. Words and unrelated numbers must
  // never be distributed across tiers by token position.
  if (sourceValues.length !== tiers.length) return results;
  for (let i = 0; i < tiers.length; i++) {
    results.push({ tier: tiers[i], value: sourceValues[i] });
  }
  return results;
}

function findAllMatches(
  factPatterns: string[],
  pages: string[]
): { page: number; quote: string; qualifiers: Record<string, string> }[] {
  const regexes = factPatterns.map((p) => new RegExp(p, "i"));
  const results: { page: number; quote: string; qualifiers: Record<string, string> }[] = [];

  const tierHeadersByPage = new Map<number, TierHeader[]>();
  for (let i = 0; i < pages.length; i++) {
    tierHeadersByPage.set(i + 1, detectTierHeaders(pages[i], i + 1));
  }

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const lines = pages[pageIdx].split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const headers = tierHeadersByPage.get(pageNum) ?? [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (regexes.some((re) => re.test(line))) {
        const relevantHeader = headers.find(h => h.lineIndex < lineIdx && lineIdx - h.lineIndex <= 10);

        if (relevantHeader) {
          const hasValues = /\d/.test(line) || /\$/.test(line);

          if (hasValues) {
            const tierValues = parseTieredLine(line, relevantHeader);
            for (const { tier, value } of tierValues) {
              if (value) {
                const qualifiers = extractQualifiers(value);
                qualifiers.planTier = tier;
                results.push({ page: pageNum, quote: value, qualifiers });
              }
            }
          } else {
            for (let lookahead = 1; lookahead <= 3; lookahead++) {
              if (lineIdx + lookahead >= lines.length) break;
              const nextLine = lines[lineIdx + lookahead];
              if (/\d/.test(nextLine) || /\$/.test(nextLine)) {
                const tierValues = parseTieredLine(nextLine, relevantHeader);
                for (const { tier, value } of tierValues) {
                  if (value) {
                    const qualifiers = extractQualifiers(value);
                    qualifiers.planTier = tier;
                    results.push({ page: pageNum, quote: value, qualifiers });
                  }
                }
                break;
              }
            }
          }
        } else {
          const qualifiers = extractQualifiers(line);
          results.push({ page: pageNum, quote: line, qualifiers });
        }
      }
    }
  }
  return results;
}

/** Pre-compute tier headers for a document's pages. */
export function computeTierHeaders(pages: string[]): Map<number, TierHeader[]> {
  const tierHeadersByPage = new Map<number, TierHeader[]>();
  for (let i = 0; i < pages.length; i++) {
    tierHeadersByPage.set(i + 1, detectTierHeaders(pages[i], i + 1));
  }
  return tierHeadersByPage;
}

/** True when a values line starts with its own text label (a word of 3+
 *  letters before the first amount), e.g. "Emergency Medical Evacuation &
 *  Repatriation $250,000 …"; a bare values line ("$10 per visit …") has none. */
function hasOwnLabel(line: string): boolean {
  const lead = line.split(/[$\d]/)[0];
  return /[A-Za-z]{3,}/.test(lead);
}

/** Find all matching lines per fact per document, using pre-computed tier headers. */
/** P0-03 semantic guards for one fact (see FactDefinition). */
export interface FactGuards {
  name?: string;
  rejectWrappedFragments?: boolean;
  notUnderLabelPatterns?: string[];
  excludePatterns?: string[];
  requiredPatterns?: string[];
  governedPatterns?: { heading: string; line: string }[];
}

/** Sibling bullets skipped while looking up for a governing heading. */
const GOVERNED_MAX_BULLETS = 4;
const BULLET_LINE = /^\s*[•·▪\-–]/;

/** Index of the governing heading for a bullet line: the nearest non-bullet
 *  line above it, skipping at most GOVERNED_MAX_BULLETS sibling bullets. */
function governingHeadingIndex(lines: readonly string[], lineIdx: number): number | undefined {
  for (let i = lineIdx - 1, skipped = 0; i >= 0; i--) {
    if (!BULLET_LINE.test(lines[i])) return i;
    if (++skipped > GOVERNED_MAX_BULLETS) return undefined;
  }
  return undefined;
}

/** Lines that end a sentence (or a heading line ending in a colon). */
const ENDS_SENTENCE = /[.;:!?]["'’”)\]]*\s*$/;
/** A line opening in lower case (or "(" before a lower-case word)
 *  continues the line above; an enumerated item ("(55)", "(a)", "b.", "(iv)")
 *  never does. */
const LIST_ITEM = /^\s*\(?(?:\d+|[a-z]|[ivxlc]+)[).]\s/i;
const CONTINUES = { test: (line: string) => !LIST_ITEM.test(line) && /^\s*(?:[a-z]|\([a-z])/.test(line) };
/** Continuation lines read on each side of a matching line. */
const SENTENCE_MAX_LINES = 3;

/** The [start, end] line span of the sentence a line belongs to: back while
 *  the line continues the one above (lower-case start, the line above does
 *  not end a sentence), forward while the next line continues this one;
 *  bounded on each side. Headings and other sentences are never joined. */
function sentenceSpan(lines: readonly string[], idx: number): [number, number] {
  let start = idx;
  while (start > 0 && idx - start < SENTENCE_MAX_LINES && CONTINUES.test(lines[start]) && !ENDS_SENTENCE.test(lines[start - 1])) start--;
  let end = idx;
  while (end < lines.length - 1 && end - idx < SENTENCE_MAX_LINES && !ENDS_SENTENCE.test(lines[end]) && CONTINUES.test(lines[end + 1])) end++;
  return [start, end];
}

export function findAllMatchesWithHeaders(
  factPatterns: string[],
  pages: string[],
  tierHeadersByPage: Map<number, TierHeader[]>,
  guards: FactGuards = {},
): { page: number; quote: string; display?: string; qualifiers: Record<string, string>; notes?: string[]; unresolvedFootnote?: boolean }[] {
  const regexes = factPatterns.map((p) => new RegExp(p, "i"));
  const excludes = (guards.excludePatterns ?? []).map((p) => new RegExp(p, "i"));
  const requires = (guards.requiredPatterns ?? []).map((p) => new RegExp(p, "i"));
  const governed = (guards.governedPatterns ?? []).map((g) => ({ heading: new RegExp(g.heading, "i"), line: new RegExp(g.line, "i") }));
  // A line that names this fact's keyword but states a different concept is
  // never this fact; absence is honest, a neighbouring fact is not (P0-03).
  // When a line ends on a dangling basis ("… Deductible for each"), the
  // basis continues on the next line and must be read for the exclusion.
  const admissible = (line: string, next = "") => {
    const context = /\b(?:for each|per|each)\s*$/i.test(line) ? `${line} ${next}` : line;
    return !excludes.some((re) => re.test(context)) && (requires.length === 0 || requires.some((re) => re.test(line)));
  };
  const results: { page: number; quote: string; display?: string; qualifiers: Record<string, string>; notes?: string[]; unresolvedFootnote?: boolean }[] = [];
  const notUnderLabel = (guards.notUnderLabelPatterns ?? []).map((p) => new RegExp(p, "i"));

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const lines = pages[pageIdx].split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const headers = tierHeadersByPage.get(pageNum) ?? [];

    // Matchers read each line with its glued footnote markers resolved to
    // the page's own footnote text ("Deductible1" + "1 Per injury or
    // sickness"), or removed when unresolved; quotes and displays keep the
    // verbatim line, and a resolved footnote line is cited with the value.
    const footnoted = resolveFootnotes(lines);
    const matchLines = footnoted.map((f) => f.matchText);
    // Patterns may match either reading (the footnote text in place can
    // separate a label from its amount); guards always read matchLines, so
    // a footnote can still disqualify the line.
    const plainLines = lines.map(withoutFootnoteMarkers);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const matchLine = matchLines[lineIdx];
      const next = matchLines[lineIdx + 1] ?? "";
      // Review S7: a maximum directly under a value-less benefit label is
      // that benefit's sub-limit, not this fact.
      const plainLine = plainLines[lineIdx];
      if (guards.rejectWrappedFragments && /^\s*[a-z]/.test(line)) continue;
      if (lineIdx > 0 && notUnderLabel.some((re) => re.test(matchLine) || re.test(plainLine)) && namesABenefit(lines[lineIdx - 1])) continue;
      // Owner decision 2026-11-22 (blocker 1): a line naming a fact that
      // requires a restriction may state it on a wrapped line of the same
      // sentence; read the whole sentence and cite exactly its lines.
      if (
        requires.length > 0 &&
        regexes.some((re) => re.test(matchLine) || re.test(plainLine)) &&
        !requires.some((re) => re.test(matchLine)) &&
        !excludes.some((re) => re.test(matchLine))
      ) {
        const [start, end] = sentenceSpan(lines, lineIdx);
        if (end > start) {
          const sentence = matchLines.slice(start, end + 1).join(" ");
          if (requires.some((re) => re.test(sentence)) && !excludes.some((re) => re.test(sentence))) {
            const quote = lines.slice(start, end + 1).join("\n");
            if (!results.some((r) => r.page === pageNum && r.quote === quote)) {
              const display = lines.slice(start, end + 1).join(" ");
              results.push({ page: pageNum, quote, display, qualifiers: extractQualifiers(display) });
            }
            continue;
          }
        }
      }
      if (!regexes.some((re) => re.test(matchLine) || re.test(plainLine)) || !admissible(matchLine, next)) {
        // A bullet value whose own words do not name the fact belongs to it
        // only under a matching governing heading, which is cited with it.
        const rule = admissible(matchLine, next) ? governed.find((g) => g.line.test(matchLine)) : undefined;
        const headingIdx = rule ? governingHeadingIndex(lines, lineIdx) : undefined;
        if (rule && headingIdx !== undefined && rule.heading.test(matchLines[headingIdx]) && !excludes.some((re) => re.test(matchLines[headingIdx]))) {
          results.push({ page: pageNum, quote: lines.slice(headingIdx, lineIdx + 1).join("\n"), display: line, qualifiers: extractQualifiers(line) });
        }
        continue;
      }
      const before = results.length;
      {
        const relevantHeader = headers.find(h => h.lineIndex < lineIdx && lineIdx - h.lineIndex <= 10);

        if (relevantHeader) {
          const unmarked = withoutFootnoteMarkers(line);
          const hasValues = /\d/.test(unmarked) || /\$/.test(unmarked);

          if (hasValues) {
            const tierValues = parseTieredLine(line, relevantHeader);
            if (tierValues.length === 0) {
              // Keep a source line as tier-agnostic only when the fact matcher
              // itself found it; never guess a tier from a nearby header.
              results.push({ page: pageNum, quote: line, qualifiers: extractQualifiers(line) });
            } else for (const { tier, value } of tierValues) {
              const qualifiers = extractQualifiers(line);
              qualifiers.planTier = tier;
              results.push({ page: pageNum, quote: line, display: value, qualifiers });
            }
          } else {
            for (let lookahead = 1; lookahead <= 3; lookahead++) {
              if (lineIdx + lookahead >= lines.length) break;
              const nextLine = lines[lineIdx + lookahead];
              if (/\d/.test(nextLine) || /\$/.test(nextLine)) {
                // A values line that carries its own benefit label belongs to
                // that label: never borrow its amounts for this fact unless the
                // label itself matches this fact.
                if (hasOwnLabel(nextLine) && !regexes.some((re) => re.test(nextLine))) break;
                const tierValues = parseTieredLine(nextLine, relevantHeader);
                for (const { tier, value } of tierValues) {
                  if (value) {
                    const qualifiers = extractQualifiers(value);
                    qualifiers.planTier = tier;
                    results.push({ page: pageNum, quote: nextLine, display: value, qualifiers });
                  }
                }
                break;
              }
            }
          }
        } else {
          const qualifiers = extractQualifiers(line);
          results.push({ page: pageNum, quote: line, qualifiers });
        }
      }
      // A value read from a footnoted label cites the footnote too: the
      // footnote decided which fact the line states.
      const notes = footnoted[lineIdx].footnotes.map((j) => lines[j]);
      // Every value read from this label, including one on a lookahead
      // line, depends on the footnote (review S6).
      if (notes.length) for (const r of results.slice(before)) r.notes = notes;
      if (footnoted[lineIdx].unresolved) for (const r of results.slice(before)) r.unresolvedFootnote = true;
    }
  }
  return results;
}

export function extractFallback(
  documents: ExtractInputDocument[],
  userContext: Record<string, string>
): ComparisonTable {
  // Pre-compute tier headers for all documents (once per document, not per fact)
  const tierHeadersByDoc = new Map<string, Map<number, TierHeader[]>>();
  for (const doc of documents) {
    tierHeadersByDoc.set(doc.documentId, computeTierHeaders(doc.pages));
  }
  // Table claims own their lines: the line engine never emits its own
  // (column-blind) reading of a line that lies inside a detected table.
  const ownedByDoc = new Map(documents.map((doc) => [doc.documentId, tableOwnedSpans(doc)]));
  const claimsByDoc = new Map(documents.map((doc) => [doc.documentId, [...tableClaims(doc), ...statementClaims(doc)]]));
  // A grammar-parsed statement owns its sentence for its own fact only.
  const statementOwnedByDoc = new Map(documents.map((doc) => [doc.documentId, statementOwnedSpans(doc)]));
  // Table cells the document states for a fact but whose claim was dropped
  // (finding #2): reported as withheld, never left as a silent NOT STATED.
  const dropsByDoc = new Map(documents.map((doc) => [doc.documentId, tableDrops(doc)]));
  const exclusionItemsByDoc = new Map(documents.map((doc) => [doc.documentId, exclusionItemSpans(doc)]));

  const withheldByFact = new Map<string, { withheld: WithheldClaim[]; withheldOnly: boolean }>();
  const builtRows: TableRow[] = FACTS.map((fact) => {
    const values: CellValue[] = [];
    let ruledOutField: string | null = null;
    let allVague = true;
    let ambiguousEvidence = false;
    const withheld: WithheldClaim[] = [];
    const docsWithValues = new Set<string>();
    const withhold = (doc: ExtractInputDocument, drop: TableDrop) => {
      if (withheld.some((w) => w.documentId === doc.documentId && w.page === drop.page && w.quote === drop.quote && w.reason === drop.reason)) return;
      withheld.push({ documentId: doc.documentId, page: drop.page, quote: drop.quote, reason: drop.reason });
    };

    for (const doc of documents) {
      for (const drop of dropsByDoc.get(doc.documentId) ?? []) if (drop.factName === fact.name) withhold(doc, drop);
      const matches = findAllMatchesWithHeaders(fact.patterns, doc.pages, tierHeadersByDoc.get(doc.documentId)!, fact);
      const notValues: { page: number; quote: string; reason: "label-without-value" | "definition-line" }[] = [];

      for (const match of matches) {
        const verified = verifyEvidenceCitation([doc], {
          documentId: doc.documentId,
          page: match.page,
          quote: match.quote,
        });
        if (!verified.ok) {
          ambiguousEvidence = true;
          continue;
        }
        if (quoteInTable(doc, ownedByDoc.get(doc.documentId)!, match.page, verified.quote)) {
          for (const drop of unrecognizedLabelDrops(doc, fact.name, match.page, verified.quote)) withhold(doc, drop);
          continue;
        }
        const statementOwned = statementOwnedByDoc.get(doc.documentId)!.get(fact.name);
        if (statementOwned && quoteInTable(doc, statementOwned, match.page, verified.quote)) continue;
        if (BENEFIT_FACTS.has(fact.name) && quoteInTable(doc, exclusionItemsByDoc.get(doc.documentId)!, match.page, verified.quote)) continue;
        // A label/heading or a definition is not a value; it is withheld
        // for verification only when the document states nothing else for
        // this fact (never a silent NOT STATED), and dropped otherwise.
        // Review N1: a basis-dependent fact never takes a line whose glued
        // footnote marker found no footnote; the basis is unknown. Withheld.
        if (match.unresolvedFootnote && BASIS_DEPENDENT_FACTS.has(fact.name)) {
          withhold(doc, { factName: fact.name, page: match.page, quote: verified.quote, reason: "footnote-unresolved" });
          continue;
        }
        const shownLine = match.display ?? match.quote;
        // Review N3: a marker that resolved to a footnote is not a figure.
        const labelText = match.notes?.length ? withoutFootnoteMarkers(shownLine) : shownLine;
        const notAValue = !NAME_VALUED_FACTS.has(fact.name) && isValuelessLabel(labelText)
          ? "label-without-value"
          : (BENEFIT_FACTS.has(fact.name) || fact.name === "pre-existing-conditions") && TERM_DEFINITION.test(shownLine)
            ? "definition-line"
            : undefined;
        if (notAValue) {
          notValues.push({ page: match.page, quote: verified.quote, reason: notAValue });
          continue;
        }
        const vague = isVague(match.quote);
        if (!vague) allVague = false;
        const ruledOut = contextFieldRulesOut(fact.contextField, userContext, match.quote);
        if (ruledOut) ruledOutField = ruledOut;
        // Footnote lines this value depends on must verify too (fail closed).
        const noteCitations = (match.notes ?? []).map((quote) => verifyEvidenceCitation([doc], { documentId: doc.documentId, page: match.page, quote }));
        if (noteCitations.some((n) => !n.ok)) {
          ambiguousEvidence = true;
          continue;
        }
        const value: CellValue = {
          documentId: doc.documentId,
          display: match.display ?? match.quote,
          qualifiers: match.qualifiers,
          evidence: [
            { documentId: doc.documentId, page: match.page, quote: verified.quote },
            ...noteCitations.map((n) => ({ documentId: doc.documentId, page: match.page, quote: n.ok ? n.quote : "" })),
          ],
        };
        values.push({ ...value, qualifiers: attestedQualifiers(value, [doc]) });
        docsWithValues.add(doc.documentId);
      }
      // Structural claims for this fact: table cells (verbatim label/cell,
      // column scope) and grammar-parsed statements (verbatim sentence).
      for (const claim of claimsByDoc.get(doc.documentId) ?? []) {
        if (claim.factName !== fact.name) continue;
        if (BENEFIT_FACTS.has(fact.name) && claim.value.evidence.some((e) => quoteInTable(doc, exclusionItemsByDoc.get(doc.documentId)!, e.page, e.quote))) continue;
        values.push(claim.value);
        docsWithValues.add(doc.documentId);
        allVague = false;
      }
      if (!docsWithValues.has(doc.documentId)) {
        for (const n of notValues) withhold(doc, { factName: fact.name, ...n });
      }
    }

    // A document whose only statements of this fact were withheld must not
    // read as an absence: the row needs verification, with the source lines.
    if (withheld.length > 0) {
      withheldByFact.set(fact.name, { withheld, withheldOnly: withheld.some((w) => !docsWithValues.has(w.documentId)) });
    }
    if (values.length === 0 && withheld.length > 0) {
      return { factName: fact.name, verdict: "NEEDS VERIFICATION", rationale: WITHHELD_RATIONALE, values: [], withheld };
    }
    if (values.length === 0) {
      return ambiguousEvidence
        ? {
            factName: fact.name,
            verdict: "NEEDS VERIFICATION",
            rationale: "A matching source passage was not unique enough to verify as citation evidence.",
            values: [],
          }
        : { factName: fact.name, verdict: "NOT STATED", values: [] };
    }
    // Line values display their cited source text verbatim. Concise
    // paraphrases ("Covered after deductible", "You pay $10/visit") were
    // derived by keyword proximity and measured to invert or invent meaning
    // (e.g. "we also waive the $10 office visit copayments" → "You pay
    // $10/visit"); a display is a claim and must be the source's own words.
    // The care/rules readers still decide uncertainty (verdict), never text.
    const rulesDerived = RULES_FACTS.has(fact.name);
    const displayValues = values;
    const rulesCertain =
      !rulesDerived ||
      values.every((v) => summarizeRulesDisplay(fact.name, v.display).certain);
    if (ruledOutField && values.every((v) =>
      contextFieldRulesOut(fact.contextField, userContext, v.display))) {
      return {
        factName: fact.name,
        verdict: "DOES NOT APPEAR TO FIT",
        rationale: `User context field '${ruledOutField}' rules this fact out.`,
        values: displayValues,
      };
    }
    if (allVague) {
      return { factName: fact.name, verdict: "NEEDS VERIFICATION", values: displayValues };
    }
    if (rulesDerived && !rulesCertain) {
      return { factName: fact.name, verdict: "NEEDS VERIFICATION", values: displayValues };
    }
    if (fact.name === "coinsurance") {
      const readings = values.map((v) => ({
        value: v,
        reading: interpretCoinsuranceShare(v.display),
      }));
      if (readings.some(({ reading }) => reading.isMemberShare)) {
        return { factName: fact.name, verdict: "SUPPORTED", values };
      }
      return { factName: fact.name, verdict: "NEEDS VERIFICATION", values };
    }
    // Cross-document differences are comparison data, not evidence
    // conflict: separate plans are expected to state different figures
    // (different structures too — a range in one plan vs. a fixed amount
    // in another is SUPPORTED). CONFLICTED is reserved for a genuine
    // same-document/same-scope contradiction. The fallback emits every
    // regex match, so same-scope pairs CAN be present here (typically
    // extraction noise such as tier columns or definition lines); the
    // route's Stage E attribution and the presentation layer's
    // hasSameScopeContradiction check govern how they surface. Every
    // row that reaches this point is SUPPORTED.
    return {
      factName: fact.name,
      verdict: "SUPPORTED",
      values: displayValues,
    };
  });
  const rows = builtRows.map((row) => withWithheld(row, withheldByFact.get(row.factName)));

  return annotateAbsence(withEligibilityRow(
    applyPremiumPersonalization(
      applyConditionBindings({
        schemaVersion: "v1",
        factListVersion: FACT_LIST_VERSION,
        documents: documents.map(({ documentId, filename, pageCount }) => ({
          documentId,
          filename,
          pageCount,
        })),
        rows,
      }),
      userContext,
    ),
    userContext
  ), documents);
}

/** Attach withheld source lines to a row. When some document's only
 *  statements of the fact were withheld, a SUPPORTED/CONFLICTED row becomes
 *  NEEDS VERIFICATION (that document would otherwise read as silent). */
function withWithheld(row: TableRow, entry?: { withheld: WithheldClaim[]; withheldOnly: boolean }): TableRow {
  if (!entry || row.withheld) return row;
  const next: TableRow = { ...row, withheld: entry.withheld };
  if (entry.withheldOnly && (row.verdict === "SUPPORTED" || row.verdict === "CONFLICTED")) {
    next.verdict = "NEEDS VERIFICATION";
    next.rationale = WITHHELD_RATIONALE;
  }
  return next;
}

const EXTRACTION_INSTRUCTIONS = [
  "You extract comparable insurance facts from the DOCUMENT blocks below.",
  `Facts to extract (one row each): ${FACTS.map((f) => f.name).join(", ")}.`,
  "Return ONLY a JSON object matching comparison-schema v1:",
  '{"schemaVersion":"v1","factListVersion":"v1","documents":[{"documentId":"doc-1","filename":"plan.pdf","pageCount":42}],"plans":[{"planId":"plan-1","name":"Alpha","sources":[{"documentId":"doc-1","page":1,"quote":"Policy name: Alpha"}]}],"rows":[{"factName":"emergency-copay","verdict":"SUPPORTED","values":[{"documentId":"doc-1","display":"$100 copay, waived if admitted","qualifiers":{"conditions":"waived if admitted"},"evidence":[{"documentId":"doc-1","page":12,"quote":"Emergency copay $100, waived if admitted."}]}]}]}',
  "Every row MUST contain exactly one verdict from this closed enum: SUPPORTED, DOES NOT APPEAR TO FIT, NOT STATED, CONFLICTED, NEEDS VERIFICATION. Never omit, infer, or invent a verdict. DOES NOT APPEAR TO FIT requires rationale naming the user-context field. Use NOT STATED only when the source does not state the fact; extraction uncertainty or an unsupported candidate is not NOT STATED.",
  "Every value MUST contain its own documentId, display, qualifiers object, and evidence array. Each evidence item MUST use the same documentId as its value, plus the original PDF page number (1-based, never renumber selected pages) and an exact contiguous quote. Do not infer document identity from filename, plan name, or row position.",
  "Plans are optional. If present, use exactly plans:[{planId,name,sources:[{documentId,page,quote}]}] (optional policyIdentifier and issuer only when each is explicitly supported). Never use plans[].evidence or fabricate a source. Include a plan only when its name is explicitly declared in the source; the cited source quote must contain the plan name and cite its original PDF page. The Alpha plan in the JSON example is structural illustration only: omit plans when no source declaration supports a plan. A plan sourced from multiple documents also requires source-supported policyIdentifier and issuer; otherwise do not merge those documents into one plan.",
  "Never put planId on a row. A value-level planId is optional and may be included only when that value's own exact evidence is a labelled plan/fact/value proof; otherwise omit it and leave the fact unassigned.",
  "Use only the recognized qualifier keys: networkTier, period, ageBand, conditions, planTier, currency, ageMin, ageMax, amount, and frequency. The numeric premium fields ageMin, ageMax, amount and frequency are only for source-explicit premium rate tables. Do not emit derived-only selectionStatus or costType, or any other key. When no qualifier applies, use {}.",
  "The source concepts enrollment, network, expenseTypes, serviceType, and exceptions are NOT qualifier keys. Preserve them under conditions (or networkTier for network scope) only when the cited evidence supports that exact scope; otherwise leave the candidate unresolved rather than dropping the concept.",
  "Preserve every material condition and applicability limit in display and, where applicable, the matching recognized qualifier: network scope in networkTier; enrollment type, service scope, included-expense scope, exceptions, restrictions, and other conditions in conditions; period in period; age scope in ageBand (and the approved premium bounds when applicable); named tier in planTier. Keep the source wording and meaning; do not drop, generalize, or translate a qualifier into a different claim. Evidence must contain the amount/claim and the scope it applies to.",
  "If a material qualifier cannot be represented without loss in these recognized fields and supported by the cited evidence, do not emit that value as SUPPORTED. Leave that candidate out and use NEEDS VERIFICATION with a concise rationale when the source or schema prevents safe interpretation; never turn it into an unconditional benefit or call it NOT STATED.",
  "PLAN TIERS: when ONE document describes several named plan tiers or options (e.g. Lite / Plus / Platinum, or Basic / Enhanced, or Elite / Select / Budget / Smart) with different figures for the same benefit, emit a SEPARATE value object per tier, each with qualifiers.planTier set to that tier's name exactly as the document names it and display holding only that tier's figure. NEVER write one display like \"$0 to $2,500 for Lite and Plus; $0 to $25,000 for Platinum\". Correct shape for that case:",
  '[{"documentId":"doc-1","display":"$0 to $2,500","qualifiers":{"planTier":"Lite"},"evidence":[...]},{"documentId":"doc-1","display":"$0 to $2,500","qualifiers":{"planTier":"Plus"},"evidence":[...]},{"documentId":"doc-1","display":"$0 to $25,000","qualifiers":{"planTier":"Platinum"},"evidence":[...]}]',
  "TIER TABLE PARSING: Insurance brochures often contain comparison tables with a header row naming tiers (e.g. \"ELITE SELECT BUDGET SMART\" or \"BASIC CHOICE\") followed by rows where each benefit lists one figure per tier IN THE SAME ORDER. You MUST: (1) Identify the tier header row by finding a line that contains 2+ tier names (e.g. Elite, Select, Budget, Smart, Basic, Choice, Lite, Plus, Platinum, Gold, Silver, Bronze). (2) For each benefit row below that header, split the figures by position to map each figure to its tier. (3) Emit ONE value object PER TIER with qualifiers.planTier set to that tier's name. Example: if header is \"ELITE SELECT BUDGET SMART\" and a row reads \"Deductible $0 $0 $0 $0\", emit four values: Elite $0, Select $0, Budget $0, Smart $0, each with its planTier qualifier.",
  "A figure that applies to every tier of a document gets one value with no planTier.",
  "PREMIUM AGE BANDS: when ONE document prices the same tier differently by age (a rate table with age ranges), emit a SEPARATE premium value object per tier per age band. Each such value carries numeric qualifiers.ageMin and qualifiers.ageMax as INCLUSIVE bounds, qualifiers.amount as a bare number, qualifiers.frequency when stated (e.g. monthly), and qualifiers.planTier. A stated '< 65' is ageMax 64. A premium with no age variation gets one value with no ageMin/ageMax. Never choose which band applies to the user — the application decides from user context.",
  "Tiers within one document differing from each other is NOT a conflict; different plans, tiers, and scopes stating different values is normal comparison data.",
  "Every populated value needs >=1 evidence entry with the original PDF's 1-based page number and the exact quote.",
  "Rows for facts in no document use NOT STATED with empty values.",
  "Never attach evidence to an absence, and never cite an unrelated passage to fill the evidence requirement — state the absence explicitly.",
  "Use SUPPORTED whenever each value has cited, usable evidence — even when figures differ across documents, plan tiers, or network tiers (e.g. doc-1 deductible $250 vs. doc-2 deductible $500; Lite $250 vs. Platinum $500; in-network vs. out-of-network).",
  "Use CONFLICTED ONLY for a genuine same-document/same-scope contradiction: two values from the SAME documentId with the SAME scope (planTier, networkTier, period, ageBand, and conditions all equal) making incompatible claims, each with its own evidence. Two values from different documentIds are NEVER sufficient for CONFLICTED — V1 has no document-to-plan identity, so never infer that two documents describe the same plan — and values scoped to different tiers are NEVER contradictory merely because the figures differ.",
  "Use NEEDS VERIFICATION ONLY when the source statement itself is vague, partial, ambiguous, or cannot safely support a concrete interpretation — never merely because different plans structure a benefit differently (a range in one plan vs. a fixed amount in another is SUPPORTED).",
].join("\n");

/** Boundary normalization for LLM output (defense in depth: the prompt
 *  requires qualifiers, but models still omit or null it, or fill every
 *  qualifier key with an empty string for tier-agnostic values). Coerce
 *  missing, null, or non-object qualifiers on any value to {} before
 *  validation; trim known scope fields and drop them when blank so an
 *  absent tier stays absent (never an invented tier). A planTier of "All"
 *  or "All tiers" is the UI selector, never a tier column, so it normalizes
 *  to tier-agnostic as well. */
const QUALIFIER_SCOPE_KEYS: readonly string[] = [
  "planTier",
  "networkTier",
  "period",
  "ageBand",
  "conditions",
  "currency",
];

/** Interpretations are never model-asserted: extraction derives them from
 *  source text (see `applyConditionBindings`), so a model-provided claim is
 *  dropped before validation. */
const DERIVED_ONLY_KEYS: readonly string[] = ["selectionStatus", "costType"];

const KNOWN_QUALIFIER_KEYS = new Set([
  ...QUALIFIER_SCOPE_KEYS,
  ...DERIVED_ONLY_KEYS,
  "ageMin", "ageMax", "amount", "frequency", "currency",
]);

type PreparationResult = { payload: unknown; rejectionCodes: string[] };

/** Repair only the approved boundary omissions, quarantining claims rather than
 *  converting failed extraction into an absence. This runs before normalization
 *  so unsupported qualifier keys cannot be erased. */
export function prepareLlmOutput(raw: unknown, documents: ExtractInputDocument[]): PreparationResult {
  if (typeof raw !== "object" || raw === null) return { payload: raw, rejectionCodes: [] };
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return { payload: raw, rejectionCodes: [] };
  const inputIds = new Set(documents.map((document) => document.documentId));
  const rejectionCodes: string[] = [];
  const addCode = (code: string) => rejectionCodes.push(code);
  const rows: unknown[] = [];

  for (const candidateRow of table.rows) {
    if (typeof candidateRow !== "object" || candidateRow === null) { rows.push(candidateRow); continue; }
    const row = candidateRow as Record<string, unknown>;
    if (typeof row.verdict !== "string") { addCode("MISSING_ROW_VERDICT"); continue; }
    if (!Array.isArray(row.values)) { rows.push(row); continue; }
    const rowCodes: string[] = [];
    if (Object.hasOwn(row, "planId")) rowCodes.push("ROW_LEVEL_PLAN_ID_UNSUPPORTED");
    const cleanRow: Record<string, unknown> = { ...row };
    delete cleanRow.planId;
    const values: unknown[] = [];
    for (const candidate of row.values) {
      if (typeof candidate !== "object" || candidate === null) { values.push(candidate); continue; }
      const value = candidate as Record<string, unknown>;
      const evidence = Array.isArray(value.evidence) ? value.evidence : [];
      const evidenceIds = evidence.map((citation) =>
        typeof citation === "object" && citation !== null
          ? (citation as Record<string, unknown>).documentId : undefined,
      );
      let documentId = value.documentId;
      let rejectCode: string | undefined;
      if (evidence.length === 0) rejectCode = "MISSING_VALUE_EVIDENCE";
      if (!rejectCode && typeof documentId !== "string") {
        const unique = [...new Set(evidenceIds.filter((id): id is string => typeof id === "string"))];
        if (evidenceIds.some((id) => typeof id !== "string") || unique.length !== 1) rejectCode = "AMBIGUOUS_VALUE_DOCUMENT_ID";
        else if (!inputIds.has(unique[0])) rejectCode = "UNKNOWN_EVIDENCE_DOCUMENT_ID";
        else documentId = unique[0];
      } else if (!rejectCode && !inputIds.has(documentId as string)) {
        rejectCode = "UNKNOWN_VALUE_DOCUMENT_ID";
      } else if (!rejectCode && evidenceIds.some((id) => id !== documentId)) {
        rejectCode = "VALUE_DOCUMENT_ID_MISMATCH";
      }
      if (!rejectCode && evidenceIds.some((id) => typeof id !== "string" || !inputIds.has(id))) {
        rejectCode = "UNKNOWN_EVIDENCE_DOCUMENT_ID";
      }
      const qualifiers = typeof value.qualifiers === "object" && value.qualifiers !== null && !Array.isArray(value.qualifiers)
        ? value.qualifiers as Record<string, unknown> : {};
      if (!rejectCode && Object.keys(qualifiers).some((key) => !KNOWN_QUALIFIER_KEYS.has(key))) {
        rejectCode = "UNKNOWN_QUALIFIER_KEY";
      }
      if (!rejectCode) {
        const candidateValue = { ...value, documentId, qualifiers };
        const retained = scopedQualifiers({
          display: typeof value.display === "string" ? value.display : "",
          evidence: evidence as CellValue["evidence"],
          qualifiers: qualifiers as Qualifiers,
        });
        if (MATERIAL_QUALIFIERS.some((key) => qualifiers[key] !== undefined && retained[key] === undefined)) {
          rejectCode = "UNSUPPORTED_QUALIFIER_EVIDENCE";
        } else values.push(candidateValue);
      }
      if (rejectCode) { rowCodes.push(rejectCode); addCode(rejectCode); }
    }
    if (rowCodes.includes("ROW_LEVEL_PLAN_ID_UNSUPPORTED")) addCode("ROW_LEVEL_PLAN_ID_UNSUPPORTED");
    if (values.length === 0 && row.values.length > 0 && rowCodes.some((code) => code !== "ROW_LEVEL_PLAN_ID_UNSUPPORTED")) {
      rows.push({ ...cleanRow, verdict: "NEEDS VERIFICATION", rationale: [...new Set(rowCodes)].join(", "), values: [] });
    } else {
      rows.push({ ...cleanRow, ...(values.length !== row.values.length ? { verdict: "NEEDS VERIFICATION", rationale: [...new Set(rowCodes)].join(", ") } : {}), values });
    }
  }
  const result: Record<string, unknown> = { ...table, rows };
  if (Array.isArray(table.plans)) {
    const plans = table.plans.filter((plan) => {
      const sources = typeof plan === "object" && plan !== null
        ? (plan as Record<string, unknown>).sources : undefined;
      const validSources = Array.isArray(sources) && sources.length > 0 && sources.every((source) =>
        typeof source === "object" && source !== null &&
        typeof (source as Record<string, unknown>).documentId === "string" &&
        inputIds.has((source as Record<string, unknown>).documentId as string) &&
        Number.isInteger((source as Record<string, unknown>).page) &&
        (source as Record<string, unknown>).page as number >= 1 &&
        typeof (source as Record<string, unknown>).quote === "string" &&
        Boolean(((source as Record<string, unknown>).quote as string).trim()),
      );
      if (!validSources) {
        addCode("MALFORMED_PLAN_SOURCES");
        return false;
      }
      return true;
    });
    if (plans.length) result.plans = plans;
    else delete result.plans;
  }
  return { payload: result, rejectionCodes };
}

export function normalizeLlmTable(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return raw;
  return {
    ...table,
    rows: (table.rows as unknown[]).map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const r = row as Record<string, unknown>;
      if (!Array.isArray(r.values)) return row;
      return {
        ...r,
        values: (r.values as unknown[]).map((value) => {
          if (typeof value !== "object" || value === null) return value;
          const v = value as Record<string, unknown>;
          const q = v.qualifiers;
          if (typeof q !== "object" || q === null || Array.isArray(q)) {
            return { ...v, qualifiers: {} };
          }
          const cleaned: Record<string, unknown> = { ...(q as Record<string, unknown>) };
          for (const key of DERIVED_ONLY_KEYS) delete cleaned[key];
          for (const key of QUALIFIER_SCOPE_KEYS) {
            const field = cleaned[key];
            if (typeof field !== "string") continue;
            const trimmed = field.trim();
            if (!trimmed) {
              delete cleaned[key];
              continue;
            }
            if (key === "planTier" && /^all(\s+tiers?)?$/i.test(trimmed)) {
              delete cleaned[key];
              continue;
            }
            cleaned[key] = trimmed;
          }
          return { ...v, qualifiers: scopedQualifiers({
            display: typeof v.display === "string" ? v.display : "",
            evidence: Array.isArray(v.evidence) ? v.evidence : [],
            qualifiers: cleaned,
          }) };
        }),
      };
    }),
  };
}

/** Boundary cleanup for LLM output (principle IV): a value without evidence
 *  is a claim without support, so it cannot enter the table. A citation
 *  pointing at a different document than the value is discarded first (it
 *  supports nothing about this document), which may leave the value
 *  evidence-less. Drop such values — warning loudly, since dropped values
 *  are a model-reliability signal — and flip rows left with no cited values
 *  to NOT STATED instead of failing the whole table. NOT STATED rows
 *  carrying values are left untouched so validation still rejects that
 *  contract violation. */
export function dropEvidenceLessValues(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return raw;
  return {
    ...table,
    rows: (table.rows as unknown[]).map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const r = row as Record<string, unknown>;
      if (!Array.isArray(r.values)) return row;
      if (r.verdict === "NOT STATED") return row;
      const kept: unknown[] = [];
      for (const value of r.values as unknown[]) {
        if (typeof value !== "object" || value === null) {
          kept.push(value);
          continue;
        }
        const v = value as Record<string, unknown>;
        const evidence = Array.isArray(v.evidence)
          ? v.evidence.filter((e) => {
              const ok =
                typeof e === "object" && e !== null &&
                (e as Record<string, unknown>).documentId === v.documentId;
              if (!ok) {
                console.warn(
                  `[extractViaLlm] dropped citation on fact "${String(r.factName)}" that points at a different document than value "${String(v.documentId)}"`
                );
              }
              return ok;
            })
          : [];
        if (evidence.length > 0) {
          kept.push({ ...v, evidence, qualifiers: scopedQualifiers({
            display: typeof v.display === "string" ? v.display : "",
            evidence,
            qualifiers: typeof v.qualifiers === "object" && v.qualifiers !== null
              ? v.qualifiers : {},
          }) });
          continue;
        }
        console.warn(
          `[extractViaLlm] dropped evidence-less value for fact "${String(r.factName)}" ` +
            `from document "${String(v.documentId)}" — claims without citations are treated as unstated (principle IV)`
        );
      }
      if (kept.length > 0) return { ...r, values: kept };
      if ((r.values as unknown[]).length === 0) return row;
      const flipped: Record<string, unknown> = { ...r, verdict: "NOT STATED", values: [] };
      delete flipped.rationale;
      return flipped;
    }),
  };
}

/** Displays that are really absences phrased as values ("Not explicitly
 *  stated", "Not specified", "Not mentioned in the document"). */
const ABSENCE_DISPLAY = /^\s*(?:not|no)\s+(?:\w+\s+)?(?:stated|specified|mentioned|provided|listed|addressed|indicated|found)\b/i;

/** Boundary reconciliation of LLM output against things the model does not
 *  get to decide (principle IV, contracts/comparison-schema.md):
 *  - `documents` metadata comes from the uploads, not the model.
 *  - An absence phrased as a value is an absence: drop it (it cannot carry
 *    evidence), and flip rows left empty to NOT STATED.
 *  - DOES NOT APPEAR TO FIT must name the ruling-out context field; without
 *    one it is NEEDS VERIFICATION (or NOT STATED when there are no values).
 *  - CONFLICTED is kept only for a genuine same-document/same-scope
 *    contradiction (same documentId, same qualifiers scope, incompatible
 *    readings each with its own evidence). V1 has no document-to-plan
 *    identity, so cross-document values are comparison data and are
 *    recorded SUPPORTED; detecting conflicts across documents that belong
 *    to one plan is a future plan-identity capability. */
export function reconcileLlmTable(
  raw: unknown,
  documents: ExtractInputDocument[]
): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return raw;
  return {
    ...table,
    documents: documents.map(({ documentId, filename, pageCount }) => ({
      documentId,
      filename,
      pageCount,
    })),
    rows: (table.rows as unknown[]).map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const r = row as Record<string, unknown>;
      if (!Array.isArray(r.values)) return row;

      const values = (r.values as unknown[]).filter((value) => {
        if (typeof value !== "object" || value === null) return true;
        const v = value as Record<string, unknown>;
        if (typeof v.display === "string" && ABSENCE_DISPLAY.test(v.display)) {
          console.warn(
            `[extractViaLlm] treated "${v.display}" on fact "${String(r.factName)}" (${String(v.documentId)}) as an absence`
          );
          return false;
        }
        return true;
      });
      if (values.length === 0 && (r.values as unknown[]).length > 0 && r.verdict !== "NEEDS VERIFICATION") {
        return { factName: r.factName, verdict: "NOT STATED", values: [] };
      }

      const out: Record<string, unknown> = { ...r, values };
      if (typeof r.factName === "string" && CARE_FACTS.has(r.factName)) {
        out.values = (values as unknown[]).map((value) => {
          if (typeof value !== "object" || value === null) return value;
          const v = value as Record<string, unknown>;
          const quotes = Array.isArray(v.evidence)
            ? v.evidence.flatMap((e) =>
                typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).quote === "string"
                  ? [(e as Record<string, unknown>).quote as string]
                  : [],
              )
            : [];
          if (quotes.length === 0) return value;
          const reading = summarizeCareDisplay(r.factName as string, quotes.join("\n"));
          return reading.certain ? { ...v, display: reading.display } : value;
        });
      }
      if (typeof r.factName === "string" && RULES_FACTS.has(r.factName)) {
        let certain = false;
        out.values = (values as unknown[]).map((value) => {
          if (typeof value !== "object" || value === null) return value;
          const v = value as Record<string, unknown>;
          const quotes = Array.isArray(v.evidence)
            ? v.evidence.flatMap((e) =>
                typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).quote === "string"
                  ? [(e as Record<string, unknown>).quote as string]
                  : [],
              )
            : [];
          if (quotes.length === 0) return value;
          const reading = summarizeRulesDisplay(r.factName as string, quotes.join("\n"));
          if (reading.certain) certain = true;
          return reading.certain ? { ...v, display: reading.display } : value;
        });
        if (!certain) {
          out.verdict = "NEEDS VERIFICATION";
          delete out.rationale;
        }
      }
      if (r.factName === "coinsurance" && values.length > 0) {
        let memberShare = false;
        out.values = values.map((value) => {
          if (typeof value !== "object" || value === null) return value;
          const v = value as Record<string, unknown>;
          const quotes = Array.isArray(v.evidence)
            ? v.evidence.flatMap((e) =>
                typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).quote === "string"
                  ? [(e as Record<string, unknown>).quote as string]
                  : [],
              )
            : [];
          if (quotes.length === 0) return value;
          const reading = interpretCoinsuranceShare(quotes.join("\n"));
          if (reading.isMemberShare) memberShare = true;
          else if (reading.display === quotes.join("\n")) return value;
          return { ...v, display: reading.display };
        });
        if (!memberShare) {
          console.warn(
            `[extractViaLlm] coinsurance on fact "${String(r.factName)}" states no member share; recorded as NEEDS VERIFICATION`
          );
          out.verdict = "NEEDS VERIFICATION";
          delete out.rationale;
        }
      }
      if (r.verdict === "DOES NOT APPEAR TO FIT" && typeof r.rationale !== "string") {
        console.warn(
          `[extractViaLlm] DOES NOT APPEAR TO FIT on fact "${String(r.factName)}" names no context field; downgraded`
        );
        if (values.length === 0) return { factName: r.factName, verdict: "NOT STATED", values: [] };
        out.verdict = "NEEDS VERIFICATION";
      }
      if (r.verdict === "CONFLICTED") {
        const typed = values.filter(
          (v): v is { documentId: unknown; planId?: unknown; display: unknown; qualifiers: unknown } =>
            typeof v === "object" && v !== null
        );
        if (!hasSameScopeContradiction(typed)) {
          console.warn(
            `[extractViaLlm] CONFLICTED on fact "${String(r.factName)}" has no same-document/same-scope contradiction (cross-document differences are comparison data); recorded as SUPPORTED`
          );
          out.verdict = "SUPPORTED";
          delete out.rationale;
        }
      }
      out.values = (out.values as unknown[]).map((value) =>
        typeof value === "object" && value !== null
          ? { ...value, qualifiers: attestedQualifiers(value as CellValue, documents) }
          : value
      );
      return out;
    }),
  };
}

/** Reject only the known period/evidence mismatch per value. The candidate is
 *  not rewritten or published; valid peers survive under an explicitly
 *  unresolved row. Any other schema/evidence failure remains table-fatal. */
export function rejectUnsupportedPeriodCandidates(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { rows?: unknown }).rows)) return raw;
  const table = raw as Record<string, unknown>;
  const rows = (table.rows as unknown[]).map((candidateRow) => {
    if (typeof candidateRow !== "object" || candidateRow === null) return candidateRow;
    const row = candidateRow as Record<string, unknown>;
    if (!Array.isArray(row.values)) return candidateRow;
    const kept: unknown[] = [];
    let rejectedCount = 0;
    for (const value of row.values) {
      try {
        validateTable({ ...table, rows: [{ ...row, values: [value] }] });
        kept.push(value);
      } catch (error) {
        if (
          error instanceof Error &&
          /qualifiers\.period not supported by evidence/.test(error.message) &&
          typeof value === "object" && value !== null &&
          typeof (value as { qualifiers?: { period?: unknown } }).qualifiers?.period === "string"
        ) {
          rejectedCount++;
          continue;
        }
        throw error;
      }
    }
    if (rejectedCount === 0) return candidateRow;
    return {
      ...row,
      verdict: "NEEDS VERIFICATION",
      rationale: `${rejectedCount} candidate value(s) were rejected because the cited evidence does not support the claimed period qualifier.`,
      values: kept,
    };
  });
  return { ...table, rows };
}

export async function extractViaLlm(
  documents: ExtractInputDocument[],
  userContext: Record<string, string>
): Promise<ComparisonTable> {
  const prompt = wrapDocuments(
    `${EXTRACTION_INSTRUCTIONS}\nUser context (apply a field ONLY when documents reference it): ${JSON.stringify(userContext)}`,
    documents.map(({ documentId, pages }) => ({ documentId, pages }))
  );
  // Strict structured output: the client requests COMPARISON_TABLE_SCHEMA and
  // rejects any off-schema response before it reaches this pipeline.
  const raw = stripServerOnlyFields(stripNullProperties(
    await completeJson([{ role: "user", content: prompt }], undefined, { schema: COMPARISON_TABLE_SCHEMA }),
  ));
  const prepared = prepareLlmOutput(raw, documents);
  if (prepared.rejectionCodes.length) {
    console.warn(`[extractViaLlm] quarantined model output: ${[...new Set(prepared.rejectionCodes)].join(",")}`);
  }
  const reconciled = reconcileLlmTable(
    dropEvidenceLessValues(normalizeLlmTable(prepared.payload)), documents
  );
  return annotateAbsence(withEligibilityRow(
    applyPremiumPersonalization(
      applyConditionBindings(
        validateTable(
          rejectUnsupportedPeriodCandidates(reconciled)
        )
      ),
      userContext,
    ),
    userContext
  ), documents);
}

export function extractComparison(
  documents: ExtractInputDocument[],
  userContext: Record<string, string> = {},
  opts: { useLlm?: boolean } = {}
): ComparisonTable {
  if (!opts.useLlm) return extractFallback(documents, userContext);
  throw new Error("useLlm=true requires the async extractViaLlm path");
}
