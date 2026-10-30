// Material-value condition helpers shared by extraction (binding conditions
// onto values) and the UI (rendering them), so both sides apply the SAME rule
// for whether a multi-figure value's amounts are attributed. Pure functions
// only: no I/O, no model output, no invented labels (V1.1 M2 tasks 5-6).

import type { CellValue } from "@/app/lib/extraction/types";

const AMOUNT_PATTERN = /\$\s?[\d,]+(?:\.\d+)?/g;
const PERCENT_PATTERN = /\d+(?:\.\d+)?\s*%/g;

// Choice words must introduce these dollar figures, not an unrelated service
// elsewhere in the passage ("Choose your doctor" is not a copay option).
const OPTION_LANGUAGE =
  /\b(?:options?|choose|choosing|selectable|select|selected|your choice|range)\b[^.?!;\n]{0,80}\$\s?[\d,]+/i;
const OPTION_RANGE = /\$\s?[\d,]+\s*(?:to|through|-|–|—)\s*\$\s?[\d,]+/i;
const OPTION_LIST = /\$\s?[\d,]+(?:\s*,\s*|\s+or\s+)\$\s?[\d,]+/i;

/** Every monetary or percentage figure in a display, in source order. */
export function amounts(display: string): string[] {
  return [...(display.match(AMOUNT_PATTERN) ?? []), ...(display.match(PERCENT_PATTERN) ?? [])];
}

/** Dollar figures only: a set of these is a candidate option list, while
 *  percentages are never "purchased" choices. */
export function moneyAmounts(display: string): number {
  return amounts(display).filter((a) => a.trim().startsWith("$")).length;
}

function normalizeAmount(a: string): string {
  return a.replace(/[,\s]/g, "").toLowerCase();
}

function displayAmountSet(display: string): Set<string> {
  return new Set(amounts(display).map(normalizeAmount));
}

/** A candidate option phrase is relevant only when its dollar amounts are the
 *  same figures that appear in the value's display. An unrelated "$0 to $2,500"
 *  sentence must not bind a "$500 / $1,000" deductible pair. */
function phraseOffersChoices(phrase: string, displayAmounts: Set<string>): boolean {
  const phraseAmounts = amounts(phrase).map(normalizeAmount);
  return phraseAmounts.length >= 2 && phraseAmounts.every((a) => displayAmounts.has(a));
}

/** The source names a set of choices (range, enumeration, option language)
 *  that apply to this display's figures. Those figures are available options,
 *  never proof of a purchase. */
export function offersChoices(display: string, text: string): boolean {
  const displayAmounts = displayAmountSet(display);
  if (displayAmounts.size < 2) return false;
  for (const pattern of [OPTION_LANGUAGE, OPTION_RANGE, OPTION_LIST]) {
    const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (phraseOffersChoices(m[0], displayAmounts)) return true;
    }
  }
  return false;
}

/** A single qualifier on a cell does not attribute every figure in it. Each
 * figure needs its own adjacent, source-stated applicability label. */
function scopesAmounts(value: CellValue): boolean {
  const figure = /\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/g;
  const label = /\b(?:in-network|out-of-network|outside (?:the )?(?:US|U\.S\.|United States)|ages?\s*\d+\s*[-–—]\s*\d+|under\s+\d+|over\s+\d+)\b/i;
  return [value.display, ...value.evidence.map((e) => e.quote)].some((text) => {
    const parts = text.split(/\s*(?:\/|;|\band\b)\s*/i);
    const scoped = parts.filter((part) => (part.match(figure) ?? []).length > 0);
    const figures = amounts(value.display);
    return scoped.length === figures.length &&
      scoped.every((part, index) => (part.match(figure) ?? []).length === 1 &&
        (part.match(figure) ?? [])[0]?.replace(/\s+/g, "") === figures[index].replace(/\s+/g, "") &&
        label.test(part));
  });
}

/** A multi-figure value is understood only when the source offers a choice or
 *  names the slice each figure belongs to; otherwise it is unresolved. The
 *  extractor downgrades such a row and the renderer asks the same question. */
export function conditionBindingKnown(value: CellValue): boolean {
  if (amounts(value.display).length < 2) return true;
  const text = [value.display, ...value.evidence.map((e) => e.quote)].join("\n");
  return offersChoices(value.display, text) || scopesAmounts(value);
}
