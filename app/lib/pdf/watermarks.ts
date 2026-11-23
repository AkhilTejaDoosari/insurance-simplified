// Watermark artifacts removed at extraction (owner decision 2026-11-22 (6)).
//
// A specimen overlay ("SAMPLE", "For Inquiry Purposes Only", "Specimen",
// "Draft") is drawn as its own text item on most pages; joined into page text
// it glues onto adjacent content ("$1,500SAMPLE") and splits sentences. Such
// an item is removed BEFORE the page text is joined, so page text, table
// spans and citation offsets stay consistent.
//
// An item string is an artifact only when it is, in full, a named specimen
// overlay phrase (SAMPLE, SPECIMEN, DRAFT, FOR INQUIRY PURPOSES ONLY, NOT FOR
// DISTRIBUTION, CONFIDENTIAL) drawn as an overlay (rotated, or at least
// twice the page's median font size) as a whole text item on at least 60% of
// the document's pages (and on at least 3). Any other repeated text — column
// headings, banners, conditions, plan names — is kept (review of 5454ea2:
// an allow-list, never a guess about what other words mean). Never removed
// either: an item on the first two lines of
// page 1 (the document title read for plan identity), and a string that is a
// table cell or row label on its own on any page. A removed item's line break
// moves to the item before it. What was removed is reported per page as a
// count only (no text).
//
// Pure and deterministic.

import { detectTables, positionItems, type RawTextItem } from "@/app/lib/pdf/layout-tables";

const MIN_PAGES = 3;
const MIN_SHARE = 0.6;
const MAX_WORDS = 6;

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** An item is an overlay only when it is drawn rotated or at least twice
 *  the page's median font size, and only a named specimen-overlay phrase is
 *  ever removed. */
const OVERLAY_SCALE = 2;
const OVERLAY_PHRASES = new Set(["sample", "specimen", "draft", "for inquiry purposes only", "not for distribution", "confidential"]);
const size = (it: RawTextItem) => Math.hypot(it.transform[0], it.transform[1]);
const rotated = (it: RawTextItem) => Math.abs(it.transform[1]) > 0.01 || Math.abs(it.transform[2]) > 0.01;
function overlayFlags(items: RawTextItem[]): boolean[] {
  const sizes = items.filter((it) => norm(it.str)).map(size).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  return items.map((it) => !!norm(it.str) && (rotated(it) || (median > 0 && size(it) >= OVERLAY_SCALE * median)));
}
const removable = (s: string) => OVERLAY_PHRASES.has(s.toLowerCase());

export interface ArtifactRemoval {
  items: RawTextItem[][];
  /** Pages with at least one removed item: 1-based page and item count. */
  removed: { page: number; count: number }[];
}

/** Indexes of page-1 items that START one of its first two lines (a title
 *  line; a trailing overlay item on the same line is not protected). */
function protectedOnPageOne(items: RawTextItem[]): Set<number> {
  const keep = new Set<number>();
  let lines = 0;
  let lineStart = true;
  for (let i = 0; i < items.length && lines < 2; i++) {
    const s = norm(items[i].str);
    if (s && lineStart) keep.add(i);
    if (s) lineStart = false;
    if (items[i].hasEOL) { lines++; lineStart = true; }
  }
  return keep;
}

function tableTexts(pages: RawTextItem[][]): Set<string> {
  const out = new Set<string>();
  pages.forEach((items, i) => {
    try {
      const { text, items: positioned } = positionItems(items);
      for (const t of detectTables(text, positioned, i + 1)) {
        for (const row of t.rows) {
          out.add(norm(row.label.text));
          for (const cell of row.cells) out.add(norm(cell.text));
        }
      }
    } catch {
      // Table reading never blocks extraction; nothing is protected from it.
    }
  });
  return out;
}

export function removeRepeatedArtifacts(pages: RawTextItem[][]): ArtifactRemoval {
  const n = pages.length;
  const threshold = Math.max(MIN_PAGES, Math.ceil(n * MIN_SHARE));
  if (n < MIN_PAGES) return { items: pages, removed: [] };

  const flags = pages.map(overlayFlags);
  const pagesWith = new Map<string, number>();
  for (const [p, items] of pages.entries()) {
    for (const s of new Set(items.filter((_, k) => flags[p][k]).map((it) => norm(it.str)).filter(Boolean))) {
      pagesWith.set(s, (pagesWith.get(s) ?? 0) + 1);
    }
  }
  const candidates = [...pagesWith.entries()]
    .filter(([s, count]) => count >= threshold && !/\d/.test(s) && s.split(" ").length <= MAX_WORDS && /[A-Za-z]/.test(s) && removable(s))
    .map(([s]) => s);
  if (candidates.length === 0) return { items: pages, removed: [] };

  const inTables = tableTexts(pages);
  const artifacts = new Set(candidates.filter((s) => !inTables.has(s)));
  const titleItems = protectedOnPageOne(pages[0] ?? []);
  if (artifacts.size === 0) return { items: pages, removed: [] };

  const removed: { page: number; count: number }[] = [];
  const items = pages.map((pageItems, i) => {
    const out: RawTextItem[] = [];
    let count = 0;
    for (const [k, it] of pageItems.entries()) {
      if (flags[i][k] && artifacts.has(norm(it.str)) && !(i === 0 && titleItems.has(k))) {
        count++;
        // Keep the line break the removed item carried.
        if (it.hasEOL && out.length > 0) out[out.length - 1] = { ...out[out.length - 1], hasEOL: true };
        continue;
      }
      out.push(it);
    }
    if (count > 0) removed.push({ page: i + 1, count });
    return out;
  });
  return { items, removed };
}
