// Owner decision 2026-11-24 (7), safety: an answer that states an exclusion
// or limitation is not verified when the same section of the document states
// an exception to it ("except", "unless", "other than", "acute onset") that
// the answer omits. This rule only REJECTS, and it reads WIDELY (review of
// a63a772): layout never hides an exception.
//
//   section   — from the citation outward, over page breaks, to a heading on
//               a line of its own that is positively about another topic: a
//               benefit-topic word, no subject in common with the answer or
//               the cited heading, not at a page edge, no marker, and no
//               back-reference after it. A label inside a list ("WAR: …") is
//               an item, never a section end.
//   exception — a whole statement with a marker, and the list it introduces.
//               A bare "unless otherwise noted" points elsewhere: none.
//   to it     — every exception of the section on the cited and adjacent
//               pages, and any exception there that names the answer's own
//               subject whatever heading it stands under. Excused only with
//               positive evidence: it names a subject of its own, shares none
//               with the answer, does not refer to the list, and stands in
//               another item of the citation's own list or in another table
//               row (review of 6539593). Further away in the section only an
//               exception that names the answer's subject counts.
//               By design: a different-subject sibling item is excused.
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

const FAVOURABLE = /\b(?:not\s+subject\s+to|no\s+(?:deductibles?|co-?pay(?:ment)?s?|coinsurance|waiting\s+period)(?!\s+benefits?))\b/gi;
/** Wording of an exclusion or limitation. A bare cap ("up to $500") is a
 *  value, not a limitation in this sense. */
const LIMITS = new RegExp(
  [
    String.raw`\b(?:no|not|never|none|nil|nothing|neither|nor|cannot|without)\b`,
    String.raw`n['’]t\b`,
    String.raw`\bexclu(?:d(?:ed?|es|ing)|sions?|sive(?:ly)?)\b`,
    String.raw`\b(?:ineligible|non[\s-]*(?:covered|payable|eligible|reimbursable))\b`,
    String.raw`\b(?:limited\s+to|limitations?|restrict(?:ed|ions?)|only|solely|denied|declined?|void(?:ed)?|capped|waiting\s+period|terminat(?:es?|ed|ion)|responsib(?:le|ility)|ends?|ceases?|expires?|outside|barred|prohibit(?:ed|s)?|disallow(?:ed|s)?|refus(?:e|es|ed|al)|uncovered|pre-?approv(?:ed|al)|waived\s+from)\b`,
    String.raw`\bN\/A\b|(?<![\d.])0\s?%`,
  ].join("|"),
  "i",
);
/** A cost-sharing value's own label ("Deductible: $0", "Emergency Room Copay $0"). */
const COST_SHARE = /^\W*(?:[\w-]+\s+){0,2}(?:deductibles?|co-?pay(?:ment)?s?|coinsurance|out[\s-]of[\s-]pocket|premiums?)\b/i;
const statesLimit = (s: string) => LIMITS.test(s.replace(FAVOURABLE, " ")) || (/\$0(?![\d.,]*\d)/.test(s) && !COST_SHARE.test(s));

const MARKER = /\bexcept(?:ed|ing|ions?)?\b|\bunless\b|\bother\s+than\b/i;
const ACUTE = /\bacute[\s-]+onset\b/i;
const marked = (s: string) => MARKER.test(s) || ACUTE.test(s);

/** "unless otherwise noted [in the Schedule]" to the end of its clause points
 *  elsewhere and states no exception; anything after it keeps the marker. */
const BOILERPLATE = new RegExp(
  String.raw`\b(?:unless|except\s+as)\s+(?:(?:otherwise|specifically|expressly)\s+)+(?:stated|noted|indicated|specified|provided)(?:\s+for)?(?:\s+otherwise)?` +
    String.raw`(?:\s+(?:in\s+(?:the|this)\s+(?:benefit\s+summary|schedule|certificate|policy|plan|brochure|table)(?:\s+of\s+benefits)?))?(?=\s*(?:[.;,)]|$))` +
    String.raw`|\bunless\s+stated\s+as\s+(?:a\s+)?maximum\s+limit(?=\s*(?:[.;,)]|$))`,
  "gi",
);

/** A table-of-contents line: dotted leaders, then only a page number. */
const CONTENTS_LINE = /\.{4,}\s*\d{1,4}\s*$/;

