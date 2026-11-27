// Deterministic PDF text-to-coordinate matching for evidence highlights.
// Takes pdf.js page text items plus the cited quote and returns highlight
// geometry in PDF point coordinates — or null when no UNIQUE confident
// match exists. Pure and dependency-free so it is unit-testable without a
// PDF renderer.
//
// Match policy (in order):
//   A. normalized exact contiguous match across the item stream.
//   B. same, additionally tolerating safe line-wrap hyphenation
//      ("hy-\nphen" cited as "hyphen").
// No broad fuzzy matching: zero matches or several matches both yield null,
// and the caller must fall back honestly rather than highlight arbitrarily.

export interface PdfTextItemInput {
  str: string;
  /** True when a line break follows this item (pdf.js hasEOL). */
  hasEOL: boolean;
  /** Item transform [a,b,c,d,e,f]; e,f locate the baseline origin. */
  transform: number[];
  width: number;
  height: number;
}

export interface HighlightRect {
  /** PDF point coordinates: [x0, y0, x1, y1] in unscaled page space. */
  box: [number, number, number, number];
  item: number;
}

const SOFT_HYPHEN = /\u00AD/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2039\u203A\u2032]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
const WHITESPACE_RUN = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/** Normalize one raw string with the same rules used for items and quotes:
 *  soft hyphens removed, Unicode quote/dash variants unified, every
 *  whitespace run (spaces, NBSPs, line breaks) collapsed to one space.
 *  Deliberately NOT trimmed: trimming happens once on the joined stream
 *  (and the final quote) so spaces between adjacent items survive. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(SOFT_HYPHEN, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(WHITESPACE_RUN, " ");
}

interface JoinedText {
  /** Fully normalized searchable text (collapsed + trimmed). */
  text: string;
  /** For each char of text: source item index and offset into that item's
   *  normalized text. */
  map: { item: number; offset: number }[];
  /** Normalized length of each source item (for partial-match fractions). */
  itemLengths: number[];
}

/** Join normalized items into one searchable string with exact back-mapping.
 *  Items join with "" on the same line and "\n" across line breaks; the
 *  whole stream is then collapsed/trimmed exactly like the quote. With
 *  stripWrapHyphens, hyphen-followed-by-whitespace (a line-wrap artifact,
 *  never genuine punctuation mid-word) is dropped BEFORE collapsing so the
 *  surviving map stays exact. */
function joinItems(items: PdfTextItemInput[], stripWrapHyphens: boolean): JoinedText {
  // Per item: normalized text with edge whitespace trimmed (fractions stay
  // exact), remembering whether a word gap bordered the item.
  const parts = items.map((item) => {
    const normalized = normalizeForMatch(item.str);
    const trimmed = normalized.trim();
    return {
      text: trimmed,
      leading: normalized.length > 0 && normalized[0] === " ",
      trailing: normalized.length > 0 && normalized[normalized.length - 1] === " ",
    };
  });
  let raw = "";
  let rawMap: { item: number; offset: number }[] = [];
  const itemLengths: number[] = [];
  parts.forEach((part, index) => {
    itemLengths.push(part.text.length);
    for (let i = 0; i < part.text.length; i++) {
      raw += part.text[i];
      rawMap.push({ item: index, offset: i });
    }
    if (index < items.length - 1) {
      const nextLeading = parts[index + 1].leading;
      if (items[index].hasEOL) {
        raw += "\n";
        rawMap.push({ item: index, offset: part.text.length });
      } else if (part.trailing || nextLeading) {
        raw += " ";
        rawMap.push({ item: index, offset: part.text.length });
      }
    }
  });
  if (stripWrapHyphens) {
    let stripped = "";
    const strippedMap: { item: number; offset: number }[] = [];
    for (let i = 0; i < raw.length; ) {
      if (raw[i] === "-") {
        let j = i + 1;
        while (j < raw.length && (raw[j] === " " || raw[j] === "\n")) j++;
        if (j > i + 1) {
          i = j;
          continue;
        }
      }
      stripped += raw[i];
      strippedMap.push(rawMap[i]);
      i++;
    }
    raw = stripped;
    rawMap = strippedMap;
  }
  let text = "";
  const map: { item: number; offset: number }[] = [];
  for (let i = 0; i < raw.length; ) {
    const ch = raw[i];
    if (ch === " " || ch === "\n") {
      let j = i + 1;
      while (j < raw.length && (raw[j] === " " || raw[j] === "\n")) j++;
      if (text.length > 0 && j < raw.length) {
        text += " ";
        map.push(rawMap[i]);
      }
      i = j;
    } else {
      text += ch;
      map.push(rawMap[i]);
      i++;
    }
  }
  return { text, map, itemLengths };
}

