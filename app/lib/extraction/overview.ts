// Pure, evidence-linked personalized overview builder (V1.1 M3 tasks 9–12).
// Derives My Fit, My Costs, documented upsides, potential conflicts and
// important unknowns from validated facts, user context and the current
// effective selection. Never invents policy facts or guarantees eligibility.
import type {
  ComparisonTable,
  RegisteredCellValue,
  RegisteredComparisonTable,
  RegisteredTableRow,
} from "@/app/lib/extraction/types";
import { ELIGIBILITY_ROW_NAME, deriveInterpretations, type Interpretation } from "@/app/lib/extraction/eligibility";
import { SECTIONS } from "@/app/lib/extraction/sections";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { conditionBindingKnown, moneyAmounts } from "@/app/lib/extraction/conditions";
import { sourcedQualifiers } from "@/app/lib/extraction/qualifier-evidence";

export type OverviewSection = "My Fit" | "My Costs" | "Coverage" | "Limits & Risks" | "Evidence & Actions";

export interface OverviewEvidence {
  documentId: string;
  filename: string;
  page: number;
  quote: string;
  evidenceId: string;
}

export interface OverviewItem {
  id: string;
  section: OverviewSection;
  kind: "fit" | "cost" | "upside" | "conflict" | "unknown" | "unknown-group";
  label: string;
  value?: string;
  statement?: string;
  planName?: string;
  evidence: OverviewEvidence[];
  context?: { field: string; value: string }[];
  action?: string;
  /** Compact condition/explanation tags (e.g. network scope, age band, unresolved). */
  notes?: string[];
  /** Consolidated per-fact details for grouped unknown/missing-data summaries. */
  details?: OverviewItem[];
}

export interface PersonalizedOverview {
  headline: string;
  status: "review" | "unknown" | "verified";
  selectedPlans: string[];
  items: OverviewItem[];
  /** At most three high-impact, distinct findings surfaced initially. */
  initialItems: OverviewItem[];
  /** Expandable lower-priority or duplicate items, preserving full evidence. */
  remainder: OverviewItem[];
}

export interface OverviewScope {
  /** A proven plan id, or undefined to include plan-unassigned values only. */
  planId?: string;
  /** null means All tiers; undefined means no tier filter. */
  tier?: string | null;
}

const LABELS = new Map(FACTS.map((f) => [f.name, f.label]));
const labelFor = (factName: string): string =>
  LABELS.get(factName) ?? (factName === ELIGIBILITY_ROW_NAME ? "Personal eligibility" : factName);

/** Build a stable, collision-resistant id from the pieces that identify an item.
 *  Any undefined/null piece is rendered as "-" so the key remains deterministic. */
function stableId(...parts: (string | number | undefined | null)[]): string {
  return parts.map((p) => (p === undefined || p === null ? "-" : String(p))).join("--");
}

const KEY_FACTS = [
  "premium",
  "annual-deductible",
  "out-of-pocket-maximum",
  "coinsurance",
  "network",
  "emergency-care",
  ELIGIBILITY_ROW_NAME,
];

const UPSIDE_SECTIONS = new Set(["Coverage"]);

function tierKey(tier: string): string {
  return tier.trim().toLowerCase();
}

function matchesScope(value: RegisteredCellValue, scope: OverviewScope): boolean {
  if (scope.planId !== undefined && value.planId !== undefined && value.planId !== scope.planId) return false;
  if (scope.planId !== undefined && value.planId === undefined) return false;
  if (scope.tier !== undefined && scope.tier !== null) {
    const own = value.qualifiers.planTier?.trim();
    if (own && tierKey(own) !== tierKey(scope.tier)) return false;
  }
  return true;
}

function evidenceFor(
  table: RegisteredComparisonTable,
  value: RegisteredCellValue,
): OverviewEvidence[] {
  return value.evidence.map((e) => ({
    documentId: e.documentId,
    filename: table.documents.find((d) => d.documentId === e.documentId)?.filename ?? e.documentId,
    page: e.page,
    quote: e.quote,
    evidenceId: e.evidenceId ?? "",
  }));
}

