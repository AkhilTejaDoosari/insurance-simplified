// Comparison answers (owner decision 2026-11-25). A question that compares
// plans and names one grid concept is answered from the session's RE-VERIFIED
// comparison grid: the verified values of each selected plan, verbatim, with
// their own citations. No model is involved and no number is written here:
// every figure is a verified value's own text. No verification rule is added;
// values that are not attributed to the plan, do not verify in the chat scope,
// or whose claim cannot be grounded are never shown as the plan's value.

import type { CellValue, TableRow } from "@/app/lib/extraction/types";
import { describeFact } from "@/app/lib/presentation/claim";
import { verifyAnswerClaims, verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { isValuelessLabel } from "@/app/lib/extraction/extract";
import { FACT_CONCEPTS, conceptForQuestion, type FactConcept, type GridSelection } from "@/app/lib/chat/grid-first";
import type { ChatCitation, ChatResponse } from "@/app/lib/rag/answer";

const COMPARES =
  /\b(?:which|what) (?:of (?:these |the |my )?)?(?:plan|policy|one)s?\b|\bcompar(?:e|es|ed|ing|ison)\b|\b(?:lowest|highest|cheapest|least expensive|most expensive)\b|\b(?:all|each|every|both) (?:of )?(?:the |my |these )?(?:(?:two|three|2|3) )?(?:selected )?(?:plan|policie)s?\b|\bdifferences? between\b/i;
const RANKS = /\b(?:lowest|cheapest|least expensive|highest|most expensive)\b/i;
const RANKS_HIGH = /\b(?:highest|most expensive)\b/i;
/** Words that only say which plans are compared; they name no service. */
const PLAN_PHRASE =
  /\b(?:for|across|between|among|in|of|on|with)\s+(?:all|each|every|both|these|the|my)?\s*(?:of\s+)?(?:these|the|my)?\s*(?:two|three|2|3)?\s*(?:selected\s+)?(?:plan|policie|policy)s?\b/gi;

const HOSPITALIZATION: FactConcept = { id: "hospitalization", question: /\bhospital(?:i[sz]ation| stays?)?\b|\binpatient\b/i, facts: ["hospitalization"] };

export const NOT_STATED_IN_PLAN = "Not stated in this plan's document";
export const NOT_VERIFIED_IN_PLAN = "No verified value (this plan's document mentions it; check the original pages)";
export const CANNOT_RANK = "These values can't be ranked directly: they differ in kind, conditions, network or tier.";
export const NEEDS_CHECK = "Needs verification: check these values on the cited pages.";

/** The one grid concept a comparison question names, or undefined. */
export function comparisonConcept(question: string): FactConcept | undefined {
  if (!COMPARES.test(question)) return undefined;
  const text = question.replace(PLAN_PHRASE, " ");
  if (HOSPITALIZATION.question.test(text) && !FACT_CONCEPTS.some((c) => c.question.test(text))) return HOSPITALIZATION;
  return conceptForQuestion(text);
}

interface Plan { planId: string; name: string; sources: readonly { documentId: string }[] }
interface Doc { documentId: string; pageCount: number; pages: string[] }

const cellOf = (claim: string) => claim.slice(claim.lastIndexOf("): ") + 3).trim();
const PLAIN = /^\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?$|^\d{1,3}%$/;
const kindOf = (claim: string) => /copay|deductible|coinsurance|premium|maximum|limit/i.exec(claim)?.[0].toLowerCase() ?? "";

export function comparePlansAnswer(input: {
  question: string;
  table: { rows: readonly TableRow[]; plans?: readonly Plan[] };
  scopedDocuments: Doc[];
  sessionDocuments: Doc[];
  selection?: GridSelection;
}): Extract<ChatResponse, { kind: "answer" }> | undefined {
  const concept = comparisonConcept(input.question);
  if (!concept) return undefined;
  const selected = (input.table.plans ?? []).filter((p) => !input.selection || input.selection.planIds.includes(p.planId));
  if (selected.length < 2) return undefined;
  const rows = input.table.rows.filter((r) => concept.facts.includes(r.factName));
  if (rows.some((r) => r.verdict === "CONFLICTED")) return undefined;
  // A hospital row repeats emergency-room cells; they are another concept.
  const elsewhere = new Set(concept === HOSPITALIZATION
    ? input.table.rows.filter((r) => r.factName === "emergency-care").flatMap((r) => r.values.map((v) => v.display)) : []);

  const lines: string[] = [];
  const citations: ChatCitation[] = [];
  const sessionDocs = input.sessionDocuments.map((d) => ({ documentId: d.documentId, pages: d.pages }));
  const shown: { planId: string; name: string; value: CellValue; claim: string; conditions: string[] }[] = [];
  const missing: string[] = [];
  let uncertain = false;
  for (const plan of selected) {
    const documents = new Set(plan.sources.map((s) => s.documentId));
    const tier = input.selection?.tiers[plan.planId];
    const mentioned = rows.some((r) =>
      r.values.some((v) => documents.has(v.documentId)) || (r.withheld ?? []).some((w) => documents.has(w.documentId)));
    // One group per provision (row label): a condition stays with the values
    // it governs, or stands once at the end when it governs all of them.
    const groups = new Map<string, { lines: string[]; conditions: Set<string>[] }>();
    for (const row of rows) {
      for (const value of row.values) {
        if (value.planId !== plan.planId || elsewhere.has(value.display)) continue;
        if (tier && value.qualifiers.planTier && value.qualifiers.planTier.toLowerCase() !== tier.toLowerCase()) continue;
        const cites: ChatCitation[] = [];
        let verified = true;
        for (const e of value.evidence) {
          const session = verifyEvidenceCitation(input.sessionDocuments, e);
          if (!session.ok || !verifyEvidenceCitation(input.scopedDocuments, e).ok) { verified = false; break; }
          cites.push({ documentId: e.documentId, page: e.page, quote: session.quote });
        }
        if (!verified || cites.length === 0) continue;
        const d = describeFact(value, row.factName);
        if (d.status === "unconfirmed") continue;
        const claim = d.claim ?? d.sourceWording;
        // A line value passes the same gate as any answer; a table cell is
        // grounded structurally (its re-derived anchor and describeFact).
        if (value.anchor?.kind !== "table-cell" && !verifyAnswerClaims(claim, cites, cites, sessionDocs).ok) continue;
        if (row.verdict !== "SUPPORTED") uncertain = true;
        const flat = claim.replace(/\s*\n\s*/g, " ");
        const key = value.anchor?.kind === "table-cell" ? value.anchor.label : flat;
        const group = groups.get(key) ?? groups.set(key, { lines: [], conditions: [] }).get(key)!;
        if (!group.lines.includes(flat)) group.lines.push(flat);
        // A bare section heading ("PLAN OPTIONS") states no condition.
        const conditions = d.conditions.filter((c) => !isValuelessLabel(c));
        group.conditions.push(new Set(conditions));
        shown.push({ planId: plan.planId, name: plan.name, value, claim: flat, conditions });
        for (const c of cites) if (!citations.some((x) => x.documentId === c.documentId && x.page === c.page && x.quote === c.quote)) citations.push(c);
      }
    }
    if (groups.size === 0) {
      missing.push(plan.name);
      lines.push(`${plan.name} — ${mentioned ? NOT_VERIFIED_IN_PLAN : NOT_STATED_IN_PLAN}`);
      continue;
    }
    const sets = [...groups.values()].flatMap((g) => g.conditions);
    const shared = new Set([...sets[0]].filter((c) => sets.every((set) => set.has(c))));
    const say = (c: string) => lines.push(`${plan.name} — condition: ${c.replace(/\s*\n\s*/g, " ")}`);
    for (const group of groups.values()) {
      for (const line of group.lines) lines.push(`${plan.name} — ${line}`);
      for (const c of new Set(group.conditions.flatMap((set) => [...set]))) if (!shared.has(c)) say(c);
    }
    for (const c of shared) say(c);
  }
  if (shown.length === 0) return undefined;
  if (uncertain) lines.push(NEEDS_CHECK);
  if (RANKS.test(input.question)) {
    const plain = missing.length === 0 && !uncertain &&
      shown.every((s) => s.conditions.length === 0 && PLAIN.test(cellOf(s.claim)) && !s.value.qualifiers.planTier) &&
      new Set(shown.map((s) => cellOf(s.claim).endsWith("%"))).size === 1 &&
      new Set(shown.map((s) => `${kindOf(s.claim)}|${s.value.qualifiers.networkTier ?? ""}|${s.value.qualifiers.conditions ?? ""}`.toLowerCase())).size === 1 &&
      shown.length === selected.length;
    if (!plain) lines.push(CANNOT_RANK);
    else {
      const amount = (claim: string) => Number(cellOf(claim).replace(/[$,%]/g, ""));
      const high = RANKS_HIGH.test(input.question);
      const target = (high ? Math.max : Math.min)(...shown.map((s) => amount(s.claim)));
      const hits = shown.filter((s) => amount(s.claim) === target);
      lines.push(`${high ? "Highest" : "Lowest"} stated value: ${hits.map((s) => `${s.name} (${cellOf(s.claim)})`).join(", ")}`);
    }
  }
  return { schemaVersion: "v1", kind: "answer", answerText: lines.join("\n"), citations, grounding: "explicit" };
}
