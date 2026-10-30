// Pure projection of the registered, evidence-checked result. No providers,
// executable layout, independent extraction, or inferred plan attribution.
import type {
  RegisteredCellValue,
  RegisteredComparisonTable as Table,
  Qualifiers,
} from "@/app/lib/extraction/types";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import { sourcedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import {
  eligibilityMissingField,
  ELIGIBILITY_ROW_NAME,
  deriveInterpretations,
  type Interpretation,
} from "@/app/lib/extraction/eligibility";
import { VARIES_BY_AGE } from "@/app/lib/extraction/premium";

export interface ActiveView {
  mode: "understand" | "compare";
  documentId?: string;
  planIds: string[];
  tiers: Record<string, string | null>;
}
export type ComponentType =
  | "finding"
  | "key-value-group"
  | "comparison-table"
  | "evidence-disclosure"
  | "unresolved-questions"
  | "contact-details";
export type FactState =
  | "verified-plan"
  | "unverified-applicability"
  | "needs-verification"
  | "conflicting-evidence";
export interface PresentationFact {
  id: string;
  concept: string;
  label: string;
  value: RegisteredCellValue;
  scope: { documentIds: string[]; planIds: string[]; tier: string | null };
  state: FactState;
  qualifiers: Qualifiers;
  interpretations: Interpretation[];
}
export interface PresentationBlock {
  type: ComponentType;
  heading: string;
  purpose: string;
  factIds: string[];
  scope: ActiveView;
  uncertainty: FactState[];
  qualifiers: { factId: string; values: Qualifiers }[];
  interpretations: { factId: string; values: Interpretation[] }[];
  evidence: { factId: string; evidenceIds: string[] }[];
  priority: number;
  display: {
    expanded: boolean;
    maxVisible: number;
    unit?: string;
    questions?: ContextQuestion[];
  };
}
export interface PresentationSpec {
  schemaVersion: "adaptive-v1";
  scope: ActiveView;
  blocks: PresentationBlock[];
}
export interface ContextQuestion {
  concept: string;
  label: string;
  field: string;
}

export function contextQuestions(
  table: Table,
  view: ActiveView,
  context: Record<string, string>,
): ContextQuestion[] {
  const documents = new Set(viewDocumentIds(table, view));
  return table.rows.flatMap((row) => {
    if (
      (row.verdict !== "NEEDS VERIFICATION" && !(row.factName === ELIGIBILITY_ROW_NAME && row.verdict === "NOT STATED")) ||
      (row.values.length &&
        !row.values.some(
          (v) =>
            documents.has(v.documentId) &&
            (!v.planId || view.planIds.includes(v.planId)) &&
            tierMatches(v, view),
        ))
    )
      return [];
    const field =
      row.factName === ELIGIBILITY_ROW_NAME
        ? eligibilityMissingField(row, context)
        : row.factName === "premium" && row.rationale === VARIES_BY_AGE
          ? "age"
          : FACTS.find((f) => f.name === row.factName)?.contextField;
    return field && !context[field]?.trim()
      ? [{ concept: row.factName, label: title(row.factName), field }]
      : [];
  });
}
const PURPOSE: Record<ComponentType, string> = {
  finding: "Prioritize a source-backed point without changing its conditions.",
  "key-value-group": "Read related documented facts together.",
  "comparison-table":
    "Compare the same normalized concepts across selected proven plans.",
  "evidence-disclosure":
    "Keep document evidence distinct from confirmed plan benefits.",
  "unresolved-questions":
    "Expose uncertainty and questions for verification, not invented answers.",
  "contact-details":
    "Show only source-backed contact details in active-view order.",
};
const LABELS = new Map(FACTS.map((fact) => [fact.name, fact.label]));
const title = (name: string) =>
  LABELS.get(name) ??
  name.replace(/[-_]+/g, " ").replace(/^./, (s) => s.toUpperCase());

function tierMatches(value: RegisteredCellValue, view: ActiveView): boolean {
  const selected = value.planId
    ? view.tiers[value.planId]
    : view.mode === "understand" && view.planIds.length === 1
      ? view.tiers[view.planIds[0]]
      : view.documentId
        ? view.tiers[view.documentId]
        : null;
  return (
    !selected ||
    !value.qualifiers.planTier ||
    selected.trim().toLowerCase() ===
      value.qualifiers.planTier.trim().toLowerCase()
  );
}
export function viewDocumentIds(table: Table, view: ActiveView): string[] {
  if (view.mode === "understand")
    return table.documents.some((d) => d.documentId === view.documentId)
      ? [view.documentId!]
      : [];
  return [
    ...new Set(
      view.planIds
        .slice(0, 3)
        .flatMap(
          (id) =>
            table.plans
              ?.find((p) => p.planId === id)
              ?.sources.map((s) => s.documentId) ??
            (table.plans?.length
              ? []
              : table.documents
                  .filter((d) => d.documentId === id)
                  .map((d) => d.documentId)),
        ),
    ),
  ];
}

export function indexFacts(table: Table, view: ActiveView, context: Record<string, string> = {}): PresentationFact[] {
  const documents = new Set(viewDocumentIds(table, view));
  const facts: PresentationFact[] = [];
  for (const row of table.rows)
    row.values.forEach((value, index) => {
      if (
        !documents.has(value.documentId) ||
        !tierMatches(value, view) ||
        !value.display.trim()
      )
        return;
      const doc = table.documents.find(
        (d) => d.documentId === value.documentId,
      );
      if (
        !value.evidence.length ||
        value.evidence.some(
          (e) =>
            !e.evidenceId ||
            e.documentId !== value.documentId ||
            !Number.isInteger(e.page) ||
            e.page < 1 ||
            e.page > (doc?.pageCount ?? 0) ||
            !e.quote.trim(),
        )
      )
        return;
      const plan = table.plans?.find(
        (p) =>
          p.planId === value.planId &&
          p.sources.some((s) => s.documentId === value.documentId),
      );
      if (plan && !view.planIds.includes(plan.planId)) return;
      const peers = row.values.filter(
        (v) =>
          v.documentId === value.documentId &&
          v.planId === value.planId &&
          tierMatches(v, view),
      );
      const state: FactState = !plan
        ? "unverified-applicability"
        : hasSameScopeContradiction(peers)
          ? "conflicting-evidence"
          : row.verdict === "NEEDS VERIFICATION" ||
              row.verdict === "DOES NOT APPEAR TO FIT"
            ? "needs-verification"
            : "verified-plan";
      facts.push({
        id: [
          row.factName,
          value.documentId,
          value.planId ?? "document",
          String(index),
        ]
          .map(encodeURIComponent)
          .join(":"),
        concept: row.factName,
        label: title(row.factName),
        value,
        scope: {
          documentIds: [value.documentId],
          planIds: plan ? [plan.planId] : [],
          tier: value.qualifiers.planTier ?? null,
        },
        state,
        qualifiers: sourcedQualifiers(value),
        interpretations: deriveInterpretations([{ ...row, values: [value] }], context),
      });
    });
  return facts.sort((a, b) => {
    const rank = (f: PresentationFact) =>
      view.planIds.indexOf(f.scope.planIds[0] ?? f.value.documentId);
    return (rank(a) < 0 ? 99 : rank(a)) - (rank(b) < 0 ? 99 : rank(b));
  });
}

export function projectView(table: Table, view: ActiveView): Table {
  const ids = new Set(viewDocumentIds(table, view));
  const facts = indexFacts(table, view);
  const values = new Set(facts.map((f) => f.value));
  return {
    ...table,
    documents: table.documents.filter((d) => ids.has(d.documentId)),
    plans: table.plans
      ?.filter((p) => view.planIds.includes(p.planId))
      .map((p) => ({
        ...p,
        sources: p.sources.filter((s) => ids.has(s.documentId)),
      })),
    rows: table.rows
      .map((row) => ({
        ...row,
        values: row.values.filter((value) => values.has(value)),
      }))
      .filter((row) => row.values.length > 0),
  };
}

function makeBlock(
  type: ComponentType,
  heading: string,
  facts: PresentationFact[],
  view: ActiveView,
  priority: number,
  expanded = true,
  questions: ContextQuestion[] = [],
): PresentationBlock {
  return {
    type,
    heading,
    purpose: PURPOSE[type],
    factIds: facts.map((f) => f.id),
    scope: { ...view, planIds: [...view.planIds], tiers: { ...view.tiers } },
    uncertainty: [...new Set(facts.map((f) => f.state))],
    qualifiers: facts.map((f) => ({ factId: f.id, values: f.qualifiers })),
    interpretations: facts.map((f) => ({ factId: f.id, values: f.interpretations })),
    evidence: facts.map((f) => ({
      factId: f.id,
      evidenceIds: f.value.evidence.map((e) => e.evidenceId),
    })),
    priority,
    display: {
      expanded,
      maxVisible: type === "finding" ? 3 : 6,
      ...(questions.length ? { questions } : {}),
    },
  };
}
function impact(f: PresentationFact, context: Record<string, string>): number {
  if (f.interpretations.some((i) => i.kind === "potential-conflict")) return 99;
  if (f.state === "conflicting-evidence") return 100;
  if (/eligib|residen|geograph|age-limit/.test(f.concept))
    return 90 + (context.age || context.visaOrStatus ? 2 : 0);
  if (/exclu|pre-existing|restrict|waiting/.test(f.concept)) return 85;
  if (/premium|deductible|coinsurance|maximum|limit/.test(f.concept)) return 80;
  return 50;
}
function deterministic(
  table: Table,
  view: ActiveView,
  context: Record<string, string>,
): PresentationSpec {
  const facts = indexFacts(table, view, context),
    confirmed = facts.filter((f) => f.state !== "unverified-applicability"),
    unassigned = facts.filter((f) => f.state === "unverified-applicability");
  const blocks: PresentationBlock[] = [];
  const seen = new Set<string>();
  const readable = view.mode === "understand" ? facts : confirmed;
  const highlights = [...facts]
    .sort((a, b) => impact(b, context) - impact(a, context))
    .filter((f) => {
      if (seen.has(f.concept)) return false;
      seen.add(f.concept);
      return true;
    })
    .slice(0, 3);
  if (highlights.length)
    blocks.push(
      makeBlock("finding", "The main things to check", highlights, view, 100),
    );
  if (view.mode === "compare" && confirmed.length)
    blocks.push(
      makeBlock(
        "comparison-table",
        "Compare your policies",
        confirmed,
        view,
        80,
      ),
    );
  if (view.mode === "understand") {
    const rows = projectView(table, view).rows;
    const suggested = table.presentationGroups
      ? sanitizeGroups({ groups: table.presentationGroups }, rows)
      : [];
    const topics = new Map<string, string[]>();
    for (const f of readable) {
      const heading =
        suggested.find((g) => g.factNames.includes(f.concept))?.title ??
        (/eligib|residen|geograph|age-limit|visa|student|enroll/.test(f.concept)
          ? "Conditions and eligibility"
          : /premium|deductible|coinsurance|copay|out-of-pocket/.test(f.concept)
            ? "Costs and choices"
            : /exclu|restrict|waiting|limit|pre-existing|maximum/.test(
                  f.concept,
                )
              ? "Limits and exclusions"
              : /care|benefit|service|hospital|emergency|prescription|dental|vision|mental/.test(
                    f.concept,
                  )
                ? "Coverage and services"
                : "More about this policy");
      topics.set(heading, [...(topics.get(heading) ?? []), f.concept]);
    }
    const groups = [...topics].map(([title, factNames]) => ({
      title,
      factNames,
    }));
    for (const group of groups) {
      const related = readable.filter((f) =>
        group.factNames.includes(f.concept),
      );
      if (related.length)
        blocks.push(
          makeBlock("key-value-group", group.title, related, view, 80),
        );
    }
  }
  if (unassigned.length && view.mode === "compare")
    blocks.push(
      makeBlock(
        "evidence-disclosure",
        "Document evidence — applicability needs verification",
        unassigned,
        view,
        50,
        false,
      ),
    );
  const questions = contextQuestions(table, view, context);
  if (!facts.length || questions.length)
    blocks.push(
      makeBlock(
        "unresolved-questions",
        "Questions still open",
        [],
        view,
        40,
        true,
        questions,
      ),
    );
  blocks.push(
    makeBlock(
      "contact-details",
      "Contact and policy information",
      [],
      view,
      10,
    ),
  );
  return {
    schemaVersion: "adaptive-v1",
    scope: { ...view, planIds: [...view.planIds], tiers: { ...view.tiers } },
    blocks: blocks.sort((a, b) => b.priority - a.priority),
  };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Fail closed: callers can select/rank approved blocks and fact references,
 * but cannot supply insurance prose, values, evidence, scope or display markup. */
export function validatePresentation(
  proposal: unknown,
  table: Table,
  view: ActiveView,
  context: Record<string, string>,
): PresentationSpec | null {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal))
    return null;
  const p = proposal as Record<string, unknown>;
  if (
    Object.keys(p).some(
      (k) => !["schemaVersion", "scope", "blocks"].includes(k),
    ) ||
    p.schemaVersion !== "adaptive-v1" ||
    stable(p.scope) !== stable(view) ||
    !Array.isArray(p.blocks) ||
    p.blocks.length < 1 ||
    p.blocks.length > 32
  )
    return null;
  const facts = indexFacts(table, view, context),
    byId = new Map(facts.map((f) => [f.id, f]));
  const headings = new Set(
    deterministic(table, view, context).blocks.map((b) => b.heading),
  );
  const blocks: PresentationBlock[] = [];
  for (const candidate of p.blocks) {
    if (!candidate || typeof candidate !== "object") return null;
    const b = candidate as PresentationBlock;
    if (
      !Object.prototype.hasOwnProperty.call(PURPOSE, b.type) ||
      !headings.has(b.heading) ||
      !Array.isArray(b.factIds) ||
      new Set(b.factIds).size !== b.factIds.length ||
      b.factIds.some((id) => !byId.has(id)) ||
      !Number.isInteger(b.priority) ||
      b.priority < 0 ||
      b.priority > 100 ||
      typeof b.display?.expanded !== "boolean"
    )
      return null;
    const selected = b.factIds.map((id) => byId.get(id)!);
    if (
      (view.mode === "compare" && b.type === "key-value-group") ||
      (b.type === "evidence-disclosure" &&
        selected.some((fact) => fact.state !== "unverified-applicability"))
    )
      return null;
    const documentReading =
      b.type === "finding" ||
      (view.mode === "understand" && b.type === "key-value-group");
    if (
      [
        "finding",
        "key-value-group",
        "comparison-table",
      ].includes(b.type) &&
      (!selected.length ||
        (!documentReading &&
          selected.some((f) => f.state === "unverified-applicability")))
    )
      return null;
    const canonical = makeBlock(
      b.type,
      b.heading,
      selected,
      view,
      b.priority,
      b.display.expanded,
      b.type === "unresolved-questions"
        ? contextQuestions(table, view, context)
        : [],
    );
    if (stable(b) !== stable(canonical)) return null;
    blocks.push(canonical);
  }
  const count = (type: ComponentType) =>
    blocks.filter((block) => block.type === type).length;
  if (
    count("finding") > 1 ||
    count("comparison-table") > 1 ||
    count("evidence-disclosure") > 1 ||
    count("unresolved-questions") > 1 ||
    count("contact-details") > 1 ||
    blocks.some(
      (block) =>
        (block.type === "finding" && block.factIds.length > 3) ||
        (block.type === "unresolved-questions" && block.factIds.length > 0),
    )
  )
    return null;
  if (view.mode === "compare") {
    const confirmedFactIds = new Set(
      facts
        .filter((fact) => fact.state !== "unverified-applicability")
        .map((fact) => fact.id),
    );
    const comparison = blocks.find(
      (block) => block.type === "comparison-table",
    );
    if (
      confirmedFactIds.size > 0 &&
      (!comparison ||
        comparison.factIds.length !== confirmedFactIds.size ||
        comparison.factIds.some((id) => !confirmedFactIds.has(id)))
    )
      return null;
  }
  // Optional proposals cannot silently discard material facts/uncertainty.
  const retained = new Set(
    blocks.filter((b) => b.type !== "finding").flatMap((b) => b.factIds),
  );
  if (facts.some((f) => !retained.has(f.id))) return null;
  if (
    contextQuestions(table, view, context).length &&
    !blocks.some((b) => b.type === "unresolved-questions")
  )
    return null;
  return {
    schemaVersion: "adaptive-v1",
    scope: { ...view },
    blocks: blocks.sort((a, b) => b.priority - a.priority),
  };
}
export function buildPresentation(
  table: Table,
  view: ActiveView,
  context: Record<string, string>,
  proposal?: unknown,
): PresentationSpec {
  return (
    (proposal ? validatePresentation(proposal, table, view, context) : null) ??
    deterministic(table, view, context)
  );
}
