// Owner decision 2026-11-24 (7), display: a server-rendered grid/table answer
// shows only value rows — row label (with its section), tier/network header,
// cell — and what governs them. Presentation only: extraction, verification
// and citations are unchanged, and the full verbatim display (EC-7) is
// untouched. Not shown: the header line, a general introduction or note that
// states no restriction of its own, and marketing taglines.
import { statesScopingMarker } from "@/app/lib/evidence-verification";
import type { CellValue } from "@/app/lib/extraction/types";
import { governingNotes } from "@/app/lib/extraction/table-notes";
import { describeFact } from "@/app/lib/presentation/claim";
import { GOVERNS_TABLE, type LayoutTable } from "@/app/lib/pdf/layout-tables";

const ws = (s: string) => s.replace(/\s+/g, " ").trim();

/** Closed marketing vocabulary: a heading line made only of these phrases
 *  scopes nothing. An allow-list, so any other line ("In-Network", "Per
 *  Person", "Accident Only") stays in the heading. */
const TAGLINE = /^(?:(?:our )?most popular|(?:our )?best (?:value|seller|selling)|popular choice|recommended|reliable coverage|great value)!?$/i;

/** Each column's heading without its stacked tagline lines; the heading line
 *  that names the column always stays, and when two headings would read the
 *  same without taglines every heading is kept whole. */
export function shownHeadings(table: LayoutTable): string[] {
  const whole = table.columns.map((c) => ws(c.text));
  const cut = table.columns.map((c, i) => {
    const lines = (c.lines ?? []).map(ws);
    // Only when the stacked lines rebuild the heading exactly.
    if (lines.length < 2 || lines.join(" ") !== whole[i]) return whole[i];
    return [lines[0], ...lines.slice(1).filter((l) => !TAGLINE.test(l))].join(" ");
  });
  return new Set(cut.map((h) => h.toLowerCase())).size === new Set(whole.map((h) => h.toLowerCase())).size ? cut : whole;
}

/** "unless otherwise noted" points elsewhere; it states no restriction. */
const BOILERPLATE = /\bunless\s+(?:(?:otherwise|specifically|expressly)\s+)*(?:stated|noted|indicated|specified|provided)(?:\s+otherwise)?\b/gi;

/** Words and figures that make a general note a restriction of the values. */
const RESTRICTS = /[$€£]\s?\d|\d\s?%|\b(?:not|no|never|none|without|only|limited|waiting|until|after|before|reduced|reduction|ages?)\b/i;

/** A general note that only introduces the schedule: beyond "unless otherwise
 *  noted" it states no negation, exception, network scope, amount or limit. */
const introducesOnly = (text: string) => {
  const own = text.replace(BOILERPLATE, " ");
  return !statesScopingMarker(own) && !RESTRICTS.test(own);
};

interface RowDocument {
  documentId: string;
  pages: readonly string[];
  tables?: readonly LayoutTable[];
}

/** The lines of one value as the chat shows them: the claim, then every
 *  condition that governs it. A table cell whose table is at hand gains its
 *  section in the label and loses general introductions and taglines; with
 *  no table everything is kept. */
export function shownValue(value: CellValue, factName: string, documents: readonly RowDocument[]): { claim: string; conditions: string[] } {
  const d = describeFact(value, factName);
  const head = d.claim ?? d.sourceWording;
  const anchor = value.anchor?.kind === "table-cell" ? value.anchor : undefined;
  const doc = documents.find((x) => x.documentId === value.documentId);
  const table = anchor && doc?.tables?.[anchor.table];
  const row = anchor && table?.rows[anchor.row];
  const page = table && doc?.pages[table.page - 1];
  if (!anchor || !d.claim || !doc || !table || !row || typeof page !== "string") return { claim: head, conditions: d.conditions };
  // `describeFact` composed the claim as `${label} (${heading}): ${cell}`.
  const heading = table.columns[anchor.column]?.text ?? "";
  const at = d.claim.indexOf(` (${heading}): `);
  if (!heading || at < 0) return { claim: head, conditions: d.conditions };
  const notes = governingNotes(doc.tables ?? [], anchor.table, anchor.row, anchor.column, page) ?? [];
  const section = row.section ? ws(row.section.text) : "";
  const general = [table.postscript, table.preamble && GOVERNS_TABLE.test(table.preamble.text) ? table.preamble : undefined]
    .filter((n) => n && notes.some((x) => x.spans[0]?.start === n.spans[0]?.start) && introducesOnly(n.text))
    .map((n) => ws(n!.text));
  const label = d.claim.slice(0, at);
  return {
    claim: `${section ? `${label} — ${section}` : label} (${shownHeadings(table)[anchor.column]}): ${d.claim.slice(at + heading.length + 5)}`,
    conditions: d.conditions.filter((c) => !general.includes(ws(c)) && !(section && ws(c) === section)),
  };
}
