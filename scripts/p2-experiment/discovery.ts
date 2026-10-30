// P2 fact-discovery experiment — open-vocabulary candidate-concept prototype.
//
// DETERMINISTIC RULES ONLY. This is not a model: it demonstrates what a
// rule-based candidate-fact representation can discover from evidence-constrained
// source spans. No remote inference is invoked; no PDF text leaves this machine.
// (Local generation inference is unavailable: the only local Ollama model is
// qwen3-embedding:0.6b, an embedding model.)
//
// Boundaries preserved from production:
// - evidence spans are verified fail-closed with the production
//   verifyEvidenceCitation (unique normalized verbatim span); a candidate whose
//   evidence cannot be proven is dropped, never repaired;
// - plan attribution reuses the production C6 helpers (attestPlans +
//   resolveRowPlanIds ownership rules) — no relaxed attribution; optional
//   riders are never attributed to the base plan;
// - every candidate carries explicit uncertainty flags.

import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import {
  attestPlans,
  resolveRowPlanIds,
} from "@/app/lib/extraction/plan-identity";
import type { ProvenPlan } from "@/app/lib/extraction/types";

type SourceDoc = { documentId: string; filename: string; pageCount: number; pages: string[] };

export interface CandidateFact {
  documentId: string;
  page: number;
  conceptKey: string;
  label: string;
  display: string;
  qualifiers: {
    planTier?: string;
    networkTier?: string;
    ageBand?: string;
    period?: string;
    selectionStatus?: string;
    conditions?: string;
  };
  section: string;
  isOptional: boolean;
  category: "benefit" | "exclusion" | "limit" | "eligibility" | "duration";
  uncertainty: string[];
  evidence: { documentId: string; page: number; quote: string }[];
  planId?: string;
}

// ---------------------------------------------------------------- section model

type SectionKind =
  | "benefits"
  | "exclusions"
  | "eligibility"
  | "optional"
  | "definitions"
  | "toc"
  | "provisions"
  | "intro";

interface SectionState {
  kind: SectionKind;
  name: string;
}

const SECTION_KEYWORDS: { word: string; kind: SectionKind }[] = [
  { word: "TABLE OF CONTENTS", kind: "toc" },
  { word: "DEFINITIONS", kind: "definitions" },
  { word: "EXCLUSIONS", kind: "exclusions" },
  { word: "OPTIONAL COVERAGE", kind: "optional" },
  { word: "OPTIONAL RIDERS", kind: "optional" },
  { word: "ELIGIBILITY", kind: "eligibility" },
  { word: "BENEFIT SUMMARY", kind: "benefits" },
  { word: "SCHEDULE OF BENEFITS", kind: "benefits" },
  { word: "BENEFITS AND LIMITS", kind: "benefits" },
  { word: "CONDITIONS AND GENERAL PROVISIONS", kind: "provisions" },
  { word: "CONDITIONS AND RESTRICTIONS", kind: "provisions" },
  { word: "CONDITIONS", kind: "provisions" },
];

/** A header line starts with "X. KEYWORD" (lettered provision) or "KEYWORD"
 *  followed by at most a short tail (title/heading). Trailing prose after a
 *  lettered keyword ("Q. EXCLUSIONS: Except as expressly...") is accepted;
 *  after an unlettered keyword only a short tail ("Benefits and Limits of
 *  StudentSecure®") is, so a prose sentence beginning "Eligibility for and
 *  payment of..." is never a header. */
