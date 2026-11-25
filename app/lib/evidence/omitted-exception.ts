// Owner decision 2026-11-24 (7), safety: an answer that states an exclusion
// or limitation is not verified when the same section of the document states
// an exception to it ("except", "unless", "other than", "acute onset") that
// the answer omits. This rule only REJECTS, and it reads WIDELY (review of
// a63a772): layout never hides an exception.
//
//   section   — from the citation outward, over page breaks, to a heading that
//               is positively about another topic: a heading-shaped line with
//               a benefit-topic word, sharing no subject with the answer or
//               the cited heading, that is not page furniture, states no
//               marker and is not followed by a back-reference. Any other
//               heading-like line ends nothing.
//   exception — a whole statement with a marker, and the list it introduces.
//               A bare "unless otherwise noted" points elsewhere: none.
//   to it     — every exception of the section, unless it is POSITIVELY about
//               another subject: it names a subject of its own, shares none
//               with the answer, does not refer back, and stands in another
//               list item, labelled paragraph, table row or page.
//   omitted   — the answer does not state the whole exception statement (and
//               the list it introduces) as one run of words.
// Pure: reads only what is passed in.

import { continuesOnto, lineEndsSentence } from "@/app/lib/evidence-verification";
import { normalizeForMatch } from "@/app/lib/pdf/text-match";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";

interface ExceptionDocument {
  documentId: string;
  pages: readonly string[];
  tables?: readonly LayoutTable[];
}
interface ExceptionCitation {
  documentId: string;
  page: number;
  quote: string;
}

// ---------------------------------------------------------------- wording

const FAVOURABLE = /\b(?:not\s+subject\s+to|no\s+(?:deductibles?|co-?pay(?:ment)?s?|coinsurance|waiting\s+period))\b/gi;
/** Wording of an exclusion or limitation. A bare cap ("up to $500") is a
 *  value, not a limitation in this sense. */
const LIMITS = new RegExp(
  [
    String.raw`\b(?:no|not|never|none|nil|nothing|neither|nor|cannot|without)\b`,
    String.raw`n['’]t\b`,
    String.raw`\bexclu(?:d(?:ed?|es|ing)|sions?|sive(?:ly)?)\b`,
    String.raw`\b(?:ineligible|non[\s-]*(?:covered|payable|eligible|reimbursable))\b`,
    String.raw`\b(?:limited\s+to|limitations?|restrict(?:ed|ions?)|only|solely|denied|declined?|void(?:ed)?|capped|waiting\s+period|terminat(?:es?|ed|ion)|responsib(?:le|ility))\b`,
  ].join("|"),
  "i",
);
const COST_SHARE = /\b(?:deductibles?|co-?pay(?:ment)?s?|coinsurance|out[\s-]of[\s-]pocket|premiums?)\b/i;
const statesLimit = (s: string) => LIMITS.test(s.replace(FAVOURABLE, " ")) || (/\$0(?![\d.,]*\d)/.test(s) && !COST_SHARE.test(s));

const MARKER = /\bexcept(?:ed|ing|ions?)?\b|\bunless\b|\bother\s+than\b/i;
const ACUTE = /\bacute[\s-]+onset\b/i;
const marked = (s: string) => MARKER.test(s) || ACUTE.test(s);

/** "unless otherwise noted [in the Schedule]" to the end of its clause points
 *  elsewhere and states no exception; anything after it keeps the marker. */
const BOILERPLATE = new RegExp(
  String.raw`\b(?:unless|except\s+as)\s+(?:(?:otherwise|specifically|expressly)\s+)+(?:stated|noted|indicated|specified|provided)(?:\s+otherwise)?` +
    String.raw`(?:\s+(?:herein|below|above|in\s+(?:the|this)\s+(?:schedule|certificate|policy|plan|brochure|table)(?:\s+of\s+benefits)?))?(?=\s*(?:[.;,:)]|$))` +
    String.raw`|\bunless\s+stated\s+as\s+(?:a\s+)?maximum\s+limit(?=\s*(?:[.;,:)]|$))`,
  "gi",
);

/** A table-of-contents line: dotted leaders, then only a page number. */
const CONTENTS_LINE = /\.{4,}\s*\d{1,4}\s*$/;

