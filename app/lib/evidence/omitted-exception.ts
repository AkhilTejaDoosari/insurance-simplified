// Owner decision 2026-11-24 (7), safety: an answer that states an exclusion
// or limitation is not verified when the same section of the document states
// an exception to it ("except", "unless", "other than", "acute onset") that
// the answer omits. This rule only REJECTS; whatever it cannot place is read
// widely (a missing heading makes the section larger, never smaller).
//
//   section   — the lines around the citation between two headings, over the
//               page break on either side; neighbouring sections whose heading
//               names the same subject ("Pre-existing Conditions" / "Acute
//               Onset of Pre-existing Conditions") belong to it.
//   exception — a statement of that section with a marker. "unless otherwise
//               noted" points elsewhere and states none.
//   to it     — in the citation's own list item, or in the section's text
//               outside the list, or anywhere in the section when it names the
//               same subject as the answer's sentence or refers back to it
//               ("this exclusion", or opening with the marker). Over a page
//               break only the last two. "acute onset" alone is an exception
//               to pre-existing conditions (the sentence, its heading, or the
//               statement's own back-reference say so).
//   omitted   — the answer does not state, as one run of words, the statement
//               from its marker to its end ("acute onset": the term itself).
// Pure: reads only what is passed in.

import { continuesOnto, lineEndsSentence } from "@/app/lib/evidence-verification";
import { normalizeForMatch } from "@/app/lib/pdf/text-match";

interface ExceptionDocument {
  documentId: string;
  pages: readonly string[];
}
interface ExceptionCitation {
  documentId: string;
  page: number;
  quote: string;
}

/** Wording of an exclusion or limitation. A bare cap ("up to $500") is a
 *  value, not a limitation in this sense. */
const FAVOURABLE = /\bnot\s+subject\s+to\b/gi;
const LIMITS = /\b(?:not|never|cannot|no\s+(?:coverage|benefits?|payments?|charges)|exclu(?:ded?|des|ding|sions?)|limited\s+to|limitations?|restricted|only|denied)\b|n['’]t\b/i;
const statesLimit = (s: string) => LIMITS.test(s.replace(FAVOURABLE, " "));

const BOILERPLATE = /\b(?:unless|except\s+as)\s+(?:(?:otherwise|specifically|expressly)\s+)+(?:stated|noted|indicated|specified|provided)(?:\s+otherwise)?\b/gi;
const MARKER = /\bexcept(?:ed|ing|ions?)?\b|\bunless\b|\bother\s+than\b/i;
const ACUTE = /\bacute\s+onset\b/i;

/** Words too general to say two statements are about the same thing. */
const GENERIC = new Set((
  "a an and any all are as at be been by for from has have if in is it its no not of on or other than that the their this to under was were will with within " +
  "insured person persons insurance plan policy company coverage covered cover covers benefit benefits charge charges expense expenses eligible medical treatment " +
  "treatments service services care condition limit limits limited limitation maximum period except unless excluded exclusion exclusions excludes excluding paid pay " +
  "payable pays payment only subject per day days year years month months general schedule provisions definitions terms certificate up refer which such shall may must each"
).split(" "));
const words = (s: string) => normalizeForMatch(s).toLowerCase().replace(/[^a-z0-9$%\s]/g, " ").split(/\s+/).filter(Boolean);
const run = (s: string) => words(s).join(" ");
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const subject = (s: string) => new Set(words(s).filter((w) => w.length > 2 && !/\d/.test(w) && !GENERIC.has(w)).map(stem));
const shares = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
const within = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((w) => b.has(w));

/** A statement about the rule it follows ("This exclusion does not apply …",
 *  "The following applies except …", "Except that …", "Exception: …"). */
const REFERS_BACK = /\b(?:this|these|such|the\s+(?:above|foregoing|following|preceding))\s*(?:exclusions?|limitations?|restrictions?|rules?|provisions?|applies|apply)\b/i;
const refersBack = (s: string) => REFERS_BACK.test(s) || new RegExp(`^\\s*(?:[•·▪◦*–-]\\s*)?(?:${MARKER.source})`, "i").test(s);
const PRE_EXISTING = /\bpre[\s-]*existing\b/i;

const SMALL = new Set("a an and as at by for from in of on or the to with".split(" "));
const LIST_ITEM = /^\s*(?:[•·▪◦*–-]\s|\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[).]\s)/;
/** "Label: text" opens its own paragraph, unless the label is the exception. */
const labelled = (s: string) => /^[A-Z][^.:;]{2,80}:\s+\S/.test(s) && !MARKER.test(s.slice(0, s.indexOf(":")));
const opensItem = (s: string) => LIST_ITEM.test(s) || labelled(s.trim());

