// Table claims: structured values read from header-anchored benefit tables
// (app/lib/pdf/layout-tables.ts).
//
// A table claim states: in this document's table, the row labelled L has, in
// the column headed H, the cell text C. The fact (row) it belongs to is chosen
// from the LABEL only, the scope (tier / network / geography) from the HEADER
// only, and the display is the label and the cell verbatim. Nothing is
// inferred from proximity, from repeated numbers, or from another row.
//
// Evidence is twofold:
//   1. textual — the row's contiguous page-text span (label through cell) and
//      the header span, both verified like any citation;
//   2. structural — `anchor` names the table/row/columns. verifyTableAnchor()
//      re-derives the claim from the server-computed layout and requires an
//      exact match, so an anchor can only ever point at a real cell and can
//      never carry a display or scope the table does not state.

import { FACTS } from "@/app/lib/extraction/fact-list";
import { ELIGIBILITY_FEEDERS, ELIGIBILITY_ROW_NAME } from "@/app/lib/extraction/eligibility";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import type { CellValue, EvidenceCitation, Qualifiers, TableAnchor } from "@/app/lib/extraction/types";
import { coveringSpan, type LayoutTable, type Span } from "@/app/lib/pdf/layout-tables";
import { governingNotes, namedProvisions } from "@/app/lib/extraction/table-notes";

export interface TableDocument {
  documentId: string;
  pageCount?: number;
  pages: readonly string[];
  tables?: readonly LayoutTable[];
}

/** Longest row citation accepted; a longer covering span means the row's
 *  cells are far apart in the content stream and the quote would be noise. */
const MAX_ROW_QUOTE = 700;

/** Concept words for rows whose line-engine pattern also demands a value
 *  shape on the same line (a table label carries only the concept). */
const LABEL_ANCHORS: Readonly<Record<string, RegExp>> = {
  "annual-deductible": /\bdeductibles?\b/i,
  premium: /\bpremiums?\b/i,
};

/** Facts other than these are not read from a label that only mentions them
 *  in passing; deductible/coinsurance words are common sub-notes. */
const compiled = FACTS.map((f) => ({
  name: f.name,
  patterns: [...f.patterns.map((p) => new RegExp(p, "i")), ...(LABEL_ANCHORS[f.name] ? [LABEL_ANCHORS[f.name]] : [])],
}));

/** The concept part of a row label: before any bullet sub-note, without
 *  parenthetical restrictions. ("Physical Therapy • Maximum Visits per day: 1"
 *  → "Physical Therapy"; "Local Ambulance (Not subject to coinsurance)" →
 *  "Local Ambulance"). The full label stays in the display. */