function classifyHeaderLine(line: string): SectionState | null {
  const t = line.trim();
  if (!t || t.length > 200) return null;
  // Lettered headings: "X. KEYWORD:" ending the line, or "X. KEYWORD: prose"
  // with the provision text following on the same line.
  const letteredEnd = /^([A-Z])\.\s+([A-Z][A-Z ,&/()'-]+?)\s*(?::\s*|$)/.exec(t);
  const letteredProse = /^([A-Z])\.\s+([A-Z][A-Z ,&/()'-]+?):\s+\S/.exec(t);
  const lettered = letteredEnd ?? letteredProse;
  if (lettered) {
    const keyword = lettered[2].trim().toUpperCase();
    for (const { word, kind } of SECTION_KEYWORDS) {
      if (keyword === word || keyword.startsWith(word)) {
        return { kind, name: lettered[2].trim() };
      }
    }
    // Other lettered headings are provisions/conditions of the certificate.
    return { kind: "provisions", name: lettered[2].trim() };
  }
  for (const { word, kind } of SECTION_KEYWORDS) {
    if (!t.toUpperCase().startsWith(word)) continue;
    if (!/^[A-Z]/.test(t)) continue; // lowercase prose ("conditions are met…") is never a header
    const tail = t.slice(word.length).trim();
    if (tail === "" || /^[.:—-]/.test(tail) || tail.length <= 30) {
      return { kind, name: t.replace(/[:.]+$/, "").trim() };
    }
  }
  return null;
}

// ---------------------------------------------------------------- tier vocab

const TIER_VOCAB: { doc: string; tiers: string[]; pattern: RegExp }[] = [
  { doc: "doc-2", tiers: ["elite", "select", "budget", "smart"], pattern: /ELITE\s+(Limit\s+)?SELECT\s+(Limit\s+)?BUDGET\s+(Limit\s+)?SMART/ },
  { doc: "doc-3", tiers: ["basic", "choice"], pattern: /Travel Medical Basic[\s\S]{0,160}?Travel Medical Choice/ },
  { doc: "doc-1", tiers: ["in-network", "out-of-network", "international"], pattern: /In-Network[\s\S]{0,120}?Out-of-Network[\s\S]{0,60}?International/ },
];

function detectTierVocab(docId: string, pageText: string): string[] | null {
  for (const v of TIER_VOCAB) {
    if (v.doc === docId && v.pattern.test(pageText)) return v.tiers;
  }
  return null;
}

// ---------------------------------------------------------------- text utils

const TOC_LEADER_RE = /\.{6,}/;
/** Watermark text bleeds into the last text line of some pages. */
const WATERMARK_STRIP_RE = /\s*SAMPLE\s*$|\s*For Inquiry Purposes Only\s*$/i;

function cleanLine(line: string): string {
  return line.replace(WATERMARK_STRIP_RE, "").trim();
}

const VALUE_TOKEN_RE = /\$[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|(?<!\bto\s)\b\d+\s+(?:\w+\/\w+\/\w+\s+|\w+\s+)?(?:days?|months?|years?|visits?)\b|\bno coverage\b|\bN\/A\b|\bup to medical maximum\b/gi;

function findValueTokens(line: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  VALUE_TOKEN_RE.lastIndex = 0;
  for (let m; (m = VALUE_TOKEN_RE.exec(line)); ) {
    out.push({ text: m[0], index: m.index });
  }
  return out;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const SPELLING_CANON: [RegExp, string][] = [
  [/\bpreventative\b/gi, "preventive"],
  [/\bco-?pay(?:ment)?s?\b/gi, "copay"],
  [/\b&\b/g, "and"],
];

function slugify(label: string): string {
  let s = label.toLowerCase();
  for (const [re, to] of SPELLING_CANON) s = s.replace(re, to);
  return s
    .replace(/\((?:claims|not|must|available|excludes|subject|no)[^)]*\)/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** A clean benefit label: shortish, title-like, not a wrapped sentence
 *  fragment ("room facility fee for"), not a bullet, not a header. */
function isCleanLabel(t: string): boolean {
  if (!t || t.length > 80) return false;
  if (/^•/.test(t)) return false;
  if (/[.:;,]$/.test(t) && !/\.$/.test(t.replace(/\.$/, ""))) return false; // ends with , or ; — fragment
  if (/^[a-z]/.test(t)) return false; // lowercase continuation fragment
  if (/^[)/]/.test(t)) return false; // parenthetical remnant ("Only)")
  if (/\.$/.test(t)) return false; // a sentence
  if (classifyHeaderLine(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 9) return false;
  return true;
}

function isLabelish(t: string): boolean {
  if (!t || t.length > 200) return false;
  if (TOC_LEADER_RE.test(t)) return false;
  if (findValueTokens(t).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------- candidates

interface ParsedCandidate {
  conceptKey: string;
  label: string;
  display: string;
  qualifiers: CandidateFact["qualifiers"];
  category: CandidateFact["category"];
  uncertainty: string[];
  /** Global line index window (inclusive). */
  window: [number, number];
  isOptional: boolean;
  section: string;
}

const DOC1_NETWORKS = ["in-network", "out-of-network", "international"];

const LABEL_MAX_BACK = 6;

function qualifiesSelectable(text: string): boolean {
  return /\(choose the option|choose the option you want/i.test(text);
}

function ageBandOf(text: string): string | undefined {
  const m = /\b\d+\s*(?:days?|months?|years?)?\s*(?:old|of age)?\s*(?:to|through)\s*\d+\s*(?:days?|months?|years?)?\s*(?:old)?|\b\d+\s+days?\s+(?:of age|old)|\b\d+\s+years?\s+old|\bunder age \d+/i.exec(text);
  return m ? m[0].toLowerCase() : undefined;
}

/** Multiple same-shape values in one line → tier columns. */
function splitTierValues(text: string): { label: string; values: string[] } | null {
  const tokens = findValueTokens(text);
  if (tokens.length < 2 || tokens.length > 4) return null;
  const segments: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const start = tokens[i].index;
    const end = i + 1 < tokens.length ? tokens[i + 1].index : text.length;
    segments.push(text.slice(start, end).trim());
  }
  const shapeOf = (s: string) => {
    const n = norm(s).toLowerCase();
    return /^\$/.test(n) ? "$" : /^\d+%/.test(n) ? "%" : /^no coverage/.test(n) ? "no" : /^n\/a/.test(n) ? "na" : /^up to/.test(n) ? "upto" : "other";
  };
  const shapes = new Set(segments.map(shapeOf));
  if (shapes.size > 2) return null;
  const label = text.slice(0, tokens[0].index).trim();
  if (!label) return null;
  return { label, values: segments };
}

/** From the label buffer, choose the best label text and window start:
 *  chronological join of buffered label lines (their combined text usually
 *  forms the full benefit title), capped at 90 chars; if the join is too long
 *  or empty, the nearest clean title-like line. */
function chooseLabel(buffer: { text: string; index: number }[]): { text: string; index: number } | null {
  if (buffer.length === 0) return null;
  const joined = norm(buffer.map((b) => b.text.replace(/^•\s*/, "")).join(" "));
  if (joined.length > 0 && joined.length <= 90) {
    return { text: joined, index: buffer[0].index };
  }
  // Walk back for the last clean label, skipping parenthetical qualifier
  // fragments ("(Treatment must not be…") — those qualify a row, they do not
  // name it.
  let lastCleanIdx = -1;
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (/^\(/.test(buffer[i].text)) continue;
    if (isCleanLabel(buffer[i].text)) { lastCleanIdx = i; break; }
  }
  if (lastCleanIdx < 0) return null;
  // Multi-line list labels ("Intercollegiate, / Interscholastic, Intramural,
  // or / Club Sports"): extend upward through rejected short fragments so the
  // evidence window covers the whole label.
  let start = lastCleanIdx;
  for (let i = lastCleanIdx - 1; i >= 0; i--) {
    const e = buffer[i];
    if (e.text.length > 40 || !isLabelish(e.text) || /^up to\b/i.test(e.text)) break;
    // Include only list-continuation fragments (trailing "," or trailing
    // conjunction); anything else — including a clean standalone label —
    // ends the run.
    if (!/[,;]$/.test(e.text) && !/\b(?:or|and)$/i.test(e.text)) break;
    start = i;
  }
  if (start < lastCleanIdx) {
    const ext = norm(buffer.slice(start, lastCleanIdx + 1).map((b) => b.text.replace(/^•\s*/, "")).join(" "));
    if (ext.length <= 90) return { text: ext, index: buffer[start].index };
  }
  return buffer[lastCleanIdx];
}

/** Small deterministic canonicalization of recurring label shapes to stable
 *  concept keys (a production system would carry a concept dictionary; this
 *  table is part of the prototype, not of the fixed 43-fact inventory). */
const LABEL_CANON: { re: RegExp; key: string }[] = [
  { re: /certificate period of coverage maximum limit|period of coverage maximum limit/i, key: "coverage-duration-maximum" },
];

function canonicalKey(labelSlug: string, rawLabel: string): string {
  for (const { re, key } of LABEL_CANON) {
    if (re.test(rawLabel)) return key;
  }
  return labelSlug;
}

/** Stateful streaming flow parser: buffers label lines, emits candidates at
 *  value lines. */
function createFlowParser(tiers: () => string[] | null, docId: string, sectionName: () => string) {
  let labelBuffer: { text: string; index: number }[] = [];
  let conditionClauseActive = false;
  /** parent label of an age-band menu (inherited by sibling band rows) */
  let menuParent: { text: string; index: number } | null = null;
  return function ingest(lineIdx: number, line: string): ParsedCandidate[] {
    const t = cleanLine(line);
    if (!t) return [];
    if (TOC_LEADER_RE.test(t)) { labelBuffer = []; conditionClauseActive = false; return []; }
    if (classifyHeaderLine(t)) { labelBuffer = []; menuParent = null; conditionClauseActive = false; return []; }
    if (/ELITE\s+(Limit\s+)?SELECT|PLAN OPTIONS/.test(t)) { labelBuffer = []; return []; }
    const emit = (c: Omit<ParsedCandidate, "section">): ParsedCandidate => ({ ...c, section: sectionName() });

    // Conditional clauses ("Copayment is not applicable if the Declaration
    // states a $0 Deductible") and their wrapped continuations are condition
    // prose, not standalone values.
    if (/\bnot applicable if\b/i.test(t)) { conditionClauseActive = true; return []; }
    if (conditionClauseActive) {
      if (isLabelish(t) && isCleanLabel(t)) conditionClauseActive = false;
      else return [];
    }

    // "Per Illness or Injury limit Refer to the Declaration of Insurance" —
    // a labelled value that lives in another document (the Declaration).
    // Checked before isLabelish: the line carries no value tokens, so it
    // would otherwise be buffered as a label.
    const declMatch = /\bRefer to the Declaration of Insurance\b/i.exec(t);
    if (declMatch && !/^•/.test(t) && !conditionClauseActive) {
      const label = t.slice(0, declMatch.index).trim().replace(/[-–:]$/, "").trim();
      if (label) {
        labelBuffer = [];
        return [emit({
          conceptKey: canonicalKey(slugify(label), label),
          label,
          display: t,
          qualifiers: {},
          category: "limit",
          uncertainty: ["unresolved-reference", "seed-phrase"],
          window: [lineIdx, lineIdx],
          isOptional: false,
        })];
      }
    }

    if (isLabelish(t)) {
      labelBuffer.push({ text: t, index: lineIdx });
      if (labelBuffer.length > LABEL_MAX_BACK) labelBuffer.shift();
      return [];
    }
    const values = findValueTokens(t);
    if (values.length === 0) return []; // bullets / wrapped fragments: ignore, keep buffer
    const isBullet = /^•/.test(t);
    // An age-band label ("70 to 79 years old: $50,000; $100,000") qualifies
    // the row by age, not by tier column; tier-splitting it produces garbage
    // segments. Emit as one row with an explicit ageBand qualifier.
    const ageBandLabel = ageBandOf(t.slice(0, values[0].index));
    const leading = t.replace(/^•\s*/, "").slice(0, (() => {
      const idx = values[0].index - (t.length - t.replace(/^•\s*/, "").length);
      return Math.max(0, idx);
    })()).trim().replace(/[:;,]+$/, "").trim();
    const informative = leading.length > 0 && /^[A-Z]/.test(leading) && !/\./.test(leading) &&
      leading.split(/\s+/).length <= 12 &&
      !/^(?:copay(?:ment)?s?|deductible|coinsurance|maximum|limit|per visit|up to|not subject to|urc|insured pays|plan pays|we pay|we will pay|no coverage|n\/a)$/i.test(leading);
    const fromBuffer = chooseLabel(labelBuffer);
    const resolved = fromBuffer ??
      (informative ? { text: leading, index: lineIdx } : null) ??
      (ageBandLabel && menuParent && lineIdx - menuParent.index <= 3 ? menuParent : null) ??
      (isBullet || /^[a-z]/.test(leading) ? null : leading ? { text: leading, index: lineIdx } : null);
    if (fromBuffer) menuParent = fromBuffer;
    const labelText = resolved?.text ?? "";
    const windowStart = resolved?.index ?? lineIdx;
    const selectable = qualifiesSelectable(t);
    const tierSplit = selectable || ageBandLabel ? null : splitTierValues(t);
    const tierVocab = tiers();

    if (tierSplit && tierVocab && tierSplit.values.length === tierVocab.length) {
      const res: ParsedCandidate[] = [];
      for (let v = 0; v < tierSplit.values.length; v++) {
        res.push(emit({
          conceptKey: canonicalKey(slugify(tierSplit.label), tierSplit.label),
          label: tierSplit.label,
          display: `${tierSplit.label} ${tierSplit.values[v]}`.trim(),
          qualifiers: docId === "doc-1" ? { networkTier: DOC1_NETWORKS[v] } : { planTier: tierVocab[v] },
          category: "benefit",
          uncertainty: [],
          window: [windowStart, lineIdx],
          isOptional: false,
        }));
      }
      labelBuffer = [];
      return res;
    }
    if (tierSplit) {
      labelBuffer = [];
      return [emit({
        conceptKey: canonicalKey(slugify(tierSplit.label), tierSplit.label),
        label: tierSplit.label,
        display: t,
        qualifiers: {},
        category: "benefit",
        uncertainty: ["multi-value-line-unsplit"],
        window: [windowStart, lineIdx],
        isOptional: false,
      })];
    }

    const conditionsMatch = /\(([^)]{3,120})\)/.exec(t);
    labelBuffer = [];
    const windowDepth = lineIdx - windowStart;
    return [emit({
      conceptKey: canonicalKey(slugify(labelText || t), labelText || t),
      label: labelText || t,
      display: t,
      qualifiers: {
        ...(selectable ? { selectionStatus: "selectable" } : {}),
        ...(ageBandOf(t) ? { ageBand: ageBandOf(t)! } : {}),
        ...(ageBandLabel ? { ageBand: ageBandLabel } : {}),
        ...(conditionsMatch && !selectable ? { conditions: conditionsMatch[1] } : {}),
      },
      category: "benefit",
      uncertainty: [
        ...(selectable ? ["selectable-range"] : []),
        ...(!resolved ? ["label-from-value-line"] : []),
        ...(windowDepth > 4 ? ["deep-label-window"] : []),
      ],
      window: [windowStart, lineIdx],
      isOptional: false,
    })];
  };
}

// ---------------------------------------------------------------- seeds

interface SeedMatch {
  conceptKey: string;
  label: string;
  category: CandidateFact["category"];
  uncertainty: string[];
}

const STATUS_SEEDS: { re: RegExp; seed: SeedMatch }[] = [
  {
    re: /\bPPACA\b/,
    seed: { conceptKey: "ppaca-status", label: "PPACA notice", category: "exclusion", uncertainty: ["seed-phrase"] },
  },
  {
    re: /\bLIMITED BENEFIT POLICY\b/,
    seed: { conceptKey: "limited-benefit-policy-status", label: "Limited benefit policy status", category: "exclusion", uncertainty: ["seed-phrase"] },
  },
  {
    re: /Refer to the Declaration of Insurance/,
    seed: { conceptKey: "declaration-referenced-value", label: "Value defined in the Declaration", category: "limit", uncertainty: ["unresolved-reference", "seed-phrase"] },
  },
  {
    re: /\b(?:If you do not contact|must (?:be )?contacted?)\b[\s\S]{0,120}?\bbenefit (?:will be limited|is limited)\b|\bbenefit will\s*\n?\s*be limited[\s\S]{0,120}?Assist\b/,
    seed: { conceptKey: "assist-contact-requirement", label: "Benefit limited unless assistance service contacted", category: "exclusion", uncertainty: ["seed-phrase"] },
  },
  {
    re: /\bEXTENSION PERIOD\b/,
    seed: { conceptKey: "j1-extension-period", label: "J1 visa extension period", category: "eligibility", uncertainty: ["seed-phrase"] },
  },
  {
    re: /\bcancellation fee\b/i,
    seed: { conceptKey: "cancellation-refund-policy", label: "Cancellation and refund policy", category: "exclusion", uncertainty: ["seed-phrase"] },
  },
  {
    re: /\b\d+\s+days to receive treatment\b/i,
    seed: { conceptKey: "treatment-window", label: "Treatment window after injury or illness", category: "exclusion", uncertainty: ["seed-phrase"] },
  },
  {
    re: /\bPre-existing Condition[\s\S]{0,200}?excluded until\b/i,
    seed: { conceptKey: "pre-existing-condition-rule", label: "Pre-existing condition limitation", category: "exclusion", uncertainty: ["seed-phrase"] },
  },
  {
    re: /\bUp to \d+ telehealth visits per policy\b/i,
    seed: { conceptKey: "telehealth-visits", label: "Telehealth visits included", category: "benefit", uncertainty: ["seed-phrase"] },
  },
];

/** Duration statements in marketing/intro prose ("up to 364 days"). */
const DURATION_SEED_RE = /\b(?:up to|maximum of|for up to)\s+\d+\s+days?\b/i;

// ---------------------------------------------------------------- eligibility

const ELIG_TRIG_RE = /\b(?:must\s+be|must\s+hold|must\s+meet|cannot\s+buy|are\s+not\s+eligible|not\s+yet\s+|under\s+age\s+\d+|at\s+least\s+|be\s+an\s+active)/i;
const AGE_HINT_RE = /\b\d+\s*(?:days?|months?|years?)?\s*(?:of age|old)\b|\bunder age \d+\b|\(\d+\)\s*days|\(\d+\)\s*years|\b\d+\s+days of age\b/i;

function parseEligibilityWholeDoc(lines: string[], sectionMap: Map<number, SectionState>): ParsedCandidate[] {
  const out: ParsedCandidate[] = [];
  let acc = "";
  let startIdx = -1;
  let sectionAtStart: SectionState | null = null;
  const flush = (endIdx: number) => {
    if (acc.trim() && startIdx >= 0 && sectionAtStart) {
      const text = norm(acc);
      const kind = sectionAtStart.kind;
      const key = kind === "eligibility"
        ? (slugify(sectionAtStart.name).startsWith("eligibility") ? slugify(sectionAtStart.name) : `eligibility-${slugify(sectionAtStart.name).slice(0, 40)}`)
        : kind === "benefits"
          ? "eligibility-requirements"
          : kind === "intro" ? "eligibility-who-can-buy" : null;
      if (key && ELIG_TRIG_RE.test(text) && AGE_HINT_RE.test(text) && text.length <= 500) {
        const extra = kind === "benefits" ? ["outside-eligibility-section"] : kind === "intro" ? ["intro-page"] : [];
        out.push({
          conceptKey: key,
          label: sectionAtStart.name,
          display: text,
          qualifiers: { ...(ageBandOf(text) ? { ageBand: ageBandOf(text)! } : {}) },
          category: "eligibility",
          uncertainty: extra,
          window: [startIdx, endIdx],
          isOptional: false,
          section: sectionAtStart.name,
        });
      }
    }
    acc = "";
    startIdx = -1;
    sectionAtStart = null;
  };
  for (let i = 0; i <= lines.length; i++) {
    const t = i < lines.length ? cleanLine(lines[i]) : "";
    const s = sectionMap.get(i) ?? null;
    if (
      !t || TOC_LEADER_RE.test(t) || classifyHeaderLine(t) || i === lines.length ||
      (s && (s.kind === "provisions" || s.kind === "definitions" || s.kind === "toc" || s.kind === "exclusions" || s.kind === "optional"))
    ) {
      flush(i - 1);
      continue;
    }
    if (startIdx < 0) { startIdx = i; sectionAtStart = s; }
    acc = acc ? `${acc} ${t}` : t;
    if (/[.;]$/.test(t) || acc.length > 350) flush(i);
  }
  return out;
}

// ---------------------------------------------------------------- document parse

function parseDocument(docId: string, pages: string[]): ParsedCandidate[] {
  const out: ParsedCandidate[] = [];
  let section: SectionState = { kind: "intro", name: "page-top" };

  const allLines: string[] = [];
  const pageOfLine: number[] = [];
  for (const [pIdx, p] of pages.entries()) {
    for (const l of p.split(/\r?\n/)) {
      allLines.push(l);
      pageOfLine.push(pIdx + 1);
    }
  }
  /** section in effect at each non-header line (for the eligibility pass) */
  const sectionMap = new Map<number, SectionState>();

  const tiersHere = () => {
    const page = pageOfLine[Math.min(currentLine, pageOfLine.length - 1)];
    return detectTierVocab(docId, pages[page - 1] ?? "");
  };
  let currentLine = 0;
  const ingest = createFlowParser(tiersHere, docId, () => section.name);
  /** occurrence counter for plan-option pairs without in-line tier vocabulary */
  const occurrenceByKey = new Map<string, number>();
  /** per-seed last covered line: suppresses double-fires across line + 2-line join */
  const lastSeedEnd = new Map<string, number>();

  for (let i = 0; i < allLines.length; i++) {
    currentLine = i;
    const raw = allLines[i];
    const t = cleanLine(raw);
    const header = classifyHeaderLine(t);
    if (header) {
      section = header;
      continue;
    }
    sectionMap.set(i, section);
    if (section.kind === "provisions" || section.kind === "intro" || section.kind === "definitions" || section.kind === "toc") {
      // Only flagged seeds surface from contract/marketing/definition prose.
      // Seeds may span a wrapped pair of lines, so check the 2-line join too.
      // A line already covered by the previous join hit is not re-emitted.
      for (const { re, seed } of STATUS_SEEDS) {
        if (i <= (lastSeedEnd.get(seed.conceptKey) ?? -1)) continue;
        const join2 = norm(`${t} ${cleanLine(allLines[i + 1] ?? "")}`);
        if (re.test(t)) {
          lastSeedEnd.set(seed.conceptKey, i);
          out.push({
            conceptKey: seed.conceptKey,
            label: seed.label,
            display: t.length > 300 ? `${t.slice(0, 300)}…` : t,
            qualifiers: {},
            category: seed.category,
            uncertainty: [...seed.uncertainty, section.kind === "intro" ? "intro-page" : "provisions-section"],
            window: [i, i],
            isOptional: false,
            section: section.name,
          });
        } else if (re.test(join2)) {
          lastSeedEnd.set(seed.conceptKey, i + 1);
          out.push({
            conceptKey: seed.conceptKey,
            label: seed.label,
            display: join2.length > 300 ? `${join2.slice(0, 300)}…` : join2,
            qualifiers: {},
            category: seed.category,
            uncertainty: [...seed.uncertainty, "wrapped-span", section.kind === "intro" ? "intro-page" : "provisions-section"],
            window: [i, i + 1],
            isOptional: false,
            section: section.name,
          });
        }
      }
      if (section.kind === "intro") {
        // Duration statements (flagged).
        if (DURATION_SEED_RE.test(t) && t.length <= 400) {
          out.push({
            conceptKey: "coverage-duration-maximum",
            label: "coverage duration",
            display: t,
            qualifiers: {},
            category: "duration",
            uncertainty: ["marketing-prose", "seed-phrase", "intro-page"],
            window: [i, i],
            isOptional: false,
            section: section.name,
          });
        }
      }
      continue;
    }
    if (section.kind === "exclusions") {
      const item = /^\((\d{1,2})\)\s+([A-Z][A-Z0-9 ,&/'()-]{2,60}?)\s*:/.exec(t);
      if (item) {
        out.push({
          conceptKey: slugify(item[2]),
          label: item[2].trim(),
          display: t.length > 300 ? `${t.slice(0, 300)}…` : t,
          qualifiers: {},
          category: "exclusion",
          uncertainty: t.length > 300 ? ["truncated-display"] : [],
          window: [i, i],
          isOptional: false,
          section: section.name,
        });
      } else if (/^[A-Z][A-Z0-9 ,.'-]{10,120}[.:]$/.test(t)) {
        out.push({
          conceptKey: slugify(t),
          label: t,
          display: t,
          qualifiers: {},
          category: "exclusion",
          uncertainty: ["exclusion-statement"],
          window: [i, i],
          isOptional: false,
          section: section.name,
        });
      }
      continue;
    }
    if (section.kind === "optional") {
      const single = createFlowParser(() => null, docId, () => section.name)(i, raw);
      for (const c of single) {
        c.isOptional = true;
        c.uncertainty.push("optional-section");
        c.window = [i, i];
        out.push(c);
      }
      // Flagged seeds also surface from optional-section footnotes.
      for (const { re, seed } of STATUS_SEEDS) {
        if (i <= (lastSeedEnd.get(seed.conceptKey) ?? -1)) continue;
        const join2 = norm(`${t} ${cleanLine(allLines[i + 1] ?? "")}`);
        const hitWindow = re.test(t) ? ([i, i] as [number, number]) : re.test(join2) ? ([i, i + 1] as [number, number]) : null;
        if (hitWindow) {
          lastSeedEnd.set(seed.conceptKey, hitWindow[1]);
          out.push({
            conceptKey: seed.conceptKey,
            label: seed.label,
            display: (hitWindow[1] === i ? t : join2).slice(0, 300),
            qualifiers: {},
            category: seed.category,
            uncertainty: [...seed.uncertainty, "optional-section-footnote", ...(hitWindow[1] === i ? [] : ["wrapped-span"])],
            window: hitWindow,
            isOptional: false,
            section: section.name,
          });
        }
      }
      continue;
    }
    // benefits / eligibility: streaming flow parser (persistent label buffer).
    for (const { re, seed } of STATUS_SEEDS) {
      if (i <= (lastSeedEnd.get(seed.conceptKey) ?? -1)) continue;
      const join2 = norm(`${t} ${cleanLine(allLines[i + 1] ?? "")}`);
      const hitWindow = re.test(t) ? ([i, i] as [number, number]) : re.test(join2) ? ([i, i + 1] as [number, number]) : null;
      if (hitWindow) {
        lastSeedEnd.set(seed.conceptKey, hitWindow[1]);
        out.push({
          conceptKey: seed.conceptKey,
          label: seed.label,
          display: (hitWindow[1] === i ? t : join2).slice(0, 300),
          qualifiers: {},
          category: seed.category,
          uncertainty: [...seed.uncertainty, "benefits-section", ...(hitWindow[1] === i ? [] : ["wrapped-span"])],
          window: hitWindow,
          isOptional: false,
          section: section.name,
        });
      }
    }
    for (const c of ingest(i, raw)) {
      // doc-3 pairs: same key+label appears twice (Basic column row, then
      // Choice column row). Qualify by occurrence order, explicitly flagged.
      const occ = occurrenceByKey.get(c.conceptKey) ?? 0;
      occurrenceByKey.set(c.conceptKey, occ + 1);
      if (docId === "doc-3" && !c.qualifiers.planTier) {
        const tiers3 = ["basic", "choice"];
        c.qualifiers.planTier = tiers3[occ % 2];
        c.uncertainty.push("tier-by-occurrence");
      }
      out.push(c);
    }
  }
  // Whole-document eligibility pass (see parseEligibilityWholeDoc).
  out.push(...parseEligibilityWholeDoc(allLines, sectionMap));
  // Merge adjacent seed-born candidates (same key, gap ≤ 1 line) — seeds
  // otherwise emit one candidate per line of a wrapped passage.
  const merged: ParsedCandidate[] = [];
  for (const c of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.category !== "benefit" && prev.category !== "eligibility" &&
      prev.conceptKey === c.conceptKey && c.window[0] - prev.window[1] <= 1) {
      prev.window = [prev.window[0], c.window[1]];
      if (!prev.display.includes(c.display.slice(0, 40))) prev.display = `${prev.display} ${c.display}`.slice(0, 400);
      for (const u of c.uncertainty) if (!prev.uncertainty.includes(u)) prev.uncertainty.push(u);
      continue;
    }
    merged.push(c);
  }
  return merged;
}

function tiersForPage(docId: string, pageOfLine: number[], lineIdx: number, pages: string[]): string[] | null {
  const page = pageOfLine[Math.min(lineIdx, pageOfLine.length - 1)];
  return detectTierVocab(docId, pages[page - 1] ?? "");
}

// ---------------------------------------------------------------- discovery

export function discoverCandidates(
  docs: SourceDoc[],
  pageTexts: Map<string, string[]>,
): CandidateFact[] {
  const plans: ProvenPlan[] = attestPlans(docs);
  const out: CandidateFact[] = [];

  for (const doc of docs) {
    const pages = pageTexts.get(doc.documentId) ?? doc.pages;
    const parsed = parseDocument(doc.documentId, pages);
    const flat = flattenLines(pages);

    // Evidence verification (fail-closed). A candidate whose own window does
    // not verify uniquely is widened MINIMALLY upward (and one wrapped line
    // forward) until a unique span is proven; if nothing verifies, the
    // candidate is dropped — never repaired or fabricated.
    for (const c of parsed) {
      const page = pageOfLineFor(c.window[0], pages);
      const windowLines = flat.slice(c.window[0], c.window[1] + 1).map(cleanLine).filter(Boolean);
      const forward = (() => {
        const next = cleanLine(flat[c.window[1] + 1] ?? "");
        const last = windowLines[windowLines.length - 1] ?? "";
        return next && !/[.:]$/.test(last) ? next : null;
      })();
      const quoteOptions: { quote: string; flag?: string }[] = [
        { quote: windowLines.join("\n") },
        { quote: windowLines[windowLines.length - 1] ?? "" },
        ...(forward ? [{ quote: `${windowLines.join("\n")}\n${forward}`, flag: "forward-continuation" }] : []),
      ];
      // upward widening: extend the window above its start, capped depth
      const maxWiden = 6;
      for (let d = 1; d <= maxWiden; d++) {
        const extended = flat
          .slice(Math.max(0, c.window[0] - d), c.window[1] + 1)
          .map(cleanLine).filter(Boolean);
        if (extended.join("\n") === quoteOptions[0].quote) break;
        quoteOptions.push({ quote: extended.join("\n"), flag: "widened-evidence-window" });
      }
      let verified: { documentId: string; page: number; quote: string } | null = null;
      let usedFlag: string | undefined;
      for (const { quote, flag } of quoteOptions) {
        if (!quote.trim()) continue;
        const v = verifyEvidenceCitation(docs, { documentId: doc.documentId, page, quote });
        if (v.ok) { verified = { documentId: doc.documentId, page, quote: v.quote }; usedFlag = flag; break; }
      }
      if (!verified) continue; // fail closed: no provable span → no candidate
      out.push({
        documentId: doc.documentId,
        page,
        conceptKey: c.conceptKey,
        label: c.label,
        display: c.display,
        qualifiers: c.qualifiers,
        section: c.section,
        isOptional: c.isOptional,
        category: c.category,
        uncertainty: usedFlag ? [...c.uncertainty, usedFlag] : c.uncertainty,
        evidence: [verified],
      });
    }
  }

  // ---- plan attribution (production C6 helpers, unchanged semantics) ----
  const groups = new Map<string, CandidateFact[]>();
  for (const c of out) {
    if (c.isOptional) continue;
    const key = `${c.documentId}::${c.conceptKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    const pseudoValues = arr.map((c) => ({
      documentId: c.documentId,
      display: c.display,
      qualifiers: c.qualifiers as Record<string, unknown>,
      evidence: c.evidence,
    })) as unknown as Parameters<typeof resolveRowPlanIds>[1];
    const ids = resolveRowPlanIds(arr[0].conceptKey, pseudoValues, plans, docs);
    arr.forEach((c, i) => { if (ids[i]) c.planId = ids[i]; });
  }
  return out;
}

function flattenLines(pages: string[]): string[] {
  const out: string[] = [];
  for (const p of pages) out.push(...p.split(/\r?\n/));
  return out;
}

function pageOfLineFor(globalLineIdx: number, pages: string[]): number {
  let count = 0;
  for (const [i, p] of pages.entries()) {
    const n = p.split(/\r?\n/).length;
    if (globalLineIdx < count + n) return i + 1;
    count += n;
  }
  return pages.length;
}
