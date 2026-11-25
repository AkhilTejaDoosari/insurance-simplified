// The column headings of a table as an answer shows them (owner decision
// 2026-11-24 (7)): without stacked marketing taglines. Presentation only.
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";

const ws = (s: string) => s.replace(/\s+/g, " ").trim();

/** Closed marketing vocabulary: a heading line made only of these phrases
 *  scopes nothing. An allow-list, so any other line ("In-Network", "Per
 *  Person", "Accident Only") stays in the heading. */
const TAGLINE = /^(?:(?:our )?most popular|(?:our )?best (?:value|seller|selling)|popular choice|recommended|reliable coverage|great value)!?$/i;

/** Each column's heading without its tagline lines. Every heading is kept
 *  whole (review of a63a772, B11) unless every line below a first line, in
 *  every column, is a tagline, and no cut heading is, or begins, another. */
export function shownHeadings(table: LayoutTable): string[] {
  const whole = table.columns.map((c) => ws(c.text));
  const lines = table.columns.map((c) => (c.lines ?? []).map(ws));
  if (lines.some((ls, i) => ls.length === 0 || ls.join(" ") !== whole[i] || ls.slice(1).some((l) => !TAGLINE.test(l)))) return whole;
  const cut = lines.map((ls) => ls[0]);
  const key = cut.map((h) => `${h.toLowerCase()} `);
  return key.some((a, i) => key.some((b, j) => i !== j && b.startsWith(a))) ? whole : cut;
}