/** Back-reference to the rule being stated. */
const THIS_RULE = /\b(?:this|such|these|the\s+(?:above|foregoing|following|preceding))\s*(?:exclusions?|limitations?|restrictions?|rules?|provisions?|applies|apply|charges?|items?|(?:is|are)\b)/i;
/** Names the rule itself: counts at any distance inside the section. */
const THIS_EXCLUSION = /\b(?:this|these|the\s+(?:above|foregoing|preceding))\s+(?:exclusions?|limitations?|restrictions?)\b/i;
/** Back-reference to the whole list. */
const THE_LIST = /\b(?:(?:the|all\s+of\s+the)\s+(?:above|foregoing|preceding|following)|(?:any|none|all|each)\s+of\s+these|these\s+(?:items|exclusions|limitations|charges|are)|items?\s+\(?\d)/i;
const OPENS_WITH_MARKER = /^\s*(?:(?:please\s+)?note:?\s*|important(?:\s+note)?:?\s*)?(?:except(?:ed|ing|ions?)?|unless|other\s+than)\b/i;
const NOTE_LABEL = /^\s*(?:please\s+note|note|notes|important(?:\s+note)?|exceptions?|waivers?|exemptions?|however)\b|^\s*(?:notice|warning|reminder)\s*:/i;
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
/** Words too general to say two statements are about the same thing. Every
 *  word here LOOSENS the rule (fewer shared subjects): keep it to words that
 *  can never be what an exclusion is about. */
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
  "transplant cosmetic baggage luggage telehealth"
).split(" ").map(stem));
const SMALL = new Set("a an and as at by for from in of on or the to with".split(" "));
const NUMBERED = /^\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[).]\s+/i;

