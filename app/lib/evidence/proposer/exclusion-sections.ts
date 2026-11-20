// C1 candidate proposer, exclusion kind — document STRUCTURE only
// (evidence-core.md §4 C1; EC-3, EC-6, EC-7).
//
// Finds exclusion sections by their heading and splits each section into its
// enumerated items (or, without enumeration, its complete sentences). Every
// item is an exact span of the stored page text; nothing is paraphrased,
// joined across pages or inferred from proximity. Pure: reads only the page
// texts passed in.
//
// Owner-reviewable defaults (adapter data for the health domain):
//   - EXCLUSION_HEADING: the closed heading grammar below. "Limitations"
//     alone, a bare "Not covered" (a table cell in SBCs) and mixed headings
//     ("Excluded Services & Other Covered Services") are NOT exclusion
//     headings.
//   - FRAMING (EC-6): a heading with framing words yields nothing; a framing
//     line (short heading-shaped line with a framing word, or a line opening
//     with "For example"/"Example"/"e.g.") opens a region that lasts until a
//     non-framing, non-exclusion heading; an exclusion heading inside it
//     yields nothing; an item with a framing word is dropped; a running
//     header/footer with a framing word frames the whole document.
//   - A section ends at the next heading-shaped line, another exclusion
//     heading, a framing line, or the page end. A list continues onto the
//     next page only when that page's first content lines resume the same
//     list in sequence; an item cut by a page break is dropped.
// Ambiguity drops the item (counted); it never widens or completes one.

export type DropReason =
  | "framing"
  | "cut-by-page-break"
  | "unfinished"
  | "out-of-sequence"
  | "running-line-inside"
  | "no-text";

export interface ExclusionItemSpan {
  /** 1-based page. */
  page: number;
  /** Offsets into the stored page text of the item text (marker excluded). */
  start: number;
  end: number;
  /** Offset where the item's marker (bullet / enumerator) starts. */
  markerStart: number;
  /** Index of the section on the document (0-based, in reading order). */
  section: number;
}

export interface ExclusionSection {
  index: number;
  page: number;
  /** Offsets of the heading line in the page text. */
  headingStart: number;
  headingEnd: number;
  /** Last page the section reaches. */
  endPage: number;
}

export interface SectionScan {
  sections: ExclusionSection[];
  /** Exclusion headings found but framed (EC-6): nothing proposed for them. */
  framedSections: number;
  items: ExclusionItemSpan[];
  dropped: { page: number; reason: DropReason }[];
  /** True when a running header/footer carries framing: nothing proposed. */
  documentFramed: boolean;
}

const ENUM_PREFIX = String.raw`(?:(?:section|part|article)\s+[\w.]{1,6}\s*[-–—:.]?\s*|[A-Z]\.\s+|[IVXL]{1,5}\.\s+|\d{1,2}(?:\.\d{1,2})*\.?\s+|\(\w{1,3}\)\s+)?`;
const QUALIFIER = String.raw`(?:(?:general|medical|plan|policy|specific|additional|common|major|standard|benefit|other)\s+)?`;
const CORE = String.raw`(?:exclusions?(?:\s+(?:and|&)\s+limitations?)?|limitations?\s+(?:and|&)\s+exclusions?|what\s+(?:is\s+not|isn['’]t|is\s+NOT)\s+covered|what\s+(?:this|the|your)\s+(?:plan|policy)\s+(?:does\s+not|doesn['’]t)\s+cover|services\s+(?:your|this|the)\s+plan\s+(?:generally\s+)?does\s+not\s+cover|excluded\s+(?:services|expenses|charges)|(?:services|expenses|charges)\s+not\s+covered)`;

/** Standalone heading line: optional enumerator, the core phrase, optional
 *  parenthetical, optional colon — nothing else on the line. */
export const EXCLUSION_HEADING = new RegExp(`^${ENUM_PREFIX}${QUALIFIER}(${CORE})\\s*(?:\\([^()]{0,240}\\))?\\s*:?\\s*$`, "i");
/** Inline heading: the core phrase in capitals followed by a colon and the
 *  section's preamble on the same line (e.g. "Q. EXCLUSIONS: Except …"). */
const INLINE_HEADING = new RegExp(`^${ENUM_PREFIX}${QUALIFIER}(${CORE}):\\s+\\S`, "i");

export const FRAMING = /\b(?:examples?|for instance|illustrat\w*|hypothetical\w*|samples?|specimen|scenarios?|fictional|fictitious|competitors?|another plan|other plans|comparable plans?|alternative plans?)\b/i;
/** A line that points elsewhere ("see the next section") does not frame. */
const POINTER = /\b(?:see|refer to)\b/i;
const FRAMING_OPENER = /^(?:for example\b|example\b|e\.g\.)/i;