/** The heading a line opens with, or undefined. `sure` = all capitals. */
function headingOf(line: string, prev: string | undefined, next: string | undefined): string | undefined {
  const text = line.trim().replace(/^\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[).]\s+/i, "");
  const runIn = /^([A-Z][A-Z0-9 \-–/&,'’()]{2,80}):\s/.exec(text);
  if (runIn) return runIn[1];
  if (/^\s*[•·▪◦*–-]\s/.test(line) || /[\d$%]/.test(text) || /[.;!?,]\s*$/.test(text)) return undefined;
  const ws = text.replace(/:\s*$/, "").split(/\s+/).filter(Boolean);
  if (ws.length === 0 || ws.length > 9) return undefined;
  if (prev !== undefined && !lineEndsSentence(prev) && continuesOnto(prev, line, true)) return undefined;
  if (/[A-Z]/.test(text) && !/[a-z]/.test(text)) return text;
  // Title case is also how table labels and wrapped cells look: a heading
  // only after a finished sentence (or at the top) and before a new one.
  const title = ws.every((w) => /^[^a-z]*[A-Z]/.test(w) || SMALL.has(w.toLowerCase()) || w.split("-").every((p) => /^[A-Z(]/.test(p)) || /^[A-Z][a-z]+-[a-z]+$/.test(w));
  const opens = prev === undefined || !prev.trim() || lineEndsSentence(prev) || /[a-z]/.test(prev) === false;
  return title && opens && next !== undefined && /^\s*(?:[•·▪◦*–-]\s|["“(]?[A-Z])/.test(next) ? text : undefined;
}

interface Line {
  page: number;
  text: string;
  heading?: string;
}

/** The lines of the citation's page and the pages beside it. */
function linesAround(doc: ExceptionDocument, page: number): Line[] {
  const out: Line[] = [];
  for (const p of [page - 1, page, page + 1]) {
    const text = doc.pages[p - 1];
    if (typeof text === "string") for (const l of text.split("\n")) if (l.trim()) out.push({ page: p, text: l });
  }
  out.forEach((l, i) => { l.heading = headingOf(l.text, out[i - 1]?.text, out[i + 1]?.text); });
  return out;
}

/** Line range [from, to] of every placement of the quote on its page; the
 *  whole page when it cannot be placed. */
function placements(lines: Line[], c: ExceptionCitation): [number, number][] {
  const at = lines.map((l, i) => ({ i, text: run(l.text), page: l.page })).filter((l) => l.page === c.page);
  if (at.length === 0) return [];
  let joined = "";
  const start: number[] = [];
  for (const l of at) { start.push(joined.length); joined += ` ${l.text}`; }
  joined += " ";
  const want = run(c.quote);
  const out: [number, number][] = [];
  const lineAt = (pos: number) => { let k = 0; while (k + 1 < start.length && start[k + 1] <= pos) k++; return at[k].i; };
  if (want) for (let p = joined.indexOf(want); p >= 0; p = joined.indexOf(want, p + 1)) out.push([lineAt(p), lineAt(p + want.length - 1)]);
  return out.length > 0 ? out : [[at[0].i, at[at.length - 1].i]];
}

/** Index ranges of the window's sections (a heading starts one). */
function sectionsOf(lines: Line[]): { from: number; to: number; heading?: string }[] {
  const out: { from: number; to: number; heading?: string }[] = [];
  lines.forEach((l, i) => {
    if (out.length === 0 || l.heading) out.push({ from: i, to: i, heading: l.heading });
    else out[out.length - 1].to = i;
  });
  return out;
}

/** The exception each statement of these lines states, with its list item
 *  (-1 = text before the first item). */
function exceptionsIn(lines: Line[], from: number, to: number): { item: number; text: string; needs: string[]; page: number }[] {
  const statements: { item: number; text: string; page: number }[] = [];
  let item = -1;
  for (let i = from; i <= to; i++) {
    const text = lines[i].text.trim();
    const prev = i > from ? lines[i - 1].text.trim() : "";
    if (opensItem(text) && i > from) item = i;
    const last = statements[statements.length - 1];
    const split = /\b(?:other|acute)$/i.test(prev) && /^(?:than|onset)\b/i.test(text);
    if (last && last.item === item && !lineEndsSentence(prev) && (split || continuesOnto(prev, text, true))) last.text += ` ${text}`;
    else statements.push({ item, text, page: lines[i].page });
  }
  const out: { item: number; text: string; needs: string[]; page: number }[] = [];
  for (const s of statements) {
    for (const sentence of s.text.split(/(?<=[.;!?])\s+(?=[A-Z"“(•])/)) {
      const own = sentence.replace(BOILERPLATE, " ");
      const marker = MARKER.exec(own);
      const needs = [...(marker ? [run(own.slice(marker.index))] : []), ...(ACUTE.test(own) ? ["acute onset"] : [])];
      if (needs.length > 0) out.push({ item: s.item, text: sentence, needs, page: s.page });
    }
  }
  return out;
}

/** True when the answer states an exclusion or limitation and leaves out an
 *  exception that a cited section states to it. */
export function omitsException(
  answerText: string,
  citations: readonly ExceptionCitation[],
  documents: readonly ExceptionDocument[],
): boolean {
  const said = ` ${run(answerText)} `;
  const limits = answerText.split(/\n+|(?<=[.!?])\s+(?=[A-Z"(])/).filter(statesLimit);
  if (limits.length === 0) return false;
  for (const sentence of limits) {
    const own = words(sentence).filter((w) => w.length > 2);
    const about = subject(sentence);
    const holding = citations.filter((c) => { const have = new Set(words(c.quote)); return own.every((w) => have.has(w)); });
    for (const c of holding.length > 0 ? holding : citations) {
      const doc = documents.find((d) => d.documentId === c.documentId);
      if (!doc) continue;
      const lines = linesAround(doc, c.page);
      const sections = sectionsOf(lines);
      for (const [a, b] of placements(lines, c)) {
        let first = sections.findIndex((s) => s.from <= a && a <= s.to);
        let last = sections.findIndex((s) => s.from <= b && b <= s.to);
        const name = subject(sections[first]?.heading ?? "");
        const same = (h: string | undefined) => { const x = subject(h ?? ""); return within(name, x) || within(x, name); };
        while (first > 0 && same(sections[first - 1].heading)) first--;
        while (last + 1 < sections.length && same(sections[last + 1].heading)) last++;
        const from = sections[first].from;
        const to = sections[last].to;
        // The citation's own list items (-1: outside any list).
        const items = new Set<number>();
        for (let i = a; i <= b; i++) {
          let k = i;
          while (k > from && !opensItem(lines[k].text)) k--;
          items.add(k > from && opensItem(lines[k].text) ? k : -1);
        }
        for (const e of exceptionsIn(lines, from, to)) {
          const named = shares(about, subject(e.text)) || refersBack(e.text);
          const near = e.page === c.page && (e.item === -1 || items.has(e.item));
          const onset = e.needs.length === 1 && e.needs[0] === "acute onset";
          const toIt = named || (near && (!onset || PRE_EXISTING.test(`${sentence} ${sections[first].heading ?? ""}`)));
          if (toIt && e.needs.some((n) => !said.includes(` ${n} `))) return true;
        }
      }
    }
  }
  return false;
}