export function labelHead(label: string): string {
  return label.split(/\s[•·]\s?|\s[•·]$/)[0].replace(/\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
}

export function factsForLabel(label: string): string[] {
  const head = labelHead(label);
  if (!head) return [];
  return compiled.filter((f) => f.patterns.some((re) => re.test(head))).map((f) => f.name);
}

const TIER_NAME = /\b(elite|select|budget|smart|lite|plus|platinum|gold|silver|bronze|basic|enhanced|premium|standard|choice|reliable|ultimate|supreme|premier)\b/gi;
const NETWORK = /\b(?:in[-\s]network|out[-\s]of[-\s]network|non[-\s]network|(?:in|out of)\s+PPO\s+network|non[-\s]?preferred|preferred|non[-\s]?participating|participating)\b/i;

/** Scope stated by a column heading, verbatim. A network heading becomes
 *  `networkTier` (any remaining words, e.g. "United States", `conditions`);
 *  a heading naming exactly one known tier word becomes that `planTier`;
 *  any other heading is kept whole as `conditions` so the column's identity
 *  is never dropped. */
export function columnQualifiers(heading: string, firstLine = heading): Qualifiers {
  const text = heading.replace(/\s+/g, " ").trim();
  const network = text.match(NETWORK);
  if (network) {
    const rest = text.replace(network[0], " ").replace(/\s+/g, " ").trim();
    return { networkTier: network[0], ...(rest ? { conditions: rest } : {}) };
  }
  // The tier is named by the top heading line; a stacked tagline ("Reliable
  // Coverage", "Most popular") does not rename it.
  const tiers = [...new Set([...firstLine.matchAll(TIER_NAME)].map((m) => m[0]))];
  if (tiers.length === 1) return { planTier: tiers[0] };
  return { conditions: text };
}

const slice = (page: string, span: Span) => page.slice(span.start, span.end);

interface TableClaim {
  factName: string;
  value: CellValue;
}

/** Every table claim in one document, in table/row/column order. Claims whose
 *  row or header span does not verify uniquely on its page are omitted. */
export function tableClaims(doc: TableDocument): TableClaim[] {
  const out: TableClaim[] = [];
  (doc.tables ?? []).forEach((table, tableIndex) => {
    table.rows.forEach((_, rowIndex) => {
      for (const claim of claimsAt(doc, tableIndex, rowIndex)) out.push(claim);
    });
  });
  return out;
}

function claimsAt(doc: TableDocument, tableIndex: number, rowIndex: number): TableClaim[] {
  const table = doc.tables?.[tableIndex];
  const row = table?.rows[rowIndex];
  const page = table ? doc.pages[table.page - 1] : undefined;
  if (!table || !row || typeof page !== "string") return [];
  const facts = factsForLabel(row.label.text);
  if (facts.length === 0) return [];
  const header = cite(doc, table.page, slice(page, table.header));
  if (!header) return [];
  const out: TableClaim[] = [];
  for (const cell of row.cells) {
    const span = coveringSpan([...row.label.spans, ...cell.spans]);
    if (span.end - span.start > MAX_ROW_QUOTE) continue;
    const rowQuote = cite(doc, table.page, slice(page, span));
    if (!rowQuote) continue;
    for (const column of cell.columns) {
      const heading = table.columns[column]?.text;
      if (!heading) continue;
      const firstLine = table.columns[column].lines?.[0] ?? heading;
      // Every footnote / preamble governing this cell, or no claim at all.
      const notes = governingNotes(doc.tables ?? [], tableIndex, rowIndex, column, page);
      if (!notes) continue;
      // Provisions elsewhere in the document that name this benefit exactly.
      const named = namedProvisions(doc.pages, labelHead(row.label.text), { page: table.page, spans: [...row.label.spans, ...row.cells.flatMap((c) => c.spans)] });
      const noteQuotes = [
        ...notes.map((n) => cite(doc, table.page, slice(page, coveringSpan(n.spans)))),
        ...named.map((n) => cite(doc, n.page, n.quote)),
      ];
      if (noteQuotes.some((q) => !q)) continue;
      const noteTexts = [...notes.map((n) => n.text), ...named.map((n) => n.quote.replace(/\s+/g, " "))];
      // The claim reads complete on its own: row, column, cell — all verbatim
      // — then each governing note verbatim on its own line. A bare "90%"
      // means nothing without "In-Network Plan Pays".
      const display = `${row.label.text} (${heading}): ${cell.text}${noteTexts.map((t) => `\n${t}`).join("")}`;
      const anchor: TableAnchor = { kind: "table-cell", page: table.page, table: tableIndex, row: rowIndex, column, label: row.label.text };
      for (const factName of facts) {
        out.push({
          factName,
          value: {
            documentId: doc.documentId,
            display,
            qualifiers: columnQualifiers(heading, firstLine),
            evidence: [rowQuote, header, ...(noteQuotes as EvidenceCitation[])],
            anchor,
          },
        });
      }
    }
  }
  return out;
}

function cite(doc: TableDocument, page: number, quote: string): EvidenceCitation | undefined {
  if (!quote.trim()) return undefined;
  const verified = verifyEvidenceCitation(
    [{ documentId: doc.documentId, pageCount: doc.pageCount ?? doc.pages.length, pages: [...doc.pages] }],
    { documentId: doc.documentId, page, quote },
  );
  return verified.ok ? { documentId: doc.documentId, page, quote: verified.quote } : undefined;
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

/** True only when the value is exactly a claim the server-computed layout of
 *  its own document states at its anchor, for this fact: same display, same
 *  scope qualifiers, and evidence that includes the row and header citations.
 *  Pure; never trusts anything the value carries except as a lookup key. */
export function verifyTableAnchor(
  factName: string,
  value: Pick<CellValue, "documentId" | "display" | "qualifiers" | "evidence" | "anchor">,
  documents: readonly TableDocument[],
): boolean {
  const anchor = value.anchor;
  if (!anchor || anchor.kind !== "table-cell") return false;
  const doc = documents.find((d) => d.documentId === value.documentId);
  if (!doc) return false;
  const table = doc.tables?.[anchor.table];
  if (!table || table.page !== anchor.page) return false;
  // The eligibility composite row carries its feeder facts' values.
  const facts = factName === ELIGIBILITY_ROW_NAME ? ELIGIBILITY_FEEDERS : [factName];
  const expected = claimsAt(doc, anchor.table, anchor.row).find((c) =>
    facts.includes(c.factName) && c.value.anchor?.kind === "table-cell" && c.value.anchor.column === anchor.column);
  if (!expected) return false;
  if (norm(expected.value.display) !== norm(value.display)) return false;
  if (expected.value.anchor?.kind !== "table-cell" || expected.value.anchor.label !== anchor.label) return false;
  const scopeKeys = ["planTier", "networkTier", "conditions"] as const;
  if (scopeKeys.some((k) => (expected.value.qualifiers[k] ?? "") !== (value.qualifiers[k] ?? ""))) return false;
  return expected.value.evidence.every((e) =>
    value.evidence.some((v) => v.page === e.page && norm(v.quote) === norm(e.quote)));
}

/** Page-text spans owned by tables, per 1-based page: the line engine must
 *  not emit its own reading of these lines. */
export function tableOwnedSpans(doc: TableDocument): Map<number, Span[]> {
  const owned = new Map<number, Span[]>();
  for (const table of doc.tables ?? []) {
    const spans = owned.get(table.page) ?? [];
    spans.push(table.header);
    for (const row of table.rows) {
      spans.push(...row.label.spans);
      for (const cell of row.cells) spans.push(...cell.spans);
    }
    owned.set(table.page, spans);
  }
  return owned;
}

/** True when a verified quote on `page` overlaps any table-owned span. */
export function quoteInTable(doc: TableDocument, owned: Map<number, Span[]>, page: number, quote: string): boolean {
  const spans = owned.get(page);
  if (!spans?.length) return false;
  const text = doc.pages[page - 1] ?? "";
  let from = text.indexOf(quote);
  while (from >= 0) {
    const to = from + quote.length;
    if (spans.some((s) => s.start < to && s.end > from)) return true;
    from = text.indexOf(quote, from + 1);
  }
  return false;
}