const BULLET = /^([•●▪◦‣∙·○■□◼➢►✓\-–*])\s+/;
const ENUMS: { style: string; re: RegExp; ordinal: (m: string) => number }[] = [
  { style: "(n)", re: /^\((\d{1,3})\)\s+/, ordinal: (m) => Number(m) },
  { style: "n.", re: /^(\d{1,3})[.)]\s+/, ordinal: (m) => Number(m) },
  { style: "(a)", re: /^\(([a-z])\)\s+/, ordinal: (m) => m.charCodeAt(0) - 96 },
  { style: "a.", re: /^([a-z])[.)]\s+/, ordinal: (m) => m.charCodeAt(0) - 96 },
];

/** A line ending this way is not a finished item: a break after it is
 *  ambiguous (the item may continue). */
const UNFINISHED_END = /(?:[,\-–(/&]|\b(?:a|an|the|of|or|and|to|for|in|on|by|with|when|not|that|which|from|as|at|any|other|than|including|such))$/i;
const TERMINAL = /[.;!?]["’”)]?$/;

interface Line {
  text: string; // trimmed
  start: number; // offset of trimmed text in page
  end: number;
}

function linesOf(page: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of page.split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    out.push({ text, start: pos + lead, end: pos + lead + text.length });
    pos += raw.length + 1;
  }
  return out;
}

function runningKey(text: string): string {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

const PAGE_NUMBER = /^(?:page\s*)?#(?:\s*(?:of|\/)\s*#)?$/;

/** Running headers/footers: a line (digits normalized) on at least
 *  max(3, half the pages) pages, or a bare page number. */
function runningLines(pages: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const key of new Set(linesOf(page).map((l) => runningKey(l.text)).filter(Boolean))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length / 2));
  const out = new Set<string>();
  for (const [key, n] of counts) if (n >= threshold || PAGE_NUMBER.test(key)) out.add(key);
  return out;
}

function stripParenthetical(text: string): string {
  return text.replace(/\s*\([^()]*\)\s*:?\s*$/, "").replace(/:\s*$/, "").trim();
}

/** Heading-shaped: short, starts with a capital, not sentence-ending, and
 *  ALL CAPS or mostly capitalized words. */
export function headingShaped(text: string): boolean {
  const core = stripParenthetical(text.replace(/^(?:[A-Z]|[IVXL]{1,5}|\d{1,2}(?:\.\d{1,2})*)\.\s+/, ""));
  if (core.length < 2 || core.length > 80) return false;
  if (!/^[A-Z]/.test(core) || /[.,;]$/.test(core)) return false;
  // Text glued across a sentence end ("…America.SAMPLE") is not a heading.
  if (/[a-z]\.[A-Za-z]{2}/.test(core)) return false;
  const words = core.split(/\s+/);
  if (words.length > 10) return false;
  const letters = core.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  const significant = words.filter((w) => /^[A-Za-z]/.test(w) && w.replace(/[^A-Za-z]/g, "").length > 3);
  if (significant.length === 0) return words.length <= 3;
  return significant.filter((w) => /^[A-Z]/.test(w)).length / significant.length >= 0.6;
}

function isExclusionHeading(text: string): "standalone" | "inline" | undefined {
  if (EXCLUSION_HEADING.test(text)) {
    // The heading must be heading-cased: its first letter after any
    // enumerator is a capital (a sentence fragment is not a heading).
    const body = text.replace(new RegExp(`^${ENUM_PREFIX}`, "i"), "");
    return /^[A-Z]/.test(body) ? "standalone" : undefined;
  }
  const inline = INLINE_HEADING.exec(text);
  if (inline && inline[1] === inline[1].toUpperCase()) return "inline";
  return undefined;
}

function isFramingLine(text: string): boolean {
  if (FRAMING_OPENER.test(text)) return true;
  return FRAMING.test(text) && headingShaped(text);
}

function markerOf(text: string): { style: string; ordinal?: number; length: number } | undefined {
  const b = BULLET.exec(text);
  if (b) return { style: "bullet", length: b[0].length };
  for (const e of ENUMS) {
    const m = e.re.exec(text);
    if (m) return { style: e.style, ordinal: e.ordinal(m[1]), length: m[0].length };
  }
  return undefined;
}

interface OpenItem {
  page: number;
  markerStart: number;
  start: number;
  end: number;
  lastLine: string;
  runningInside: boolean;
}

