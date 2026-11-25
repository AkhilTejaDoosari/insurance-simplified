// SBC "Important Questions" claims.
//
// The form prints three columns: a question, the plan's answer, and a fixed
// federal explanation ("Why This Matters"). An answer is the text between the
// question's own words and the explanation's own opening words; both come
// from the form, so neither can be confused with plan text. When either is
// missing, or anything else sits between them, there is no claim.
//
// An answer made only of amounts, enrollment words and network labels is
// split into one claim per amount, each bound by the label that introduces
// it. A following sentence is carried verbatim with every amount. Any other
// answer stays one verbatim value.
//
// Claims carry a `statement` anchor (page + exact span of question + answer);
// verifySbcAnchor re-parses the page and requires an exact match.

import type { CellValue, Qualifiers } from "@/app/lib/extraction/types";
import { isSbcDocument } from "@/app/lib/extraction/sbc";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";

export interface SbcDocument {
  documentId: string;
  pageCount?: number;
  pages: readonly string[];
}

interface QuestionSpec {
  factName: string;
  question: RegExp;
  /** Opening words of the federal explanation, in any edition of the form. */
  why: RegExp;
  kind: "amount" | "yes-no";
}

/** Fixed form wording → regex: any whitespace run, typographic apostrophes,
 *  and a line break allowed after a hyphen. */
