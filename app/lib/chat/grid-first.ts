// Grid-first chat (owner decision 2026-11-21; M9 "grid-first answers"
// pulled forward). A question that names one fact concept is answered from
// the session's RE-VERIFIED comparison facts — their verbatim claims,
// conditions and citations — never from retrieval or a model's reading.
// The model may only rephrase those facts; a rephrase is used only when it
// passes verifyAnswerClaims against exactly the facts' own citations, and on
// any failure (including a provider error) the exact wording is shown.
// Anything else (no concept, no supported in-scope value, an uncertain row)
// returns undefined and the caller takes the retrieval + model path.
//
// Pure: reads only the table and documents passed in. The caller supplies a
// table re-derived under the current request (read-back.ts), so a row
// altered after issue is already "cannot be confirmed" and has no values.

import type { CellValue, TableRow } from "@/app/lib/extraction/types";
import { describeFact } from "@/app/lib/presentation/claim";
import { scopingMarkers, statesScopingMarker, verifyAnswerClaims, verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import type { ChatCitation, ChatResponse } from "@/app/lib/rag/answer";

/** One fact concept a question can name. Health-domain terms only; no
 *  insurer- or document-specific wording. Ordered: the first match wins, so
 *  specific cost terms come before broad ones ("network"). */
export interface FactConcept {
  id: string;
  question: RegExp;
  facts: readonly string[];
}

export const FACT_CONCEPTS: readonly FactConcept[] = [
  { id: "out-of-pocket", question: /\bout[- ]of[- ]pocket\b/i, facts: ["out-of-pocket-maximum"] },
  { id: "deductible", question: /\bdeductibles?\b/i, facts: ["annual-deductible", "per-illness-deductible"] },
  { id: "coinsurance", question: /\bcoinsurance\b|\bcost[- ]shar/i, facts: ["coinsurance"] },
  { id: "premium", question: /\bpremiums?\b|\bhow much (?:does|is) (?:the|this|my) (?:plan|policy|insurance) cost\b/i, facts: ["premium"] },
  { id: "overall-limit", question: /\b(?:annual|overall|lifetime|aggregate|policy|plan)\s+(?:maximum|max|limit)\b|\bmaximum (?:coverage|benefit)\b|\bpolicy limit\b|\bcoverage (?:maximum|limit)\b/i, facts: ["policy-limit"] },
  { id: "emergency-room", question: /\bemergency (?:room|department)\b|\bER\b/, facts: ["emergency-care"] },
  { id: "urgent-care", question: /\burgent care\b|\bwalk[- ]in\b/i, facts: ["urgent-care"] },
  { id: "pre-existing", question: /\bpre-?existing\b/i, facts: ["pre-existing-conditions"] },
  { id: "maternity", question: /\bmaternity\b|\bpregnan/i, facts: ["maternity-coverage"] },
  { id: "prescriptions", question: /\bprescriptions?\b|\bmedications?\b|\bdrugs?\b/i, facts: ["prescriptions"] },
  { id: "mental-health", question: /\bmental health\b|\bbehaviou?ral health\b|\btherapy sessions?\b/i, facts: ["mental-health"] },
  { id: "dental", question: /\bdental\b|\bdentist\b/i, facts: ["dental-coverage"] },
  { id: "vision", question: /\bvision\b|\beye ?(?:glasses|exams?)\b/i, facts: ["vision-coverage"] },
  { id: "ambulance", question: /\bambulance\b/i, facts: ["ambulance"] },
  { id: "evacuation", question: /\b(?:medical )?evacuation\b/i, facts: ["emergency-evacuation"] },
  { id: "repatriation", question: /\brepatriation\b|\breturn of (?:mortal )?remains\b/i, facts: ["repatriation"] },
  { id: "waiting-period", question: /\bwaiting periods?\b/i, facts: ["waiting-period"] },
  { id: "claims-deadline", question: /\b(?:file|submit) (?:a )?claims?\b|\bclaims? (?:deadline|filing)\b/i, facts: ["claims-filing-deadline"] },
  { id: "telehealth", question: /\btele(?:health|medicine)\b|\bvirtual (?:visit|care)\b/i, facts: ["telehealth"] },
  { id: "physical-therapy", question: /\bphysical therapy\b|\bphysiotherapy\b/i, facts: ["physical-therapy"] },
  { id: "specialist", question: /\bspecialists?\b/i, facts: ["specialist-visit"] },
  { id: "primary-care", question: /\bprimary care\b|\bdoctor'?s? visit\b|\boffice visit\b/i, facts: ["primary-care-visit"] },
];

/** The one concept a question names, or undefined when it names none or
 *  more than one (review B4: "dental deductible", "does the deductible
 *  apply to ER visits" are different questions from "the deductible"). The
 *  out-of-pocket concept also names "maximum"; it is not counted twice. */
export function conceptForQuestion(question: string): FactConcept | undefined {
  const hits = FACT_CONCEPTS.filter((c) => c.question.test(question));
  const distinct = hits.filter((c) => !(c.id === "overall-limit" && hits.some((h) => h.id === "out-of-pocket")));
  return distinct.length === 1 ? distinct[0] : undefined;
}

/** The chat selection: selected plan ids (legacy: document ids) and the
 *  tier chosen per plan (null/absent = all tiers). */
export interface GridSelection {
  planIds: readonly string[];
  tiers: Readonly<Record<string, string | null>>;
}

/** Review B2: a value is used only when it belongs to the selection — its
 *  plan (or, unattributed on a legacy table, its document) is selected and
 *  its tier, when it has one, is the tier chosen for that plan. */
function inSelection(value: CellValue, selection: GridSelection | undefined, plans: readonly { planId: string; sources: readonly { documentId: string }[] }[]): boolean {
  if (!selection) return true;
  // An unattributed value belongs to a plan only when its document is the
  // source of exactly one plan (a single-plan document); on a legacy table
  // without plans the selection names documents. Mixed documents fail closed.
  const owners = plans.filter((p) => p.sources.some((s) => s.documentId === value.documentId)).map((p) => p.planId);
  const owner = value.planId ?? (plans.length === 0 ? value.documentId : owners.length === 1 ? owners[0] : undefined);
  if (!owner || !selection.planIds.includes(owner)) return false;
  const tier = selection.tiers[owner];
  return !tier || !value.qualifiers.planTier || value.qualifiers.planTier === tier;
}

interface Doc {
  documentId: string;
  pageCount: number;
  pages: string[];
}

export interface GridFacts {
  /** The verbatim lines that answer the question, in table order. */
  lines: string[];
  /** Every citation those lines depend on (verified, canonical). */
  citations: ChatCitation[];
}

/** Optional model rephrase of the verified facts. */
export type Rephrase = (facts: GridFacts, question: string) => Promise<{ answerText: unknown; citations: unknown }>;

const UNCERTAIN_VERDICTS = new Set(["NEEDS VERIFICATION", "CONFLICTED"]);

/** Lines for one value: its claim (or full verbatim display), each verbatim
 *  condition, and any further cited line the display does not contain (a
 *  footnote that decides its basis). */
function valueLines(value: CellValue, factName: string): string[] {
  const d = describeFact(value, factName);
  const head = d.claim ?? d.sourceWording;
  // A further cited line (a footnote deciding the basis) is shown only when
  // it states no figure of its own (review S6: never a second amount that
  // reads as part of the answer).
  const extra = value.evidence.slice(1).map((e) => e.quote).filter((q) => !value.display.includes(q) && !/\d/.test(q.replace(/^\s*\d{1,2}\s+/, "")));
  return [head, ...d.conditions, ...extra];
}

function verifiedInScope(value: CellValue, scoped: Doc[], session: Doc[]): ChatCitation[] | undefined {
  const out: ChatCitation[] = [];
  for (const e of value.evidence) {
    const inSession = verifyEvidenceCitation(session, e);
    const inScope = verifyEvidenceCitation(scoped, e);
    if (!inSession.ok || !inScope.ok) return undefined;
    out.push({ documentId: e.documentId, page: e.page, quote: inSession.quote });
  }
  return out.length ? out : undefined;
}

export async function gridFirstAnswer(input: {
  question: string;
  table: { rows: readonly TableRow[]; plans?: readonly { planId: string; sources: readonly { documentId: string }[] }[] };
  scopedDocuments: Doc[];
  sessionDocuments: Doc[];
  selection?: GridSelection;
  rephrase?: Rephrase;
}): Promise<Extract<ChatResponse, { kind: "answer" }> | undefined> {
  const concept = conceptForQuestion(input.question);
  if (!concept) return undefined;
  const rows = input.table.rows.filter((r) => concept.facts.includes(r.factName));
  // Uncertainty is never hidden behind a confident answer: an uncertain row,
  // or withheld source lines for the concept (review S5), fall back.
  if (rows.some((r) => (UNCERTAIN_VERDICTS.has(r.verdict) && r.values.length > 0) || (r.withheld?.length ?? 0) > 0)) return undefined;

  const used: { value: CellValue; factName: string; cites: ChatCitation[] }[] = [];
  for (const row of rows) {
    if (row.verdict !== "SUPPORTED") continue;
    for (const value of row.values) {
      if (!inSelection(value, input.selection, input.table.plans ?? [])) continue;
      const cites = verifiedInScope(value, input.scopedDocuments, input.sessionDocuments);
      if (cites) used.push({ value, factName: row.factName, cites });
    }
  }
  // Review B3: values of more than one plan, document or tier would need a
  // per-plan label the claim verifier cannot check — fall back instead.
  const groups = new Set(used.map(({ value }) => `${value.documentId}|${value.planId ?? ""}|${value.qualifiers.planTier ?? ""}`));
  if (groups.size > 1) return undefined;
  // Review S7: values that differ by age band need the user's context.
  if (new Set(used.map(({ value }) => value.qualifiers.ageBand ?? "")).size > 1) return undefined;
  // Review S5: an unconfirmed claim is never shown as an answer.
  if (used.some(({ value, factName }) => describeFact(value, factName).status === "unconfirmed")) return undefined;

  const lines: string[] = [];
  const citations: ChatCitation[] = [];
  for (const { value, factName, cites } of used) {
    {
      const row = { factName };
      for (const line of valueLines(value, row.factName)) if (!lines.includes(line)) lines.push(line);
      for (const c of cites) if (!citations.some((x) => x.documentId === c.documentId && x.page === c.page && x.quote === c.quote)) citations.push(c);
    }
  }
  if (lines.length === 0) return undefined;

  const verbatim = lines.join("\n");
  const sessionDocs = input.sessionDocuments.map((d) => ({ documentId: d.documentId, pages: d.pages }));
  // The verbatim answer itself must pass the same gate as any answer.
  if (!verifyAnswerClaims(verbatim, citations, citations, sessionDocs).ok) return undefined;
  const answer = (answerText: string, cites: ChatCitation[]) => ({
    schemaVersion: "v1" as const,
    kind: "answer" as const,
    answerText,
    citations: cites,
    grounding: "explicit" as const,
  });
  if (!input.rephrase) return answer(verbatim, citations);

  try {
    const r = await input.rephrase({ lines: [...lines], citations: citations.map((c) => ({ ...c })) }, input.question);
    const text = typeof r.answerText === "string" ? r.answerText.trim() : "";
    const cites = Array.isArray(r.citations) ? (r.citations as ChatCitation[]) : [];
    // Only the facts' own citations may be cited, and the rephrase must pass
    // verifyAnswerClaims against them; otherwise the exact wording stands.
    const own = cites.every((c) => citations.some((x) => x.documentId === c?.documentId && x.page === c?.page && x.quote === c?.quote));
    // Review B1: a rephrase keeps every condition verbatim and states exactly
    // the facts' negation/exception/network markers.
    const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
    const conditions = used.flatMap(({ value, factName }) => describeFact(value, factName).conditions);
    const parenthetical = lines.flatMap((l) => l.match(/\([^()]+\)/g) ?? []);
    const keepsConditions = [...conditions, ...parenthetical].every((c) => norm(text).includes(norm(c)));
    const sameMarkers = statesScopingMarker(text) === statesScopingMarker(verbatim) && scopingMarkers(text) === scopingMarkers(verbatim);
    if (text && cites.length > 0 && own && keepsConditions && sameMarkers && verifyAnswerClaims(text, cites, citations, sessionDocs).ok) {
      return answer(text, cites);
    }
    console.warn(`[chat-grid] rephrase=rejected concept=${concept.id}`);
  } catch {
    console.warn(`[chat-grid] rephrase=failed concept=${concept.id}`);
  }
  return answer(verbatim, citations);
}