/** Scan every page for exclusion sections and their items. */
export function scanExclusionSections(pages: readonly string[]): SectionScan {
  const scan: SectionScan = { sections: [], framedSections: 0, items: [], dropped: [], documentFramed: false };
  const running = runningLines(pages);
  if ([...running].some((key) => FRAMING.test(key))) {
    scan.documentFramed = true;
    return scan;
  }
  const pageLines = pages.map(linesOf);
  const isRunning = (l: Line) => !l.text || running.has(runningKey(l.text));
  let framed = false;
  let p = 0;
  let i = 0;
  while (p < pageLines.length) {
    const lines = pageLines[p];
    if (i >= lines.length) { p++; i = 0; continue; }
    const line = lines[i];
    if (isRunning(line)) { i++; continue; }
    const kind = isExclusionHeading(line.text);
    if (!kind) {
      if (isFramingLine(line.text)) framed = true;
      else if (headingShaped(line.text) && !markerOf(line.text)) framed = false;
      i++;
      continue;
    }
    // EC-6: framed by an open region, by its own words, or by any line
    // above it on its page that carries a framing word (an example page) —
    // except a line that only points to examples elsewhere ("see …").
    const window = lines.slice(0, i).filter((l) => !isRunning(l));
    if (framed || FRAMING.test(line.text) || window.some((l) => FRAMING.test(l.text) && !POINTER.test(l.text))) {
      scan.framedSections++;
      i++;
      continue;
    }
    const section: ExclusionSection = { index: scan.sections.length, page: p + 1, headingStart: line.start, headingEnd: line.end, endPage: p + 1 };
    scan.sections.push(section);
    const resume = readSection(scan, section, pageLines, p, i, kind, isRunning);
    // Always make progress past the heading.
    if (resume.page - 1 === p && resume.line <= i) { i++; continue; }
    p = resume.page - 1;
    i = resume.line;
  }
  return scan;
}

/** True when the line ends the current section. */
function endsSection(text: string, listStyle: string | undefined): boolean {
  if (isExclusionHeading(text) || isFramingLine(text)) return true;
  const m = markerOf(text);
  if (m && listStyle !== undefined) return false; // markers are handled by the list reader
  if (m) return false;
  return headingShaped(text);
}

/** Read one section starting at its heading line. Returns where scanning
 *  resumes: `{ page: 1-based page, line: next unread line index }`. */
function readSection(
  scan: SectionScan,
  section: ExclusionSection,
  pageLines: Line[][],
  p: number,
  headingLine: number,
  kind: "standalone" | "inline",
  isRunning: (l: Line) => boolean,
): { page: number; line: number } {
  const lines = pageLines[p];
  let i = headingLine + 1;
  // Preamble: the inline heading's own text, plus lines up to one ending in
  // ":" — at most 8 lines; a list must follow it.
  let preamble = kind === "inline" && !/:\s*$/.test(lines[headingLine].text);
  if (kind === "standalone" && i < lines.length && !markerOf(lines[i].text) && !endsSection(lines[i].text, undefined)) {
    // A standalone heading followed by prose ending in ":" introduces a list.
    let k = i;
    while (k < lines.length && k < i + 8 && !/:\s*$/.test(lines[k].text) && !markerOf(lines[k].text)) k++;
    if (k < lines.length && /:\s*$/.test(lines[k].text) && k + 1 < lines.length && markerOf(lines[k + 1].text)) i = k + 1;
  }
  if (preamble) {
    let k = i;
    while (k < lines.length && k < i + 8 && !/:\s*$/.test(lines[k].text) && !markerOf(lines[k].text)) k++;
    if (k < lines.length && /:\s*$/.test(lines[k].text)) { i = k + 1; preamble = false; }
    else if (k < lines.length && markerOf(lines[k].text) && /:\s*$/.test(lines[k - 1]?.text ?? "")) { i = k; preamble = false; }
  }
  if (preamble) return { page: p + 1, line: i };
  while (i < lines.length && isRunning(lines[i])) i++;
  if (i >= lines.length) return { page: p + 1, line: i };
  const first = markerOf(lines[i].text);
  if (first) return readList(scan, section, pageLines, p, i, first.style, isRunning);
  if (kind === "inline") return { page: p + 1, line: i }; // inline preambles introduce lists only
  return readSentences(scan, section, pageLines, p, i, isRunning);
}

function closeItem(scan: SectionScan, section: ExclusionSection, item: OpenItem | undefined, reason?: DropReason): void {
  if (!item) return;
  if (reason) { scan.dropped.push({ page: item.page, reason }); return; }
  if (item.runningInside) { scan.dropped.push({ page: item.page, reason: "running-line-inside" }); return; }
  if (item.end <= item.start) { scan.dropped.push({ page: item.page, reason: "no-text" }); return; }
  scan.items.push({ page: item.page, start: item.start, end: item.end, markerStart: item.markerStart, section: section.index });
}

