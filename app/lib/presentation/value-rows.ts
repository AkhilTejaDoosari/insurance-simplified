// Owner decision 2026-11-24 (7), display: a server-rendered grid/table answer
// shows only value rows — row label (with its section), tier/network header,
// cell — and what governs them. Presentation only: extraction, verification
// and citations are unchanged, and the full verbatim display (EC-7) is
// untouched. Not shown: the header line, a general introduction or note that
// states no restriction of its own, and marketing taglines.
import type { CellValue } from "@/app/lib/extraction/types";
import { governingNotes } from "@/app/lib/extraction/table-notes";
import { describeFact } from "@/app/lib/presentation/claim";
import { shownHeadings } from "@/app/lib/pdf/shown-headings";
import { GOVERNS_TABLE, type LayoutTable } from "@/app/lib/pdf/layout-tables";

const ws = (s: string) => s.replace(/\s+/g, " ").trim();

/** Closed introductory sentences (review of a63a772, B9): a general note is
 *  hidden only sentence by sentence, when the WHOLE sentence is one of these;
 *  anything else is shown. */
const UNLESS = String.raw`(?:unless\s+(?:(?:otherwise|specifically|expressly)\s+)*(?:stated|noted|indicated|specified|provided)(?:\s+otherwise)?)`;
const COST = String.raw`(?:(?:applicable\s+)?(?:deductibles?|co-?pay(?:ment)?s?|coinsurance|overall\s+maximum(?:\s+limits?)?))`;
const COSTS = String.raw`${COST}(?:(?:\s*,\s*(?:and\s+)?|\s+and(?:\/or)?\s+|\s+or\s+)(?:the\s+)?${COST})+`;
const PER = String.raw`per\s+(?:person|insured\s+person|(?:certificate\s+)?period(?:\s+of\s+coverage)?)`;
const INTRODUCTIONS = [
  String.raw`(?:all\s+)?(?:benefits|amounts)(?:\s+(?:shown|listed)\s+below)?\s+are\s+(?:shown\s+)?in\s+(?:united\s+states|u\.?s\.?)\s+dollars?(?:\s+amounts)?`,
  String.raw`(?:all\s+)?(?:(?:medical(?:\s+and\s+dental)?|eligible)\s+)?(?:benefits|expenses)\s+are\s+subject\s+to\s+${COSTS}(?:,?\s+and\s+are\s+${PER})?(?:\s+${UNLESS})?`,
  String.raw`(?:${UNLESS},?\s+)?all\s+benefits\s+are\s+${PER}(?:,?\s+(?:and\s+)?${PER})*(?:,?\s+and\s+(?:they\s+are\s+)?provided\s+up\s+to\s+the\s+amount\s+shown)`,
  String.raw`schedule\s+of\s+benefits`,
].map((x) => new RegExp(`^(?:schedule\\s+of\\s+benefits\\s+)?${x}\\s*[.:]?$`, "i"));

/** The sentences of a general note that are not introductory. */
const governingSentences = (text: string) =>
  ws(text).split(/(?<=[.!?])(?<!\b[A-Z]\.[A-Z]\.)\s+(?=[A-Z])/).filter((x) => !INTRODUCTIONS.some((re) => re.test(x)));

interface RowDocument {
  documentId: string;
  pages: readonly string[];
  tables?: readonly LayoutTable[];
}

/** The lines of one value as the chat shows them: the claim, then every
 *  condition that governs it. A table cell whose table is at hand gains its
 *  section in the label and loses general introductory sentences and taglines; with
 *  no table everything is kept. */
export function shownValue(value: CellValue, factName: string, documents: readonly RowDocument[]): { claim: string; section?: string; conditions: string[] } {
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
    .filter((n) => n && notes.some((x) => x.spans[0]?.start === n.spans[0]?.start))
    .map((n) => ws(n!.text));
  const label = d.claim.slice(0, at);
  return {
    claim: `${section ? `${label} — ${section}` : label} (${shownHeadings(table)[anchor.column]}): ${d.claim.slice(at + heading.length + 5)}`,
    ...(section ? { section } : {}),
    conditions: d.conditions
      .filter((c) => !(section && ws(c) === section))
      .flatMap((c) => (general.includes(ws(c)) ? governingSentences(c) : [c])),
  };
}