/** "LABEL: …" in capitals. */
const RUN_IN = /^([A-Z][A-Z0-9 \-–/&,'’()]{2,80}):(?:\s|$)/;

/** The words of a heading-shaped line: "LABEL: …", an all-capitals line, or a
 *  title-case line between finished sentences. Shape only. */
function headingShape(line: string, prev: string | undefined): string | undefined {
  const text = line.trim().replace(NUMBERED, "");
  const runIn = RUN_IN.exec(text);
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
  if (lines[i].edge || RUN_IN.test(lines[i].text.trim().replace(NUMBERED, ""))) return false;
  const own = subject(h);
  if (![...own].some((w) => TOPIC.has(w)) || shares(own, about)) return false;
  return !refersBack(lines[i + 1]?.text ?? "");
}

// ------------------------------------------------------------------- lines

interface Line {
  page: number;
  text: string;
  heading?: string;
  /** Table row the whole line belongs to. */
  row?: string;
  /** Among the first three or last two lines of its page (where running
   *  headers and footers stand): never a section end. */
  edge?: boolean;
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
  const EDGE = 5;
  const count = new Map<string, number>();
  for (const ls of pages) {
    const keys = new Set([...ls.slice(0, EDGE), ...ls.slice(-EDGE)].map((l) => edgeKey(l.text)));
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out: Line[] = [];
  for (const ls of pages) {
    ls.forEach((l, i) => {
      const edge = i < EDGE || i >= ls.length - EDGE;
      // Page 1 has no section before it to end; a one-line page has no edge.
      if (l.page > 1 && (i < 3 || i >= ls.length - 2)) l.edge = true;
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
/** A benefit paragraph of a schedule ("Intensive care unit expenses: …"). */
const BENEFIT_LABEL = /^[A-Z][^.:;]{2,80}\b(?:expenses?|charges)\s*:\s+\S/;

/** Each line's item: its table row, its list item (a list item keeps its
 *  sub-items), or "" (text outside any). Capital run-in labels are the items
 *  of a list, and so are benefit paragraphs when the page has at least three.
 *  After an item's finished sentence, a line that opens a new sentence without
 *  a marker is outside the list again. */
function itemsOf(lines: readonly Line[], from: number, to: number): string[] {
  const benefit = new Map<number, number>();
  for (let i = from; i <= to; i++) if (BENEFIT_LABEL.test(lines[i].text.trim())) benefit.set(lines[i].page, (benefit.get(lines[i].page) ?? 0) + 1);
  const out: string[] = [];
  let open: { style: string; id: string }[] = [];
  for (let i = from; i <= to; i++) {
    const l = lines[i];
    const text = l.text.trim();
    if (l.row !== undefined) { open = []; out.push(`row ${l.page} ${l.row}`); continue; }
    const label = RUN_IN.exec(text)?.[1];
    const style = itemStyle(text) ??
      (label !== undefined && !marked(label) && !NOTE_LABEL.test(label) ? "LABEL" : undefined) ??
      (BENEFIT_LABEL.test(text) && (benefit.get(l.page) ?? 0) >= 3 && !marked(text.slice(0, text.indexOf(":"))) ? "BENEFIT" : undefined);
    if (style) {
      const k = open.findIndex((o) => o.style === style);
      open = [...(k >= 0 ? open.slice(0, k) : open), { style, id: `${style} ${i}` }];
    } else if (i > from && /^["“(]?[A-Z]/.test(text) && (refersBack(text) || l.heading !== undefined || (!continuesOnto(lines[i - 1].text, text, true) && !ENDS_OPEN.test(lines[i - 1].text)))) {
      open = [];
    }
    out.push(open[0]?.id ?? "");
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
  const introduces = isLast && (/:\s*$/.test(own) || /\b(?:exceptions?|follows|following|below|listed)\b/i.test(own) || (!lineEndsSentence(own) && own.split(/\s+/).length <= 9 && lines[statements[k].to].heading !== undefined));
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

const PRE_EXISTING = /\bpre[\s-]*existing\b/i;

/** A heading on its own line that starts another provision stands between. */
const sectionBetween = (lines: readonly Line[], i: number, j: number) =>
  lines.slice(i + 1, j).some((l) => {
    const h = l.heading;
    return h !== undefined && !l.edge && !RUN_IN.test(l.text.trim().replace(NUMBERED, "")) && !marked(h) && !NOTE_LABEL.test(h) &&
      (/\b(?:exclusions|limitations)\b/i.test(h) || [...subject(h)].some((w) => TOPIC.has(w)));
  });

/** The statement without its list marker and run-in label. */
const body = (s: string) => stripMarker(s).replace(RUN_IN, "").trim();

/** A table-of-contents line beside another one, or under "Contents". */
function contentsLine(lines: readonly Line[], i: number): boolean {
  if (!CONTENTS_LINE.test(lines[i].text)) return false;
  for (let k = Math.max(0, i - 40); k < i; k++) if (lines[k].page === lines[i].page && /^\s*(?:table\s+of\s+)?contents\s*$/i.test(lines[k].text)) return true;
  return [i - 1, i + 1].some((k) => lines[k]?.page === lines[i].page && CONTENTS_LINE.test(lines[k].text));
}

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
  // A rendered table line's column name ("(United States In-Network):") is
  // not what the line is about.
  const about = subject(answerText.replace(/\s\([^()\n]*\):/g, ":"));
  const cache = new Map<string, Line[]>();
  const omitted = (...args: Parameters<typeof needOf>) => {
    const need = needOf(...args);
    return need !== "" && !said.includes(` ${need} `);
  };

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

      const preExisting = PRE_EXISTING.test(`${answerText} ${lines[h].heading ?? ""}`);
      // The citation's own lists: a sibling is another item of one of them.
      const style = (id: string) => id.slice(0, id.lastIndexOf(" "));
      const citedStyles = new Set([...cited].filter((i) => i && !i.startsWith("row ")).map(style));
      for (const [k, s] of statements.entries()) {
        const item = at(s.from);
        const isRow = item.startsWith("row ");
        // The cited row's own cells are shown by the row itself.
        if (isRow && cited.has(item)) continue;
        const far = Math.abs(lines[s.from].page - c.page) > 1;
        const sentences = sentencesOf(s.text);
        for (const [si, sentence] of sentences.entries()) {
          if (!marked(sentence.replace(BOILERPLATE, " ")) || contentsLine(lines, s.from)) continue;
          const own = subject(sentence);
          const sharing = shares(own, named) || (preExisting && ACUTE.test(sentence));
          const sibling = item !== "" && !cited.has(item) && (isRow || citedStyles.has(style(item)) || item.startsWith("BENEFIT "));
          // An item of another list, standing before the citation's own.
          const earlier = item !== "" && !cited.has(item) && s.to < a && lines[s.from].heading === undefined && sectionBetween(lines, s.to, a);
          const other = own.size > 0 && about.size > 0 && !sharing;
          // An item that refers back or opens with the marker is never about
          // its own subject (review of ba6cd77, T2).
          const opening = statements.find((x) => at(x.from) === item)?.text ?? sentence;
          const back = [sentence, opening].some((x) => refersBack(stripMarker(x)) || refersBack(body(x)));
          if ((sibling || earlier) && other && !back && !THE_LIST.test(sentence)) continue;
          if (far && !sharing && !THIS_EXCLUSION.test(sentence)) continue;
          if (omitted(sentence, si === sentences.length - 1, k, statements, lines, items, from)) return true;
        }
      }

      // The cited and adjacent pages outside the section: an exception that
      // names the answer's own subject, or the exclusions of a whole list.
      const lo = lines.findIndex((l) => l.page >= c.page - 1);
      let hi = lines.length - 1;
      while (hi > 0 && lines[hi].page > c.page + 1) hi--;
      for (const [x, y] of [[lo, from - 1], [to + 1, hi]]) {
        if (x < 0 || y < x) continue;
        const its = itemsOf(lines, x, y);
        const outside = statementsOf(lines, its, x, y).filter((s) => s.text.trim());
        for (const [k, s] of outside.entries()) {
          if (lines[s.from].row !== undefined || contentsLine(lines, s.from)) continue;
          const sentences = sentencesOf(s.text);
          for (const [si, sentence] of sentences.entries()) {
            if (!marked(sentence.replace(BOILERPLATE, " "))) continue;
            const list = THE_LIST.test(sentence) && statesLimit(sentence);
            if (!shares(subject(sentence), about) && !list && !(preExisting && ACUTE.test(sentence))) continue;
            if (omitted(sentence, si === sentences.length - 1, k, outside, lines, its, x)) return true;
          }
        }
      }
    }
  }
  return false;
}