function readList(
  scan: SectionScan,
  section: ExclusionSection,
  pageLines: Line[][],
  startPage: number,
  startLine: number,
  style: string,
  isRunning: (l: Line) => boolean,
): { page: number; line: number } {
  let expected = 1;
  let item: OpenItem | undefined;
  let p = startPage;
  let i = startLine;
  for (;;) {
    const lines = pageLines[p];
    let pendingRunning = false;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (isRunning(line)) { if (item) pendingRunning = true; continue; }
      const m = markerOf(line.text);
      if (m && m.style === style) {
        if (m.ordinal !== undefined && m.ordinal !== expected) {
          // Out of sequence: the list structure is not what it seems.
          closeItem(scan, section, item, "out-of-sequence");
          section.endPage = p + 1;
          return { page: p + 1, line: i };
        }
        closeItem(scan, section, item);
        expected++;
        item = { page: p + 1, markerStart: line.start, start: line.start + m.length, end: line.end, lastLine: line.text, runningInside: false };
        pendingRunning = false;
        continue;
      }
      if (!m && endsSection(line.text, style)) {
        const unfinished = item && UNFINISHED_END.test(item.lastLine);
        closeItem(scan, section, item, unfinished ? "unfinished" : undefined);
        section.endPage = p + 1;
        return { page: p + 1, line: i };
      }
      // Continuation (including nested enumerations of another style).
      if (item) {
        if (pendingRunning) item.runningInside = true;
        item.end = line.end;
        item.lastLine = line.text;
      }
    }
    // Page end inside the list: resume only if the next page's first content
    // lines continue the same list in sequence.
    const next = pageLines[p + 1];
    if (!next) {
      closeItem(scan, section, item, item && !TERMINAL.test(item.lastLine) ? "cut-by-page-break" : undefined);
      section.endPage = p + 1;
      return { page: p + 1, line: lines.length };
    }
    let k = 0;
    while (k < next.length && isRunning(next[k])) k++;
    const m = k < next.length ? markerOf(next[k].text) : undefined;
    if (m && m.style === style && (m.ordinal === undefined || m.ordinal === expected)) {
      closeItem(scan, section, item); // next page starts a new item: this one ended
      item = undefined;
      p++;
      i = k;
      section.endPage = p + 1;
      continue;
    }
    // Next page continues text: the open item is cut by the page break.
    closeItem(scan, section, item, item ? "cut-by-page-break" : undefined);
    item = undefined;
    let j = k;
    while (j < next.length && j < k + 15) {
      const mm = markerOf(next[j].text);
      if (mm && mm.style === style && (mm.ordinal === undefined || mm.ordinal === expected)) break;
      if (!mm && !isRunning(next[j]) && endsSection(next[j].text, style)) { j = next.length; break; }
      j++;
    }
    if (j < next.length && j < k + 15) {
      p++;
      i = j;
      section.endPage = p + 1;
      continue;
    }
    section.endPage = p + 1;
    return { page: p + 1, line: lines.length };
  }
}

function readSentences(
  scan: SectionScan,
  section: ExclusionSection,
  pageLines: Line[][],
  p: number,
  startLine: number,
  isRunning: (l: Line) => boolean,
): { page: number; line: number } {
  const lines = pageLines[p];
  let i = startLine;
  const body: Line[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (isRunning(line)) break; // a running line ends the page body
    if (markerOf(line.text) || endsSection(line.text, undefined)) break;
    body.push(line);
  }
  section.endPage = p + 1;
  if (body.length === 0) return { page: p + 1, line: i };
  // Sentences: each ends with terminal punctuation at a line end or before
  // whitespace and a capital; a trailing fragment is dropped (unfinished).
  let cursor: { page: number; start: number } | undefined;
  for (const line of body) {
    const re = /[.;!?]["’”)]?(?=\s+[A-Z(]|$)/g;
    let from = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line.text))) {
      const endInLine = match.index + match[0].length;
      const start = cursor ? cursor.start : line.start + from + (line.text.slice(from).length - line.text.slice(from).trimStart().length);
      scan.items.push({ page: p + 1, start, end: line.start + endInLine, markerStart: start, section: section.index });
      cursor = undefined;
      from = endInLine;
    }
    const rest = line.text.slice(from);
    if (rest.trim() && !cursor) cursor = { page: p + 1, start: line.start + from + (rest.length - rest.trimStart().length) };
  }
  if (cursor) scan.dropped.push({ page: p + 1, reason: "unfinished" });
  return { page: p + 1, line: i };
}
