// P0-05: the presentation layer above EC-7's verbatim display.
//
// A claim is never a paraphrase. It is built only from verbatim pieces of the
// verified display, in a fixed shape per value kind, and re-checked against
// the value's own citations with the same material-token and
// negation/exception/network grammar as the display (checkDisplayGrounding).
// Every piece of the display that is not in the claim becomes a condition,
// shown beside the claim, so nothing is dropped. `sourceWording` is always the
// full verbatim display. When no claim can be built or verified, `claim` is
// null and the UI shows the verbatim display exactly as before.
import { checkDisplayGrounding } from "@/app/lib/evidence-verification";
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
/** Leading list marker of a source line: "•", "-", "(4)", "4.", "(b)", "b)". */
const LIST_MARKER = /^\s*(?:[•·▪◦*–-]|\(\s*(?:\d{1,2}|[a-z]|[ivx]{1,4})\s*\)|(?:\d{1,2}|[a-z])[.)])\s+/i;
/** Separator between a table label's head and its sub-notes (labelHead). */
const LABEL_NOTE_SEPARATOR = /\s[•·]\s?/;

interface Parts {
  claim: string;
  /** The verbatim display pieces the claim is joined from. */
  pieces: string[];
  conditions: string[];
}

/** Table-cell display, built by table-facts.ts as
 *  `${label} (${heading}): ${cell}` + "\n" + each governing note. */
function tableParts(display: string, label: string): Parts | null {
  const [first, ...notes] = display.split("\n");
  const prefix = `${label} (`;
  if (!first.startsWith(prefix)) return null;
  const close = first.indexOf("): ", prefix.length);
  if (close < 0) return null;
  const heading = first.slice(prefix.length, close);
  const cell = first.slice(close + 3);
  if (!heading.trim() || !cell.trim()) return null;
  const [head, ...labelNotes] = label.split(LABEL_NOTE_SEPARATOR).map((part) => part.trim());
  if (!head) return null;
  const tail = `(${heading}): ${cell}`;
  return {
    claim: `${head} ${tail}`,
    pieces: [head, tail],
    conditions: [...labelNotes.filter(Boolean), ...notes.map((note) => note.trim()).filter(Boolean)],
  };
}

function lineParts(display: string): Parts | null {
  if (display.includes("\n") || display.length > MAX_LINE_CLAIM) return null;
  const claim = display.replace(LIST_MARKER, "").trim();
  return claim ? { claim, pieces: [claim], conditions: [] } : null;
}

function unconfirmed(value: CellValue): FactDescription {
  return { claim: null, conditions: [], status: "unconfirmed", sourceWording: value.display };
}

export function describeFact(value: CellValue, factName: string): FactDescription {
  const parts = value.anchor?.kind === "table-cell"
    ? tableParts(value.display, value.anchor.label)
    : lineParts(value.display);
  if (!parts) return unconfirmed(value);
  // Verbatim by construction; checked anyway so a future change to the
  // display shape cannot turn a claim into new wording.
  if (![...parts.pieces, ...parts.conditions].every((piece) => value.display.includes(piece))) {
    return unconfirmed(value);
  }
  const quotes = value.evidence.map((e) => e.quote);
  // Conditions are shown beside the claim, so a marker kept there is kept.
  const shownBeside: Record<string, unknown> = { ...value.qualifiers };
  parts.conditions.forEach((condition, index) => { shownBeside[`condition${index}`] = condition; });
  const grounding = checkDisplayGrounding(parts.claim, factName, quotes, {
    qualifiers: shownBeside,
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