function countOccurrences(haystack: string, needle: string, limit: number): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    if (count >= limit) return count;
    from = at + 1;
  }
}

function isHorizontal(transform: number[]): boolean {
  const b = transform[1] ?? 0;
  const c = transform[2] ?? 0;
  return Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6;
}

/** Convert a matched character range within one item to a PDF-space box.
 *  Partial horizontal matches scale by matched fraction; rotated/vertical
 *  text falls back to the whole item box rather than fake precision. */
function itemBox(
  item: PdfTextItemInput,
  itemLength: number,
  startOffset: number,
  endOffset: number
): [number, number, number, number] {
  const e = item.transform[4] ?? 0;
  const f = item.transform[5] ?? 0;
  if (!isHorizontal(item.transform) || itemLength === 0) {
    return [e, f, e + item.width, f + item.height];
  }
  const x0 = e + item.width * (Math.max(0, startOffset) / itemLength);
  const x1 = e + item.width * (Math.min(endOffset, itemLength) / itemLength);
  return [Math.min(x0, x1), f, Math.max(x0, x1), f + item.height];
}

export type PassageMatch =
  | { status: "unique"; rects: HighlightRect[] }
  | { status: "none" }
  | { status: "ambiguous" };

function matchOnce(
  items: PdfTextItemInput[],
  needle: string,
  stripWrapHyphens: boolean
): PassageMatch | null {
  const joined = joinItems(items, stripWrapHyphens);
  // Safe line-wrap hyphenation only: a hyphen followed by whitespace is a
  // wrap artifact, not punctuation. Second pass only, so genuine hyphens
  // always win the first pass.
  const haystack = joined.text;
  if (stripWrapHyphens) needle = needle.replace(/-\s+/g, "");
  const occurrences = countOccurrences(haystack, needle, 2);
  if (occurrences === 0) return null;
  if (occurrences > 1) return { status: "ambiguous" };
  const at = haystack.indexOf(needle);
  const byItem = new Map<number, { start: number; end: number }>();
  for (let k = 0; k < needle.length; k++) {
    const m = joined.map[at + k];
    if (!m) continue;
    const slot = byItem.get(m.item) ?? { start: m.offset, end: m.offset };
    slot.start = Math.min(slot.start, m.offset);
    slot.end = Math.max(slot.end, m.offset + 1);
    byItem.set(m.item, slot);
  }
  const rects: HighlightRect[] = [];
  for (const [itemIndex, span] of byItem) {
    rects.push({
      box: itemBox(items[itemIndex], joined.itemLengths[itemIndex] ?? 0, span.start, span.end),
      item: itemIndex,
    });
  }
  return { status: "unique", rects };
}

export function matchEvidencePassage(
  items: PdfTextItemInput[],
  quote: string
): PassageMatch {
  if (items.length === 0) return { status: "none" };
  const needle = normalizeForMatch(quote).trim();
  if (!needle) return { status: "none" };
  const first = matchOnce(items, needle, false);
  if (first !== null) return first;
  return matchOnce(items, needle, true) ?? { status: "none" };
}
