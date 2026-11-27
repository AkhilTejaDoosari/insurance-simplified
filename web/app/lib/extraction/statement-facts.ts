// Statement claims: enrollment-scoped cost statements in prose, read with a
// closed grammar instead of keyword proximity.
//
// A claim exists only when one whole sentence has exactly this shape:
//
//   For [a] <SCOPE> contract(s)|enrollment(s), the|your [<NETWORK>]
//     <CONCEPT> is|will be [now] <AMOUNT> [(see page N)] .
//
//   SCOPE   — one or more enrollment categories joined by ","/"and"/"or",
//             each DECLARED by the document's own enrollment record;
//   NETWORK — Preferred Provider | Preferred | Non-preferred (provider);
//   CONCEPT — (calendar year) deductible | (catastrophic) out-of-pocket maximum.
//
// Scope, network, concept and amount are therefore bound by grammar, not by
// distance. Anything else in the sentence (another amount, "when you use…",
// "per person", exclusions) means it does not match and no claim is made.
//
// The claim carries a `statement` anchor (page + exact span). verifyStatement-
// Anchor re-parses that span from the page text and requires an exact match.

import type { CellValue, StatementAnchor } from "@/app/lib/extraction/types";
import { declaredEnrollmentCategories } from "@/app/lib/extraction/plan-identity";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import type { Span } from "@/app/lib/pdf/layout-tables";

export interface StatementDocument {
  documentId: string;
  pageCount?: number;
  pages: readonly string[];
}

const CONCEPTS: readonly { factName: string; re: string }[] = [
  { factName: "annual-deductible", re: "(?:calendar\\s+year\\s+)?deductible" },
  { factName: "out-of-pocket-maximum", re: "(?:catastrophic\\s+)?out-of-\\s*pocket\\s+maximum" },
];

const words = (text: string) => text.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");

function grammar(categories: readonly string[]): RegExp {
  const cat = `(?:${categories.map(words).join("|")})`;
  const scope = `${cat}(?:\\s*,?\\s+(?:and|or)\\s+(?:a\\s+)?${cat}|\\s*,\\s*${cat})*`;
  const net = "(?:Preferred\\s+Provider|Non-?\\s*preferred(?:\\s+provider)?|Preferred)";
  const concept = CONCEPTS.map((c, i) => `(?<c${i}>${c.re})`).join("|");
  return new RegExp(
    // sentence start: text start, a bullet, a line start, or a sentence end
    `(?<=^|[•\\n]\\s*|[.!?]\\s+)` +
    `For\\s+(?:an?\\s+)?(?<scope>${scope})\\s+(?:contracts?|enrollments?)\\s*,\\s+(?:the|your)\\s+` +
    `(?:(?<net>${net})\\s+)?(?:${concept})\\s+(?:is|will\\s+be)\\s+(?:now\\s+)?` +
    `(?<amount>\\$\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)` +
    `(?:\\s*\\(see\\s+pages?\\s+\\d+(?:[-–]\\d+)?\\))?` +
    // sentence end: period, or the end of a bullet item
    `(?:\\.(?=\\s|$)|(?=\\s*\\n\\s*•)|$)`,
    "g",
  );
}