function flattenValues(row: RegisteredTableRow, scopes: OverviewScope[]): RegisteredCellValue[] {
  const out: RegisteredCellValue[] = [];
  for (const scope of scopes) {
    for (const value of row.values) {
      if (matchesScope(value, scope) && !out.some((v) => v === value)) out.push(value);
    }
  }
  return out;
}

function selectionNote(value: RegisteredCellValue): string | undefined {
  const status = value.qualifiers.selectionStatus;
  if (status === "selectable") return "options; actual selection unknown";
  if (status === "purchased") return "selected option";
  return undefined;
}

function valueDisplay(value: RegisteredCellValue): string {
  const note = selectionNote(value);
  return note ? `${value.display} (${note})` : value.display;
}

function planName(table: RegisteredComparisonTable, planId?: string): string | undefined {
  if (!planId) return undefined;
  return table.plans?.find((p) => p.planId === planId)?.name;
}

function ageBandMatches(q: { ageBand?: string; ageMin?: number; ageMax?: number }, ageText?: string): boolean {
  const raw = (ageText ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return false;
  const age = Number(raw);
  if (typeof q.ageMin === "number" && typeof q.ageMax === "number") {
    return age >= q.ageMin && age <= q.ageMax;
  }
  const band = (q.ageBand ?? "").trim();
  const range = /^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/.exec(band);
  if (range) return age >= Number(range[1]) && age <= Number(range[2]);
  return band === raw;
}

/** Compact, source-bound condition notes for a financial or coverage value.
 *  Mirrors the rules in ConditionalValue so the overview and table agree. */
function compactNotes(value: RegisteredCellValue, userAge?: string): string[] {
  const q = sourcedQualifiers(value);
  const notes: string[] = [];
  const statedInDisplay = (raw: string) => value.display.toLowerCase().includes(raw.toLowerCase());

  if (q.networkTier && !statedInDisplay(q.networkTier) && !q.networkTier.includes("$")) {
    notes.push(`Network: ${q.networkTier}`);
  }
  if (q.planTier && !statedInDisplay(q.planTier)) {
    notes.push(`Tier: ${q.planTier}`);
  }
  if (q.ageBand && !statedInDisplay(q.ageBand) && (/[a-z]/i.test(q.ageBand) || /[-–—]/.test(q.ageBand))) {
    const match = ageBandMatches(q, userAge);
    notes.push(match ? `Ages: ${q.ageBand} · matches your age ${userAge!.trim()}` : `Ages: ${q.ageBand}`);
  }
  if (q.period && !statedInDisplay(q.period)) notes.push(q.period);
  if (q.frequency && !statedInDisplay(q.frequency)) notes.push(`Billed ${q.frequency}`);
  if (q.currency && !statedInDisplay(q.currency)) notes.push(`Currency: ${q.currency}`);
  if (q.costType && !statedInDisplay(q.costType)) notes.push(q.costType);
  if (q.conditions) notes.push(q.conditions);
  if (q.selectionStatus === "purchased") {
    notes.push("Purchased option stated by the source.");
  }
  if (moneyAmounts(value.display) >= 2 && !conditionBindingKnown(value)) {
    notes.push("Unresolved: which amount applies? Confirm the applicable figure against the source page.");
  }
  return notes;
}

function buildKeyFactItems(
  table: RegisteredComparisonTable,
  scopes: OverviewScope[],
  userAge?: string,
): OverviewItem[] {
  const items: OverviewItem[] = [];
  let index = 0;
  let premiumSeen = false;
  for (const factName of KEY_FACTS) {
    const row = table.rows.find((r) => r.factName === factName);
    if (!row) continue;
    if (factName === "premium") premiumSeen = true;
    const values = flattenValues(row, scopes);
    if (values.length === 0) {
      if (row.verdict === "NOT STATED") {
        items.push({
          id: stableId("fact", factName, "missing", index++),
          section: factName === ELIGIBILITY_ROW_NAME ? "My Fit" : "My Costs",
          kind: factName === ELIGIBILITY_ROW_NAME ? "fit" : "cost",
          label: labelFor(factName),
          value: "Not stated in the uploaded brochure",
          evidence: [],
        });
      }
      continue;
    }
    for (const value of values) {
      items.push({
        id: stableId(
          "fact",
          factName,
          value.documentId,
          value.planId ?? "shared",
          value.qualifiers.planTier ?? "all",
          value.evidence[0]?.evidenceId ?? "no-evidence",
          index++,
        ),
        section: factName === ELIGIBILITY_ROW_NAME ? "My Fit" : "My Costs",
        kind: factName === ELIGIBILITY_ROW_NAME ? "fit" : "cost",
        label: labelFor(factName),
        value: valueDisplay(value),
        planName: planName(table, value.planId),
        evidence: evidenceFor(table, value),
        notes: compactNotes(value, userAge),
      });
    }
  }
  if (!premiumSeen) {
    items.push({
      id: stableId("fact", "premium", "missing", index++),
      section: "My Costs",
      kind: "cost",
      label: labelFor("premium"),
      value: "Not stated in the uploaded brochure",
      evidence: [],
    });
  }
  return items;
}

function buildUpsideItems(
  table: RegisteredComparisonTable,
  scopes: OverviewScope[],
  userAge?: string,
): OverviewItem[] {
  const groups = SECTIONS.filter((s) => UPSIDE_SECTIONS.has(s.title));
  const factNames = new Set(groups.flatMap((s) => s.factNames));
  const items: OverviewItem[] = [];
  let index = 0;
  for (const row of table.rows) {
    if (!factNames.has(row.factName)) continue;
    if (row.verdict !== "SUPPORTED") continue;
    const values = flattenValues(row, scopes);
    for (const value of values) {
      items.push({
        id: stableId(
          "upside",
          row.factName,
          value.documentId,
          value.planId ?? "shared",
          value.qualifiers.planTier ?? "all",
          value.evidence[0]?.evidenceId ?? "no-evidence",
          index++,
        ),
        section: "Coverage",
        kind: "upside",
        label: labelFor(row.factName),
        value: valueDisplay(value),
        planName: planName(table, value.planId),
        evidence: evidenceFor(table, value),
        notes: compactNotes(value, userAge),
      });
    }
  }
  return items.slice(0, 5);
}

function findRegisteredEvidenceId(
  table: RegisteredComparisonTable,
  e: { documentId: string; page: number; quote: string },
): string {
  for (const row of table.rows) {
    for (const value of row.values) {
      for (const ev of value.evidence) {
        if (ev.documentId === e.documentId && ev.page === e.page && ev.quote === e.quote) {
          return ev.evidenceId;
        }
      }
    }
  }
  return "";
}

function evidenceFromInterpretation(
  table: RegisteredComparisonTable,
  interp: Interpretation,
): OverviewEvidence[] {
  return interp.evidence.map((e) => ({
    documentId: e.documentId,
    filename: table.documents.find((d) => d.documentId === e.documentId)?.filename ?? e.documentId,
    page: e.page,
    quote: e.quote,
    evidenceId: findRegisteredEvidenceId(table, e),
  }));
}

function sectionForRule(ruleId: string): OverviewSection {
  if (ruleId === "residence-coverage-mismatch" || ruleId === "eligibility-unconfirmed" || ruleId === "residence-not-supplied") return "My Fit";
  if (ruleId === "premium-not-stated" || ruleId === "premium-age-unknown") return "My Costs";
  return "Evidence & Actions";
}

function buildInterpretationItems(
  table: RegisteredComparisonTable,
  userContext: Record<string, string>,
): OverviewItem[] {
  const interps = deriveInterpretations(table.rows as unknown as ComparisonTable["rows"], userContext);
  const items: OverviewItem[] = [];
  let index = 0;
  for (const interp of interps) {
    const base: OverviewItem = {
      id: stableId(
        "interp",
        interp.ruleId,
        interp.kind,
        interp.evidence[0] ? findRegisteredEvidenceId(table, interp.evidence[0]) : "no-evidence",
        index++,
      ),
      section: sectionForRule(interp.ruleId),
      kind: interp.kind === "potential-conflict" ? "conflict" : "unknown",
      label: interp.kind === "potential-conflict" ? "Potential conflict" : "Important unknown",
      statement: interp.statement,
      context: interp.context,
      action: interp.question,
      evidence: evidenceFromInterpretation(table, interp),
    };
    items.push(base);
  }
  return items;
}

function buildScopes(table: RegisteredComparisonTable, selection?: OverviewScope[]): OverviewScope[] {
  if (selection && selection.length > 0) return selection;
  // No explicit selection: include every proven plan with no tier filter.
  const plans = table.plans ?? [];
  if (plans.length === 0) return [{}];
  return plans.map((p) => ({ planId: p.planId }));
}

const NOT_STATED_RE = /not stated/i;

function isUnknownLike(item: OverviewItem): boolean {
  if (item.kind === "unknown") return true;
  if (item.evidence.length > 0) return false;
  return NOT_STATED_RE.test(item.value ?? "");
}

function unknownKey(item: OverviewItem): string {
  return item.statement ?? item.value ?? item.label;
}

/** Group repeated unknown or not-stated messages into one expandable summary.
 *  Validated facts, evidence links and tier distinctions are preserved in
 *  `details`; they are simply deduplicated at the presentation layer. */
function consolidateUnknowns(items: OverviewItem[]): OverviewItem[] {
  const kept: OverviewItem[] = [];
  const groups = new Map<string, OverviewItem[]>();
  for (const item of items) {
    if (isUnknownLike(item)) {
      const key = unknownKey(item);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    } else {
      kept.push(item);
    }
  }
  const consolidated: OverviewItem[] = [];
  for (const [key, list] of groups) {
    if (list.length === 1) {
      consolidated.push(list[0]);
      continue;
    }
    const sortedIds = list.map((i) => i.id).sort();
    consolidated.push({
      id: stableId("unknown-group", sortedIds.join("|")),
      section: "Evidence & Actions",
      kind: "unknown-group",
      label: "Missing information",
      statement: key,
      evidence: [],
      details: list,
    });
  }
  return [...kept, ...consolidated];
}

const INSIGHT_PRIORITY: Record<OverviewItem["kind"], number> = {
  conflict: 3,
  cost: 2,
  upside: 1,
  fit: 0,
  unknown: 0,
  "unknown-group": 0,
};

const MAX_INITIAL_INSIGHTS = 3;

function insightPriority(item: OverviewItem): number {
  return INSIGHT_PRIORITY[item.kind] ?? 0;
}

/** Build a personalized overview for the supplied validated result, user context
 *  and optional selected plan/tier scopes. The result is pure and safe to
 *  derive on every render. */
export function buildOverview(
  table: RegisteredComparisonTable,
  userContext: Record<string, string>,
  selection?: OverviewScope[],
): PersonalizedOverview {
  const scopes = buildScopes(table, selection);
  const userAge = (userContext.age ?? "").trim() || undefined;
  const interpretations = deriveInterpretations(table.rows as unknown as ComparisonTable["rows"], userContext);
  const conflicts = interpretations.filter((i) => i.kind === "potential-conflict");
  const unknowns = interpretations.filter((i) => i.kind === "unresolved-question");

  let headline: string;
  let status: PersonalizedOverview["status"];
  if (conflicts.length > 0) {
    headline = "Review required — possible coverage applicability conflict";
    status = "review";
  } else if (unknowns.length > 0) {
    headline = "Review required — some important details are missing";
    status = "unknown";
  } else {
    headline = "Verified terms from your documents";
    status = "verified";
  }

  const selectedPlans = scopes
    .map((s) => (s.planId ? table.plans?.find((p) => p.planId === s.planId)?.name : undefined))
    .filter((name): name is string => !!name);

  const rawItems: OverviewItem[] = [
    ...buildInterpretationItems(table, userContext),
    ...buildKeyFactItems(table, scopes, userAge),
    ...buildUpsideItems(table, scopes, userAge),
  ];
  const items = consolidateUnknowns(rawItems);

  // C5: at most three distinct, evidence-grounded high-impact insights upfront,
  // prioritizing conflicts > costs > upsides. Remainder stays expandable.
  const ranked = [...items].sort((a, b) => insightPriority(b) - insightPriority(a));
  const initialItems = ranked.slice(0, MAX_INITIAL_INSIGHTS);
  const remainder = ranked.slice(MAX_INITIAL_INSIGHTS);

  return { headline, status, selectedPlans: [...new Set(selectedPlans)], items, initialItems, remainder };
}