/** Back-reference to the rule being stated. */
const THIS_RULE = /\b(?:this|such|these|the\s+(?:above|foregoing|following|preceding))\s*(?:exclusions?|limitations?|restrictions?|rules?|provisions?|applies|apply|charges?|items?|(?:is|are)\b)/i;
/** Back-reference to the whole list. */
const THE_LIST = /\b(?:(?:the|all\s+of\s+the)\s+(?:above|foregoing|preceding|following)|(?:any|none|all|each)\s+of\s+these|these\s+(?:items|exclusions|limitations|charges|are)|items?\s+\(?\d)/i;
const OPENS_WITH_MARKER = /^\s*(?:(?:please\s+)?note:?\s*|important(?:\s+note)?:?\s*)?(?:except(?:ed|ing|ions?)?|unless|other\s+than)\b/i;
const NOTE_LABEL = /^\s*(?:please\s+note|note|notes|important(?:\s+note)?|exceptions?|notice|warning|reminder|however)\b/i;
const refersBack = (s: string) => THIS_RULE.test(s) || THE_LIST.test(s) || OPENS_WITH_MARKER.test(s) || NOTE_LABEL.test(s);

// ---------------------------------------------------------------- subjects

/** Text with hyphen wraps and soft hyphens joined. */
const unwrap = (s: string) => s.replace(/­\s*/g, "").replace(/([A-Za-z])-\s*\n\s*(?=[A-Za-z])/g, "$1");
/** Compared words: case, punctuation and articles do not count; hyphenated
 *  compounds ("pre-existing") are one word. */
const words = (s: string) =>
  normalizeForMatch(unwrap(s)).toLowerCase().replace(/([a-z])-\s*(?=[a-z])/g, "$1").replace(/[^a-z0-9$%\s]/g, " ").split(/\s+/).filter((w) => w && w !== "a" && w !== "an" && w !== "the");
const run = (s: string) => words(s).join(" ");
const SAME: Readonly<Record<string, string>> = { pregnancy: "maternity", pregnant: "maternity", newborn: "maternity", tooth: "dental", teeth: "dental", eye: "vision" };
const stem = (w: string) => {
  const s = w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
  return SAME[s] ?? s;
};
/** Words too general to say two statements are about the same thing. */
const GENERIC = new Set((
  "any all are as at be been by for from has have if in is it its no not of on or other than that their this to under was were will with within whether there " +
  "insured person traveller member participant insurance plan policy company administrator coverage covered cover benefit charge expense eligible medical treatment " +
  "service care condition limit limited limitation maximum period except exception unless exclude excluded exclusion excluding paid pay payable payment reimbursed " +
  "only subject per day year month visit general schedule provision definition term certificate up refer which such shall may must each apply applie applies full " +
  "amount stated noted indicated provided provide lifetime result resulting directly indirectly arising relating related incur incurred receive received available including " +
  "and but also so you your you're they them who whose whom when where while during until after before can could may might do does did because into out over more most " +
  "both either each every these those those some additional total current following above below see"
).split(/\s+/).map((w) => stem(w)));
const subject = (s: string) => new Set(words(s).filter((w) => w.length > 2 && !/\d/.test(w)).map(stem).filter((w) => !GENERIC.has(w)));
const shares = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].some((w) => b.has(w));

// ---------------------------------------------------------------- headings

const TOPIC = new Set((
  "maternity dental vision hearing mental nervous preventative preventive wellness prescription drug medication evacuation repatriation ambulance " +
  "sport war terrorism eligibility claim premium refund cancellation deductible coinsurance copayment preexisting physiotherapy chiropractic acupuncture " +
  "transplant cosmetic surgery hospital emergency urgent baggage luggage accidental death dismemberment telehealth substance abuse"
).split(" ").map(stem));
const SMALL = new Set("a an and as at by for from in of on or the to with".split(" "));
const NUMBERED = /^\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[).]\s+/i;

/** The words of a heading-shaped line: "LABEL: …", an all-capitals line, or a
 *  title-case line between finished sentences. Shape only. */