interface ParsedStatement {
  factName: string;
  span: Span;
  scope: string;
  network?: string;
  amount: string;
  text: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- context
// A whole-sentence match is necessary but not sufficient: the text that
// GOVERNS a statement can make it an example, another plan's figure, or a
// conditional provision. Governing context is defined by source structure,
// not by a line count:
//
//   region     — the statement's section: back from the statement to the
//                nearest numbered major heading ("Section 2. Changes for
//                2027"), across page breaks, or to the document start;
//   governing  — within the region: every non-bullet line (headings, lead-ins,
//                paragraphs, the statement's own same-line prefix), the
//                statement's own bullet item, and bullet items that end with
//                ":" (lead-ins). Sibling bullet items are separate provisions
//                and never govern it. Quoted text is a mention, not framing;
//   framing    — governing text that calls the content an example,
//                illustration, hypothetical, sample, scenario, or another /
//                not-this plan applies until an explicit end ("End of
//                example") or the section ends;
//   restriction— a dangling condition sentence ("Only if you use Preferred
//                providers.") in the governing text, the sentence right after
//                the statement ("Unless…", "This is an example."), a dangling
//                condition bullet right after it, or — when nothing but
//                running headers/footers follows the statement on its page —
//                the first sentence of the next page.
//
// Any framing or restriction ⇒ no claim (the grammar cannot carry a
// condition, so the claim would omit it). Nothing here creates or widens a
// claim; ambiguity only withholds.
const MAJOR_HEADING = /^\s*(?:Section|Part|Article|Chapter)\s+\d+[A-Z]?\s*[.:]?\s+\S/i;
const BULLET = /^\s*[•·▪◦]/;
const FRAMING =
  /\b(?:examples?|illustrat\w*|hypothetical\w*|samples?|suppose\w*|for\s+instance|e\.g\.|fictional|fictitious|scenarios?|does\s+not\s+(?:describe|apply\s+to|reflect|represent)|(?:not|other|another)\s+(?:this\s+)?plans?|competitors?|comparable\s+plans?)\b/i;
const FRAMING_END = /\bend\s+of\s+(?:the\s+)?(?:examples?|illustrations?|scenarios?|samples?)\b/i;
const CONNECTIVE = /^(?:only|unless|except|provided|but\s+only|if|when|subject\s+to)\b/i;
const MODIFIER =
  /^(?:(?:this|these|that|those|it|such)\b[^.]*\b(?:examples?|illustrat\w*|hypothetical\w*|samples?|only|unless|except|not|if|when)\b|(?:however|unless|except|only|but|if|when|provided|subject\s+to|otherwise)\b)/i;
const DEMONSTRATIVE_FRAMING = /^(?:this|these|that|those|such)\b[^.]*\b(?:examples?|illustrat\w*|hypothetical\w*|samples?)\b/i;
const SENTENCE_END = /[.!?]["”)]?\s*$/;

const unquote = (text: string) => text.replace(/"[^"\n]*"|“[^”]*”/g, " ");
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).map((s) => s.replace(BULLET, "").trim()).filter(Boolean);
/** A condition with no main clause of its own: it qualifies a neighbour. */
const dangling = (sentence: string) => CONNECTIVE.test(sentence) && !sentence.includes(",");

/** Lines of the statement's section before the statement, in reading order;
 *  the last line is the statement's own same-line prefix. */
function regionLines(pages: readonly string[], pageIndex: number, start: number): string[] {
  const out: string[] = [];
  const take = (lines: string[]) => {
    for (let k = lines.length - 1; k >= 0; k--) {
      out.unshift(lines[k]);
      if (MAJOR_HEADING.test(lines[k])) return true;
    }
    return false;
  };
  if (take(pages[pageIndex].slice(0, start).split("\n"))) return out;
  for (let p = pageIndex - 1; p >= 0; p--) if (take(pages[p].split("\n"))) break;
  return out;
}

interface Unit { text: string; bullet: boolean }

/** Group lines into bullet items (with their wrapped continuation lines) and
 *  single non-bullet lines. */
function units(lines: readonly string[]): Unit[] {
  const out: Unit[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (BULLET.test(line)) out.push({ text: line, bullet: true });
    else if (last?.bullet && (!/[.!?:]\s*$/.test(last.text) || /^\s*[a-z]/.test(line))) last.text += "\n" + line;
    else out.push({ text: line, bullet: false });
  }
  return out;
}

function governingAdmits(pages: readonly string[], pageIndex: number, start: number): boolean {
  const all = units(regionLines(pages, pageIndex, start));
  const own = all.length - 1;
  let framed = false;
  for (const [k, u] of all.entries()) {
    const governs = !u.bullet || k === own || /:\s*$/.test(u.text);
    if (!governs) continue;
    const text = unquote(u.text);
    for (const s of sentences(text)) {
      if (FRAMING_END.test(s)) framed = false;
      else if (FRAMING.test(s)) framed = true;
      if (dangling(s)) return false;
    }
  }
  return !framed;
}

/** The text that directly follows a statement, without its own "(see page N)." */
function after(page: string, end: number): string {
  return page.slice(end).replace(/^[ \t]*\(?see\s+pages?[^)\n]*\)?\.?/i, "");
}

function followingAdmits(pages: readonly string[], pageIndex: number, end: number): boolean {
  const rest = after(pages[pageIndex], end);
  const first = rest.trim();
  const blocks = (text: string) => {
    const t = unquote(text.trim());
    if (BULLET.test(t)) {
      // A sibling item is its own provision unless it is a bare condition
      // or calls the list an example.
      const s = sentences(t.split(/\n\s*(?=[•·▪◦])/)[0])[0] ?? "";
      return dangling(s) || DEMONSTRATIVE_FRAMING.test(s);
    }
    const s = sentences(t)[0] ?? "";
    return MODIFIER.test(s);
  };
  if (first && blocks(first)) return false;
  // Nothing but running headers / footers left on this page: the provision
  // may continue on the next one.
  const restLines = rest.split("\n").map((l) => l.trim()).filter(Boolean);
  if (restLines.some((l) => SENTENCE_END.test(l) || BULLET.test(l))) return true;
  const next = pages[pageIndex + 1];
  if (next === undefined) return true;
  const lead: string[] = [];
  for (const line of next.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (MAJOR_HEADING.test(line)) break;
    lead.push(line);
    if (SENTENCE_END.test(line)) break;
  }
  return !lead.some((l) => blocks(l)) && !blocks(lead.join(" "));
}