const form = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+").replace(/-/g, "[-‐‑–]\\s*").replace(/'/g, "['’]");
const any = (...texts: string[]) => `(?:${texts.map(form).join("|")})`;

const QUESTIONS: readonly QuestionSpec[] = [
  {
    factName: "annual-deductible", kind: "amount",
    question: new RegExp(form("What is the overall deductible?"), "gi"),
    why: new RegExp(any(
      "Generally, you must pay all of the costs", "Generally, you must pay all the costs", "You must pay all the costs up to the deductible",
      "See the Common Medical Events chart below", "See the chart starting on page",
    ), "i"),
  },
  {
    factName: "out-of-pocket-maximum", kind: "amount",
    question: new RegExp(any("What is the out-of-pocket limit for this plan?", "Is there an out-of-pocket limit on my expenses?"), "gi"),
    why: new RegExp(any("The out-of-pocket limit is the most you could pay", "This plan does not have an out-of-pocket limit", "There's no limit on how much you could pay"), "i"),
  },
  {
    factName: "network", kind: "yes-no",
    question: new RegExp(`${form("Will you pay less if you use")}\\s+(?:a|an)\\s+(?:in[-‐‑–]\\s*)?${form("network provider?")}`, "gi"),
    why: new RegExp(any(
      "This plan uses a provider network", "You pay the least if you use a provider", "This plan does not use a provider network",
      "Be aware, your network provider", "You will pay less if you use a provider",
    ), "i"),
  },
  {
    factName: "referral-requirement", kind: "yes-no",
    question: new RegExp(form("Do you need a referral to see a specialist?"), "gi"),
    why: new RegExp(any("This plan will pay some or all of the costs to see a specialist", "You can see the specialist you choose"), "i"),
  },
];

const MAX_ANSWER = 600;
/** Text of another part of the form inside an answer: the columns were not
 *  read in order, so the answer is not the plan's answer. */
const NOT_ANSWER_TEXT =
  /\?|\bWhy This Matters\b|\bImportant Questions\b|\bPage\s+\d+\s+of\s+\d+\b|\bCommon Medical\b|\bWhat You Will Pay\b|\bSummary of Benefits and Coverage\b|\bfor more information about limitations\b|\bEven though you pay these expenses\b|\bbefore this plan begins to pay\b|\bFor example, this plan covers\b/i;
const YES_NO = /^(?:yes|no|not applicable|none)\b/i;
const NO_AMOUNT_ANSWER = /^(?:none|no|not applicable|n\/a)\b[.,]?(?:[^.?!]{0,60}\.?)?$/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

interface Answer { page: number; start: number; end: number; question: string; answer: string }

/** The single answer a document gives to a question, or undefined. */
function answerOf(pages: readonly string[], spec: QuestionSpec): Answer | undefined {
  const found: Answer[] = [];
  let asked = 0;
  pages.forEach((page, i) => {
    for (const m of page.matchAll(spec.question)) {
      asked++;
      const from = (m.index ?? 0) + m[0].length;
      const rest = page.slice(from);
      const why = spec.why.exec(rest);
      if (!why || why.index > MAX_ANSWER) continue;
      const raw = rest.slice(0, why.index);
      const answer = squash(raw);
      if (!answer || NOT_ANSWER_TEXT.test(answer)) continue;
      found.push({ page: i + 1, start: m.index ?? 0, end: from + raw.trimEnd().length, question: squash(m[0]), answer });
    }
  });
  return asked === 1 && found.length === 1 ? found[0] : undefined;
}

// ---------------------------------------------------------- amount grammar

const AMOUNT = "\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?(?![\\d,]*\\d)";
const WHO = "(?:individual|family|person|member|single|self[- ]only|self|employee(?:\\s+(?:only|plus one))?|two[- ]person|enrollee|couple)";
const PER = "(?:\\s*/\\s*|\\s+per\\s+|\\s+)";
const NET =
  "(?:(?:in|out[-‐‑–]of|non)[-‐‑–\\s]?network|network|preferred|non[-‐‑–]?preferred|participating|non[-‐‑–]?participating)";
const NET_LABEL = `(?:for\\s+)?(?<label>(?<net>${NET})(?:\\s+providers?)?)\\s*:?\\s*`;
const SEP = "\\s*(?:[/,;]|\\bor\\b|\\band\\b|[/,;]\\s*(?:or|and)\\b)\\s*";
const SUFFIX = `${AMOUNT}${PER}${WHO}\\b`;
const PREFIX = `${WHO}\\s*:?\\s*${AMOUNT}`;
const LIST = `(?:${SUFFIX}(?:${SEP}${SUFFIX})*|${PREFIX}(?:${SEP}${PREFIX})*|${AMOUNT})`;

interface Part { display: string; networkTier?: string; conditions?: string }

/** Amounts of one list ("$200 individual/ $400 family"), or undefined. */
function partsOf(list: string, label?: string, net?: string): Part[] {
  const prefixed = new RegExp(`^${PREFIX}`, "i").test(list);
  const item = new RegExp(prefixed ? PREFIX : `${SUFFIX}|${AMOUNT}`, "gi");
  return [...list.matchAll(item)].map((m) => {
    const text = squash(m[0]);
    const who = new RegExp(`\\b${WHO}\\b`, "i").exec(text)?.[0];
    return {
      display: label ? `${squash(label)}: ${text}` : text,
      ...(net ? { networkTier: squash(net) } : {}),
      ...(who ? { conditions: squash(who) } : {}),
    };
  });
}

/** Split an answer that is amount lists, each optionally introduced by a
 *  network label, followed by at most whole sentences. */
function splitAnswer(answer: string): { parts: Part[]; note: string } | undefined {
  const group = new RegExp(`^(?:${NET_LABEL})?(?<list>${LIST})(?=\\s*(?:[.;,]|$)|\\s+(?:for\\s+)?${NET}\\b|\\s+(?:per|each)\\s+(?:calendar|plan|policy|benefit)?\\s*year\\b)`, "i");
  const parts: Part[] = [];
  let rest = answer;
  let labelled: boolean | undefined;
  for (;;) {
    const m = group.exec(rest);
    if (!m?.groups) break;
    const hasLabel = m.groups.label !== undefined;
    // An unlabelled amount next to a labelled one has no stated network.
    if (labelled !== undefined && (labelled !== hasLabel || !hasLabel)) return undefined;
    labelled = hasLabel;
    parts.push(...partsOf(m.groups.list, m.groups.label, m.groups.net));
    rest = rest.slice(m[0].length).replace(/^\s*[.;,]?\s*(?:and\s+(?=(?:for\s+)?(?:in|out|non|network|preferred|participating)))?/i, "");
  }
  if (parts.length === 0) return undefined;
  const scopes = parts.map((p) => `${p.networkTier ?? ""}|${p.conditions ?? ""}`.toLowerCase());
  if (new Set(scopes).size !== scopes.length) return undefined;
  const note = rest.trim();
  // What follows must be a sentence of its own, never the rest of an amount.
  if (note && !/^[A-Z]/.test(note) && !/^per\s/i.test(note)) return undefined;
  return { parts, note };
}

interface SbcClaim { factName: string; value: CellValue }

function claimsFor(doc: SbcDocument, spec: QuestionSpec): SbcClaim[] {
  const found = answerOf(doc.pages, spec);
  if (!found) return [];
  const quote = doc.pages[found.page - 1].slice(found.start, found.end);
  const verified = verifyEvidenceCitation(
    [{ documentId: doc.documentId, pageCount: doc.pageCount ?? doc.pages.length, pages: [...doc.pages] }],
    { documentId: doc.documentId, page: found.page, quote },
  );
  if (!verified.ok) return [];
  const claim = (display: string, qualifiers: Qualifiers): SbcClaim => ({
    factName: spec.factName,
    value: {
      documentId: doc.documentId,
      display,
      qualifiers,
      evidence: [{ documentId: doc.documentId, page: found.page, quote: verified.quote }],
      anchor: { kind: "statement", page: found.page, start: found.start, end: found.end },
    },
  });
  if (spec.kind === "yes-no") {
    return YES_NO.test(found.answer) ? [claim(`${found.question} ${found.answer}`, {})] : [];
  }
  if (!/\$\s?\d/.test(found.answer)) {
    return NO_AMOUNT_ANSWER.test(found.answer) ? [claim(found.answer, {})] : [];
  }
  const split = splitAnswer(found.answer);
  if (!split) return [claim(found.answer, {})];
  return split.parts.map((p) => claim(split.note ? `${p.display}\n${split.note}` : p.display, {
    ...(p.networkTier ? { networkTier: p.networkTier } : {}),
    ...(p.conditions ? { conditions: p.conditions } : {}),
  }));
}

/** Every "Important Questions" claim of an SBC document. */
export function sbcQuestionClaims(doc: SbcDocument): SbcClaim[] {
  if (!isSbcDocument(doc.pages)) return [];
  return QUESTIONS.flatMap((spec) => claimsFor(doc, spec));
}

/** True only when the value is exactly a claim the document's own questions
 *  table states at the anchor span, for this fact. */
export function verifySbcAnchor(
  factName: string,
  value: Pick<CellValue, "documentId" | "display" | "qualifiers" | "evidence" | "anchor">,
  documents: readonly SbcDocument[],
): boolean {
  const anchor = value.anchor;
  if (!anchor || anchor.kind !== "statement") return false;
  const doc = documents.find((d) => d.documentId === value.documentId);
  if (!doc) return false;
  return sbcQuestionClaims(doc).some(({ factName: fact, value: expected }) =>
    fact === factName &&
    expected.anchor?.kind === "statement" &&
    expected.anchor.page === anchor.page && expected.anchor.start === anchor.start && expected.anchor.end === anchor.end &&
    squash(expected.display) === squash(value.display) &&
    (["planTier", "networkTier", "conditions"] as const).every((k) => (expected.qualifiers[k] ?? "") === (value.qualifiers[k] ?? "")) &&
    expected.evidence.every((e) => value.evidence.some((v) => v.page === e.page && squash(v.quote) === squash(e.quote))));
}
