// P0-05: the presentation layer above EC-7's verbatim display.
//
// A claim is never a paraphrase. It is built only from verbatim pieces of the
// verified display, in a fixed shape per value kind, and re-checked against
// the value's own citations with the same material-token and
// negation/exception/network grammar as the display (checkDisplayGrounding).
// Every piece of the display that is not in the claim becomes a condition,
// shown beside the claim, so nothing is dropped. A label sub-note that states
// a negation, exception or network scope is never moved out of the claim:
// the headline must not read more favourably than the source. `sourceWording`
// is always the full verbatim display. When no claim can be built or
// verified, `claim` is null and the UI shows the verbatim display as before.
import { checkDisplayGrounding, statesScopingMarker } from "@/app/lib/evidence-verification";
import { LABEL_NOTE_SEPARATOR } from "@/app/lib/extraction/table-facts";
import type { CellValue } from "@/app/lib/extraction/types";

export type ClaimStatus = "supported" | "conditional" | "unconfirmed";

export interface FactDescription {
  /** Short verbatim-composed claim, or null when none could be verified. */
  claim: string | null;
  /** Verbatim pieces of the display that qualify the claim, in source order. */
  conditions: string[];
  status: ClaimStatus;
  /** The full verbatim display (EC-7). */
  sourceWording: string;
}

/** Longer single lines are not summarized: the verbatim display is shown. */
const MAX_LINE_CLAIM = 200;
/** Leading list marker of a source line: "•", "-", "(4)", "4.", "4)", "(b)",
 *  "b)". Lowercase letters only, so an initial ("A. Smith") is never cut. */
const LIST_MARKER = /^\s*(?:[•·▪◦*–-]|\(\s*(?:\d{1,2}|[a-z]|[ivx]{1,4})\s*\)|\d{1,2}[.)]|[a-z]\))\s+/;

interface Parts {
  claim: string;
  conditions: string[];
}

interface TableShape {
  heading: string;
  cell: string;
  lines: string[];
}

/** Table-cell display, built by table-facts.ts as
 *  `${label} (${heading}): ${cell}` + "\n" + each governing note. Null when
 *  the pieces do not rebuild the display exactly. */
function tableShape(display: string, label: string): TableShape | null {
  const [first, ...lines] = display.split("\n");
  const prefix = `${label} (`;
  if (!first.startsWith(prefix)) return null;
  const close = first.indexOf("): ", prefix.length);
  if (close < 0) return null;
  const heading = first.slice(prefix.length, close);
  const cell = first.slice(close + 3);
  if (!heading.trim() || !cell.trim()) return null;
  if ([`${label} (${heading}): ${cell}`, ...lines].join("\n") !== display) return null;
  return { heading, cell, lines };
}

/** The text that states the value itself: a table cell's own cell (not its
 *  label notes or governing notes), else the whole display. Used to tell a
 *  list of amounts to choose from apart from amounts in conditions. */
export function valueText(value: CellValue): string {
  if (value.anchor?.kind !== "table-cell") return value.display;
  return tableShape(value.display, value.anchor.label)?.cell ?? value.display;
}

function tableParts(display: string, label: string): Parts | null {
  const shape = tableShape(display, label);
  if (!shape) return null;
  const { heading, cell, lines } = shape;
  const notes = lines.map((line) => line.trim()).filter(Boolean);
  const [head, ...subNotes] = label.split(LABEL_NOTE_SEPARATOR).map((part) => part.trim());
  const labelNotes = subNotes.filter(Boolean);
  if (!head) return null;
  // A sub-note that negates, excepts or scopes the cell stays in the
  // headline, so the whole verbatim label is kept.
  const keepLabel = labelNotes.some(statesScopingMarker);
  return {
    claim: `${keepLabel ? label : head} (${heading}): ${cell}`,
    conditions: [...(keepLabel ? [] : labelNotes), ...notes],
  };
}

function lineParts(display: string): Parts | null {
  if (display.includes("\n") || display.length > MAX_LINE_CLAIM) return null;
  const claim = display.replace(LIST_MARKER, "").trim();
  return claim && display.endsWith(claim) ? { claim, conditions: [] } : null;
}

function unconfirmed(value: CellValue): FactDescription {
  return { claim: null, conditions: [], status: "unconfirmed", sourceWording: value.display };
}

export function describeFact(value: CellValue, factName: string): FactDescription {
  const parts = value.anchor?.kind === "table-cell"
    ? tableParts(value.display, value.anchor.label)
    : lineParts(value.display);
  if (!parts) return unconfirmed(value);
  // Table claims are re-derived structures (structural grammar: no flipped or
  // invented marker); line claims also get the dropped-marker rule.
  const grounding = checkDisplayGrounding(parts.claim, factName, value.evidence.map((e) => e.quote), {
    qualifiers: value.qualifiers as unknown as Record<string, unknown>,
    structural: !!value.anchor,
  });
  if (!grounding.supported) return unconfirmed(value);
  return {
    claim: parts.claim,
    conditions: parts.conditions,
    status: parts.conditions.length > 0 ? "conditional" : "supported",
    sourceWording: value.display,
  };
}