function contextAdmits(pages: readonly string[], pageIndex: number, start: number, end: number): boolean {
  return governingAdmits(pages, pageIndex, start) && followingAdmits(pages, pageIndex, end);
}

function parsePage(pages: readonly string[], pageIndex: number, categories: readonly string[]): ParsedStatement[] {
  const page = pages[pageIndex];
  if (categories.length === 0 || typeof page !== "string") return [];
  const out: ParsedStatement[] = [];
  for (const m of page.matchAll(grammar(categories))) {
    const concept = CONCEPTS.findIndex((_, i) => m.groups?.[`c${i}`] !== undefined);
    if (concept < 0 || !m.groups) continue;
    const start = m.index ?? 0;
    if (!contextAdmits(pages, pageIndex, start, start + m[0].length)) continue;
    const text = squash(m[0]);
    out.push({
      factName: CONCEPTS[concept].factName,
      span: { start, end: start + m[0].length },
      scope: squash(m.groups.scope),
      ...(m.groups.net ? { network: squash(m.groups.net) } : {}),
      amount: m.groups.amount,
      text,
    });
  }
  return out;
}

function claimOf(doc: StatementDocument, page: number, s: ParsedStatement): CellValue | undefined {
  const quote = doc.pages[page - 1].slice(s.span.start, s.span.end);
  const verified = verifyEvidenceCitation(
    [{ documentId: doc.documentId, pageCount: doc.pageCount ?? doc.pages.length, pages: [...doc.pages] }],
    { documentId: doc.documentId, page, quote },
  );
  if (!verified.ok) return undefined;
  return {
    documentId: doc.documentId,
    display: s.text,
    qualifiers: { conditions: s.scope, ...(s.network ? { networkTier: s.network } : {}) },
    evidence: [{ documentId: doc.documentId, page, quote: verified.quote }],
    anchor: { kind: "statement", page, start: s.span.start, end: s.span.end },
  };
}

/** Every statement claim in a document, with its fact. */
export function statementClaims(doc: StatementDocument): { factName: string; value: CellValue }[] {
  const categories = declaredEnrollmentCategories(doc.pages[0]);
  const out: { factName: string; value: CellValue }[] = [];
  doc.pages.forEach((page, i) => {
    for (const s of parsePage(doc.pages, i, categories)) {
      const value = claimOf(doc, i + 1, s);
      if (value) out.push({ factName: s.factName, value });
    }
  });
  return out;
}

/** Page-text spans of statement claims per fact, per page. */
export function statementOwnedSpans(doc: StatementDocument): Map<string, Map<number, Span[]>> {
  const categories = declaredEnrollmentCategories(doc.pages[0]);
  const owned = new Map<string, Map<number, Span[]>>();
  doc.pages.forEach((page, i) => {
    for (const s of parsePage(doc.pages, i, categories)) {
      const byPage = owned.get(s.factName) ?? owned.set(s.factName, new Map()).get(s.factName)!;
      (byPage.get(i + 1) ?? byPage.set(i + 1, []).get(i + 1)!).push(s.span);
    }
  });
  return owned;
}

/** True only when the value is exactly the claim the document's text states
 *  at its anchor span, for this fact. */
export function verifyStatementAnchor(
  factName: string,
  value: Pick<CellValue, "documentId" | "display" | "qualifiers" | "evidence" | "anchor">,
  documents: readonly StatementDocument[],
): boolean {
  const anchor = value.anchor;
  if (!anchor || anchor.kind !== "statement") return false;
  const doc = documents.find((d) => d.documentId === value.documentId);
  if (!doc || typeof doc.pages[anchor.page - 1] !== "string") return false;
  const parsed = parsePage(doc.pages, anchor.page - 1, declaredEnrollmentCategories(doc.pages[0]))
    .find((s) => s.span.start === anchor.start && s.span.end === anchor.end && s.factName === factName);
  if (!parsed) return false;
  const expected = claimOf(doc, anchor.page, parsed);
  if (!expected) return false;
  if (squash(expected.display) !== squash(value.display)) return false;
  for (const k of ["planTier", "networkTier", "conditions"] as const) {
    if ((expected.qualifiers[k] ?? "") !== (value.qualifiers[k] ?? "")) return false;
  }
  return expected.evidence.every((e) => value.evidence.some((v) => v.page === e.page && squash(v.quote) === squash(e.quote)));
}

export type { StatementAnchor };