function headingShape(line: string, prev: string | undefined): string | undefined {
  const text = line.trim().replace(NUMBERED, "");
  const runIn = /^([A-Z][A-Z0-9 \-–/&,'’()]{2,80}):(?:\s|$)/.exec(text);
  if (runIn) return runIn[1];
  if (/^[•·▪◦*–-]\s/.test(line.trim()) || /[\d$%]/.test(text) || /[.;!?,]\s*$/.test(text)) return undefined;
  const ws = text.replace(/:\s*$/, "").split(/\s+/).filter(Boolean);
  if (ws.length === 0 || ws.length > 9) return undefined;
  if (prev !== undefined && !lineEndsSentence(prev) && continuesOnto(prev, line, true)) return undefined;
  if (/[A-Z]/.test(text) && !/[a-z]/.test(text)) return text;
  const title = ws.every((w) => /^[^a-z]*[A-Z]/.test(w) || SMALL.has(w.toLowerCase()));
  const opens = prev === undefined || lineEndsSentence(prev) || !/[a-z]/.test(prev);
  return title && opens ? text : undefined;
}

/** Positive evidence that the line starts another topic. */
function endsSection(lines: readonly Line[], i: number, about: ReadonlySet<string>): boolean {
  const h = lines[i].heading;
  if (!h || lines[i].row !== undefined || marked(h) || NOTE_LABEL.test(h)) return false;
  const own = subject(h);
  if (![...own].some((w) => TOPIC.has(w)) || shares(own, about)) return false;
  const next = lines[i + 1]?.text ?? "";
  const rest = lines[i].text.slice(lines[i].text.indexOf(h) + h.length).replace(/^:\s*/, "");
  return !refersBack(rest.trim() ? rest : next);
}

// ------------------------------------------------------------------- lines

interface Line {
  page: number;
  text: string;
  heading?: string;
  /** Table row the whole line belongs to. */
  row?: string;
}

const edgeKey = (s: string) => run(s).replace(/\d+/g, "#");

/** The document's lines without page furniture: lines repeated at the top or
 *  bottom of pages, lone page numbers, and a line at a page edge that is no
 *  sentence and holds a "Page N" mark. */
function linesOf(doc: ExceptionDocument): Line[] {
  const pages = doc.pages.map((text, p) => {
    const tables = (doc.tables ?? []).map((t, k) => ({ t, k })).filter(({ t }) => t.page === p + 1);
    let at = 0;
    const out: Line[] = [];
    for (const raw of text.split("\n")) {
      const start = at;
      const end = at + raw.length;
      at = end + 1;
      if (!raw.trim()) continue;
      let row: string | undefined;
      for (const { t, k } of tables) {
        t.rows.forEach((r, ri) => {
          if ([r.label, ...r.cells].some((x) => x.spans.some((s) => s.start < end && s.end > start))) row ??= `${k}:${ri}`;
        });
      }
      out.push({ page: p + 1, text: raw, row });
    }
    return out;
  });
  const EDGE = 2;
  const count = new Map<string, number>();
  for (const ls of pages) {
    const keys = new Set([...ls.slice(0, EDGE), ...ls.slice(-EDGE)].map((l) => edgeKey(l.text)));
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out: Line[] = [];
  for (const ls of pages) {
    ls.forEach((l, i) => {
      const edge = i < EDGE || i >= ls.length - EDGE;
      const furniture = edge && !lineEndsSentence(l.text) && !marked(l.text) && ((count.get(edgeKey(l.text)) ?? 0) > 1 || /^\W*\d+\W*$/.test(l.text) || /\bpage\s+\d+/i.test(l.text));
      if (!furniture) out.push(l);
    });
  }
  out.forEach((l, i) => { l.heading = l.row === undefined ? headingShape(l.text, out[i - 1]?.text) : undefined; });
  return out;
}

/** Line ranges of every placement of the quote on its page; the whole page
 *  when it cannot be placed. */
function placements(lines: readonly Line[], c: ExceptionCitation): [number, number][] {
  const idx = lines.map((l, i) => (l.page === c.page ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  const tokens: { w: string; i: number }[] = [];
  idx.forEach((i, k) => {
    // A word hyphen-wrapped onto the next line belongs to this line.
    const joined = k + 1 < idx.length && /[A-Za-z]-\s*$/.test(lines[i].text) && /^\s*[A-Za-z]/.test(lines[idx[k + 1]].text);
    const prevJoined = k > 0 && /[A-Za-z]-\s*$/.test(lines[idx[k - 1]].text) && /^\s*[A-Za-z]/.test(lines[i].text);
    const own = prevJoined ? lines[i].text.replace(/^\s*[A-Za-z]+/, "") : lines[i].text;
    const text = joined ? lines[i].text.replace(/-\s*$/, "") + (/^\s*([A-Za-z]+)/.exec(lines[idx[k + 1]].text)?.[1] ?? "") : lines[i].text;
    for (const w of words(prevJoined ? (joined ? own.replace(/-\s*$/, "") + (/^\s*([A-Za-z]+)/.exec(lines[idx[k + 1]].text)?.[1] ?? "") : own) : text)) tokens.push({ w, i });
  });
  const want = words(c.quote);
  const out: [number, number][] = [];
  if (want.length > 0) {
    for (let p = 0; p + want.length <= tokens.length; p++) {
      if (want.every((w, k) => tokens[p + k].w === w)) out.push([tokens[p].i, tokens[p + want.length - 1].i]);
    }
  }
  return out.length > 0 ? out : [[idx[0], idx[idx.length - 1]]];
}

// ------------------------------------------------------------------- items

/** Style of a list marker, or undefined. */
function itemStyle(line: string): string | undefined {
  const t = line.trim();
  const b = /^([•·▪◦*–-])\s/.exec(t);
  if (b) return b[1];
  const n = /^(\(?)(\d{1,3}|[a-z]|[ivx]{1,4}|[A-Z])([).])\s/.exec(t);
  if (!n) return undefined;
  return `${n[1]}${/\d/.test(n[2]) ? "1" : /[A-Z]/.test(n[2]) ? "A" : "a"}${n[3]}`;
}
/** "Label: text" opens its own paragraph, unless the label is a note or an
 *  exception. */
const labelled = (s: string) => /^[A-Z][^.:;]{2,80}:\s+\S/.test(s) && !marked(s.slice(0, s.indexOf(":"))) && !NOTE_LABEL.test(s);

/** Each line's item: its table row, its list item, its labelled paragraph, or
 *  "" (text outside any). A list item keeps its sub-items. */
function itemsOf(lines: readonly Line[], from: number, to: number): string[] {
  const out: string[] = [];
  let open: { style: string; id: string }[] = [];
  let para = "";
  for (let i = from; i <= to; i++) {
    const l = lines[i];
    const text = l.text.trim();
    if (l.row !== undefined) { open = []; para = ""; out.push(`row ${l.page} ${l.row}`); continue; }
    const style = itemStyle(text);
    if (style) {
      const k = open.findIndex((o) => o.style === style);
      open = [...(k >= 0 ? open.slice(0, k) : open), { style, id: `item ${i}` }];
      para = "";
    } else if (labelled(text)) {
      open = [];
      para = `para ${i}`;
    } else if (refersBack(text) && (i === from || lineEndsSentence(lines[i - 1].text))) {
      // "The above …", "Note …" after a list or paragraph belongs to all of it.
      if (THE_LIST.test(text) || NOTE_LABEL.test(text) || OPENS_WITH_MARKER.test(text)) { open = []; para = ""; }
    }
    out.push(open[0]?.id ?? para);
  }
  return out;
}

// -------------------------------------------------------------- statements

interface Statement {
  from: number;
  to: number;
  text: string;
}

const stripMarker = (s: string) => s.trim().replace(/^(?:[•·▪◦*–-]|\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[).])\s+/i, "");
const ENDS_OPEN = /(?:\b(?:except(?:ed|ing|ions?)?|unless|other|than|acute|for|if|when)|-|­|,)\s*$/i;

/** Whole statements of lines [from, to]: a line that does not end a sentence
 *  and runs on joins the next, inside one item. */
function statementsOf(lines: readonly Line[], items: readonly string[], from: number, to: number): Statement[] {
  const out: Statement[] = [];
  for (let i = from; i <= to; i++) {
    const text = lines[i].text;
    const last = out[out.length - 1];
    const prev = i > from ? lines[i - 1].text : "";
    const runsOn = last && items[i] === items[i - 1] && !itemStyle(text) && !lineEndsSentence(prev) &&
      (lines[i].row !== undefined || ENDS_OPEN.test(prev) || continuesOnto(prev, text, true) || (/[A-Z]/.test(prev) && !/[a-z]/.test(prev) && !/[a-z]/.test(text) && (marked(`${prev} ${text}`))));
    if (runsOn) { last.text += `\n${text}`; last.to = i; }
    else out.push({ from: i, to: i, text });
  }
  return out;
}

/** The sentences of a statement (an initialism does not end one). */
const sentencesOf = (s: string) => unwrap(s).replace(/\s+/g, " ").split(/(?<=[.!?])(?<!\b[A-Z]\.[A-Z]\.)\s+(?=[A-Z“"(•])/);

/** What the answer must state for this exception: the sentence, and the list
 *  (else the next statement) it introduces. */
function needOf(sentence: string, isLast: boolean, k: number, statements: readonly Statement[], lines: readonly Line[], items: readonly string[], base: number): string {
  // A run-in topic heading is not part of the statement.
  const runIn = /^([A-Z][A-Z0-9 \-–/&,'’()]{2,80}):\s+(?=\S)/.exec(stripMarker(sentence));
  const own = runIn && !marked(runIn[1]) && !NOTE_LABEL.test(runIn[1]) ? stripMarker(sentence).slice(runIn[0].length) : stripMarker(sentence);
  const introduces = isLast && (/:\s*$/.test(own) || /\bexceptions?\b[^.]{0,20}\bapply\b/i.test(own) || /\b(?:the\s+)?following\b[^.]{0,30}$/i.test(own) || (!lineEndsSentence(own) && own.split(/\s+/).length <= 9 && lines[statements[k].to].heading !== undefined));
  if (!introduces) return run(own);
  const parts = [own];
  const first = statements[k + 1];
  if (first) {
    const style = itemStyle(lines[first.from].text);
    const inList = (s: Statement) => items[s.from - base] !== items[statements[k].from - base] || itemStyle(lines[s.from].text) !== undefined;
    for (let j = k + 1; j < statements.length; j++) {
      if (!style && j > k + 1) break;
      if (style && (!inList(statements[j]) || itemStyle(lines[statements[j].from].text) === undefined)) break;
      parts.push(stripMarker(statements[j].text));
    }
  }
  return parts.map(run).filter(Boolean).join(" ");
}

// -------------------------------------------------------------------- rule

const HEADING_LIMITS = /\b(?:exclu(?:ded|sions?)|not\s+covered|limitations?)\b/i;

/** True when the answer states an exclusion or limitation and leaves out an
 *  exception that a cited section states to it. */
export function omitsException(
  answerText: string,
  citations: readonly ExceptionCitation[],
  documents: readonly ExceptionDocument[],
): boolean {
  // Cheap first check: no document states any marker.
  const said = ` ${answerText.split("\n").map((l) => run(stripMarker(l))).filter(Boolean).join(" ")} `;
  const limited = answerText.split(/\n+|(?<=[.!?])\s+(?=[A-Z"(])/).some(statesLimit) || statesLimit(answerText.replace(/\s+/g, " "));
  const about = subject(answerText);
  const cache = new Map<string, Line[]>();

  for (const c of citations) {
    const doc = documents.find((d) => d.documentId === c.documentId);
    if (!doc) continue;
    const lines = cache.get(c.documentId) ?? linesOf(doc);
    cache.set(c.documentId, lines);
    for (const [a, b] of placements(lines, c)) {
      // The heading the citation stands under names its subject too.
      let h = a;
      while (h > 0 && lines[h].heading === undefined) h--;
      const named = new Set([...about, ...subject(lines[h].heading ?? "")]);
      let from = a;
      while (from > 0 && !endsSection(lines, from, named)) from--;
      let to = b;
      while (to + 1 < lines.length && !endsSection(lines, to + 1, named)) to++;
      const items = itemsOf(lines, from, to);
      const at = (i: number) => items[i - from];
      const cited = new Set<string>();
      for (let i = a; i <= b; i++) cited.add(at(i));
      const statements = statementsOf(lines, items, from, to).filter((s) => s.text.trim());

      if (!limited) {
        // S3: excluded only by its lead-in or heading.
        const lead = statements.filter((s) => s.to < a && (/:\s*$/.test(s.text) || lines[s.from].heading !== undefined)).slice(-2);
        if (!lead.some((s) => HEADING_LIMITS.test(s.text)) || [...cited].every((i) => i.startsWith("row "))) continue;
      }

      // The statements next to the citation are always read as about it.
      const near = new Set([
        statements.filter((s) => s.to < a).pop(),
        statements.find((s) => s.from > b),
      ]);
      for (const [k, s] of statements.entries()) {
        const item = at(s.from);
        const isRow = item.startsWith("row ");
        // The cited row's own cells are shown by the row itself.
        if (isRow && cited.has(item)) continue;
        const sentences = sentencesOf(s.text);
        for (const [si, sentence] of sentences.entries()) {
          if (CONTENTS_LINE.test(sentence) || !marked(sentence.replace(BOILERPLATE, " "))) continue;
          const own = subject(sentence);
          const otherSubject = own.size > 0 && named.size > 0 && about.size > 0 && !shares(own, named);
          const sibling = item !== "" && !cited.has(item);
          // "this exclusion" inside a sibling item is about that item.
          const back = sibling ? THE_LIST.test(sentence) : refersBack(sentence);
          const leadIn = s.to < a && /:\s*$/.test(s.text);
          const listSibling = sibling && (item.startsWith("item ") || isRow);
          const adjacent = near.has(s) && !listSibling;
          const apart = sibling || lines[s.from].page !== c.page;
          if (otherSubject && !back && !leadIn && !adjacent && apart) continue;
          const need = needOf(sentence, si === sentences.length - 1, k, statements, lines, items, from);
          if (need && !said.includes(` ${need} `)) return true;
        }
      }
    }
  }
  return false;
}
