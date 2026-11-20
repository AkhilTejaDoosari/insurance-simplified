// Pure projection of the registered, evidence-checked result. No providers,
// executable layout, independent extraction, or inferred plan attribution.
import type {
  RegisteredCellValue,
  RegisteredComparisonTable as Table,
  Qualifiers,
} from "@/app/lib/extraction/types";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { absenceFor } from "@/app/lib/extraction/absence";
import {
  CANNOT_BE_CONFIRMED_RATIONALE,
  isCannotBeConfirmedRow,
} from "@/app/lib/evidence/row-resolution";
import { CANNOT_BE_CONFIRMED } from "@/app/lib/evidence/issued";
import { sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import { scopedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import {
  eligibilityMissingField,
  ELIGIBILITY_ROW_NAME,
  deriveInterpretations,
  type Interpretation,
} from "@/app/lib/extraction/eligibility";
import { VARIES_BY_AGE } from "@/app/lib/extraction/premium";
import {
  SURFACES_SCHEMA,
  type AuthorityView,
  type EvidenceSurfaces,
  type ExclusionInventoryView,
} from "@/app/lib/evidence/surface-types";
import { displayVerdictFor } from "@/app/lib/evidence/verdict-mapping";
import { VERDICTS, type Verdict } from "@/app/lib/verdicts";

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
        qualifiers: scopedQualifiers(value),
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
  // Unattributed document text (a PDF line, not a verified plan fact) only
  // fills the brief after verified facts of any concept: otherwise stray
  // lines ("Pursuing your education outside your home country?") outrank the
  // plan's own deductible and limits.
  const unverified = f.state === "unverified-applicability" ? 40 : 0;
  if (/eligib|residen|geograph|age-limit/.test(f.concept))
    return 90 + (context.age || context.visaOrStatus ? 2 : 0) - unverified;
  if (/exclu|pre-existing|restrict|waiting/.test(f.concept)) return 85 - unverified;
  if (/premium|deductible|coinsurance|maximum|limit/.test(f.concept)) return 80 - unverified;
  return 50 - unverified;
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

// ---- Trust notices (M7): issued-resolution failures and honest absence ----


export interface CannotBeConfirmedNotice {
  concept: string;
  label: string;
  /** Always the exact phrase "cannot be confirmed". */
  status: typeof CANNOT_BE_CONFIRMED;
  text: string;
}

const labelOf = (concept: string) => FACTS.find((f) => f.name === concept)?.label ?? concept;

/** Rows the render gate replaced because they could not be confirmed. Never
 *  shown with a value, and never as "No" / "Not covered". */
export function cannotBeConfirmedFacts(table: Pick<Table, "rows">): CannotBeConfirmedNotice[] {
  return table.rows
    .filter((row) => isCannotBeConfirmedRow(row))
    .map((row) => ({
      concept: row.factName,
      label: labelOf(row.factName),
      status: CANNOT_BE_CONFIRMED,
      text: CANNOT_BE_CONFIRMED_RATIONALE,
    }));
}

export interface ReadingCoverageNote {
  documentId: string;
  filename: string;
  pagesRead: number[];
  pagesNotRead: number[];
  pagesPartlyRead: number[];
}

/** Server-derived reading coverage per document (EC-10); empty on legacy
 *  results that carry none. */
export function readingCoverage(table: Pick<Table, "documents" | "coverage">): ReadingCoverageNote[] {
  return (table.coverage?.documents ?? []).flatMap((d) => {
    const doc = table.documents.find((x) => x.documentId === d.documentId);
    return doc ? [{ documentId: doc.documentId, filename: doc.filename, pagesRead: d.pagesRead, pagesNotRead: d.pagesNotRead, pagesPartlyRead: d.pagesPartlyRead }] : [];
  });
}

const pagesPhrase = (pages: readonly number[]) => `page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}`;

/** One sentence per document; never says "not covered". */
export function readingCoverageText(note: ReadingCoverageNote): string {
  const parts = [`${note.filename}: read ${note.pagesRead.length} page${note.pagesRead.length === 1 ? "" : "s"}`];
  if (note.pagesPartlyRead.length) parts.push(`partly read ${pagesPhrase(note.pagesPartlyRead)}`);
  if (note.pagesNotRead.length) parts.push(`could not read ${pagesPhrase(note.pagesNotRead)}`);
  return `${parts.join("; ")}.`;
}

export const NOT_FOUND_IN_PAGES_READ = "Not found in the pages read";

/** What a NOT STATED row says (EC-10, via `absenceFor`): "Not found in the
 *  pages read", naming pages that could not be read or were only partly
 *  read; or, when candidates were withheld, that a candidate could not be
 *  verified. Never "No" / "Not covered". Undefined on legacy results. */
export function absenceText(
  table: Pick<Table, "coverage" | "rows" | "documents">,
  factName: string,
  documentIds?: readonly string[],
): string | undefined {
  const absence = absenceFor(table, factName);
  if (!absence) return undefined;
  if (absence.reason === "candidates-withheld") {
    return "A possible source passage was found but could not be verified, so the value is not shown. Check the original document.";
  }
  const inScope = absence.documents.filter((d) => !documentIds || documentIds.includes(d.documentId));
  const nameOf = (id: string) => table.documents.find((d) => d.documentId === id)?.filename ?? "document";
  const gaps = inScope.flatMap((d) => [
    ...(d.pagesNotRead.length ? [`${nameOf(d.documentId)} ${pagesPhrase(d.pagesNotRead)} could not be read`] : []),
    ...(d.pagesPartlyRead.length ? [`${nameOf(d.documentId)} ${pagesPhrase(d.pagesPartlyRead)} ${d.pagesPartlyRead.length === 1 ? "was" : "were"} only partly read`] : []),
  ]);
  return gaps.length ? `${NOT_FOUND_IN_PAGES_READ} (${gaps.join("; ")}).` : `${NOT_FOUND_IN_PAGES_READ}.`;
}

export interface AbsenceNotice {
  concept: string;
  label: string;
  text: string;
}

/** Absence text for every NOT STATED row the result explains. */
export function absenceNotices(table: Pick<Table, "coverage" | "rows" | "documents">, documentIds?: readonly string[]): AbsenceNotice[] {
  return table.rows.flatMap((row) => {
    const text = row.verdict === "NOT STATED" ? absenceText(table, row.factName, documentIds) : undefined;
    return text ? [{ concept: row.factName, label: labelOf(row.factName), text }] : [];
  });
}

export interface WithheldNotice {
  concept: string;
  label: string;
  /** The row's verdict (NEEDS VERIFICATION when only withheld lines exist). */
  verdict: Table["rows"][number]["verdict"];
  documentId: string;
  page: number;
  /** Verified verbatim source line. */
  quote: string;
  evidenceId?: string;
}

/** Source lines that state a fact but were withheld: shown verbatim with a
 *  page link so the drop is visible — never as a value. */
export function withheldNotices(table: Pick<Table, "rows">): WithheldNotice[] {
  return table.rows.flatMap((row) =>
    (row.withheld ?? []).map((w) => {
      const evidenceId = (w as { evidenceId?: unknown }).evidenceId;
      return {
      concept: row.factName,
      label: labelOf(row.factName),
      verdict: row.verdict,
      documentId: w.documentId,
      page: w.page,
      quote: w.quote,
      ...(typeof evidenceId === "string" ? { evidenceId } : {}),
      };
    }),
  );
}

// ---- Evidence surfaces (M7): exclusion inventories and document authority ----
//
// Rendered EXACTLY as the producer issued them (surface-types.ts): nothing
// here builds, completes or edits a view. A view that is malformed is shown
// as "cannot be confirmed" with no values. An empty or incomplete exclusion
// list is never worded as "No exclusions", "Not covered", "Not excluded" or
// "Excluded" (EC-10, EC-13, evidence-core §3).

export const EXCLUSIONS_HEADING = "Exclusions read";
export const AUTHORITY_HEADING = "Which document governs";
export const NO_EXCLUSION_SECTION_FOUND = "An exclusion section was not found in the pages read.";

export interface SurfaceLink {
  documentId: string;
  filename: string;
  page: number;
  quote: string;
  evidenceId?: string;
}

export interface ExclusionInventoryDisplay {
  kind: "exclusion-inventory";
  documentId: string;
  filename: string;
  planId: string;
  planName: string;
  coverage: "complete" | "partial" | "unknown";
  /** Plain-words coverage state; always shown. */
  coverageText: string;
  /** Only for an empty list with complete coverage. */
  emptyText?: string;
  /** Verbatim claims, each with its page links. */
  items: { provisionId: string; claim: string; links: SurfaceLink[] }[];
}

export interface AuthorityDisplay {
  kind: "authority";
  scopeLabel: string;
  status: "resolved" | "conflict";
  verdict?: Verdict;
  /** Plain-words summary of who governs, or why it is CONFLICTED. */
  text: string;
  /** Plain-words reasons for a conflict (empty when resolved). */
  reasons: string[];
  relations: { text: string; links: SurfaceLink[] }[];
}

export interface SurfaceCannotBeConfirmedDisplay {
  kind: "cannot-be-confirmed";
  of: "exclusion-inventory" | "authority";
  status: typeof CANNOT_BE_CONFIRMED;
  text: string;
}

export type SurfaceDisplay = ExclusionInventoryDisplay | AuthorityDisplay | SurfaceCannotBeConfirmedDisplay;

export interface SurfacesDisplay {
  exclusions: (ExclusionInventoryDisplay | SurfaceCannotBeConfirmedDisplay)[];
  authority: (AuthorityDisplay | SurfaceCannotBeConfirmedDisplay)[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isPage = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;

/** The evidence-surfaces field carried by an extract response / table, or
 *  null when absent (legacy results) or of another schema. */
export function surfacesOf(holder: unknown): EvidenceSurfaces | null {
  const s = isObj(holder) ? holder.surfaces : undefined;
  if (!isObj(s) || s.schema !== SURFACES_SCHEMA || !Array.isArray(s.exclusions) || !Array.isArray(s.authority)) return null;
  return s as unknown as EvidenceSurfaces;
}

function cannotBeConfirmedDisplay(of: SurfaceCannotBeConfirmedDisplay["of"]): SurfaceCannotBeConfirmedDisplay {
  return {
    kind: "cannot-be-confirmed",
    of,
    status: CANNOT_BE_CONFIRMED,
    text:
      of === "exclusion-inventory"
        ? `This plan's exclusion list ${CANNOT_BE_CONFIRMED}, so it is not shown. Check the original document or re-run the comparison.`
        : `Which document governs ${CANNOT_BE_CONFIRMED}, so it is not shown. Check the original documents or re-run the comparison.`,
  };
}

function linksFor(table: Pick<Table, "documents">, evidence: unknown): SurfaceLink[] | null {
  if (!Array.isArray(evidence)) return null;
  const out: SurfaceLink[] = [];
  for (const e of evidence) {
    if (!isObj(e) || !isStr(e.documentId) || !isPage(e.page) || !isStr(e.quote) || !e.quote.trim()) return null;
    const doc = table.documents.find((d) => d.documentId === e.documentId);
    if (!doc || (e.page as number) > doc.pageCount) return null;
    out.push({
      documentId: e.documentId,
      filename: doc.filename,
      page: e.page as number,
      quote: e.quote,
      ...(isStr(e.evidenceId) ? { evidenceId: e.evidenceId } : {}),
    });
  }
  return out;
}

const pageList = (pages: readonly number[]) =>
  pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;

/** Plain-words reading state of one plan's exclusions. */
export function exclusionCoverageText(
  coverage: ExclusionInventoryView["coverage"],
  pagesNotRead: readonly number[],
  pageCount?: number,
): string {
  if (coverage === "complete")
    return pageCount ? `All ${pageCount} page${pageCount === 1 ? " was" : "s were"} read.` : "All pages were read.";
  if (pagesNotRead.length)
    return `${pageList(pagesNotRead)} could not be read fully — exclusions there may be missing.`;
  return coverage === "partial"
    ? "Some pages could not be read fully — exclusions there may be missing."
    : "It is not known whether every page was read — exclusions may be missing.";
}

function inventoryDisplay(
  table: Pick<Table, "documents">,
  view: unknown,
): ExclusionInventoryDisplay | SurfaceCannotBeConfirmedDisplay {
  if (!isObj(view) || view.kind !== "exclusion-inventory") return cannotBeConfirmedDisplay("exclusion-inventory");
  const doc = table.documents.find((d) => d.documentId === view.documentId);
  if (
    !doc ||
    !isStr(view.planId) ||
    !isStr(view.planName) ||
    !["complete", "partial", "unknown"].includes(view.coverage as string) ||
    !Array.isArray(view.pagesNotRead) ||
    !view.pagesNotRead.every(isPage) ||
    !Array.isArray(view.exclusions) ||
    // A "complete" reading that names unread pages contradicts itself.
    (view.coverage === "complete" && view.pagesNotRead.length > 0)
  )
    return cannotBeConfirmedDisplay("exclusion-inventory");
  const items: ExclusionInventoryDisplay["items"] = [];
  for (const x of view.exclusions) {
    const links = isObj(x) ? linksFor(table, x.evidence) : null;
    if (!isObj(x) || !isStr(x.provisionId) || !isStr(x.claim) || !x.claim.trim() || !links?.length)
      return cannotBeConfirmedDisplay("exclusion-inventory");
    items.push({ provisionId: x.provisionId, claim: x.claim, links });
  }
  const coverage = view.coverage as ExclusionInventoryDisplay["coverage"];
  const pagesNotRead = [...(view.pagesNotRead as number[])].sort((a, b) => a - b);
  return {
    kind: "exclusion-inventory",
    documentId: doc.documentId,
    filename: doc.filename,
    planId: view.planId,
    planName: view.planName,
    coverage,
    coverageText: exclusionCoverageText(coverage, pagesNotRead, doc.pageCount),
    ...(items.length === 0 && coverage === "complete" ? { emptyText: NO_EXCLUSION_SECTION_FOUND } : {}),
    items,
  };
}

const CONFLICT_REASON_TEXT: Readonly<Record<string, string>> = {
  identity: "the documents could not be shown to describe the same plan",
  period: "their coverage periods could not be matched",
  basis: "neither document states that it replaces the other",
  scope: "they could not be shown to apply to the same group or benefit",
  ambiguous: "the wording leaves more than one reading",
  order: "which document came later could not be established",
};

/** Plain words for a conflict proof element; unknown elements stay generic. */
export function conflictReasonText(reason: string): string {
  return CONFLICT_REASON_TEXT[reason] ?? "part of the proof could not be confirmed";
}

const RELATION_TEXT: Readonly<Record<string, string>> = {
  supersedes: "replaces",
  conflicts_with: "disagrees with",
  concordant: "agrees with",
  independent: "is separate from",
};

function authorityDisplay(
  table: Pick<Table, "documents">,
  view: unknown,
): AuthorityDisplay | SurfaceCannotBeConfirmedDisplay {
  if (!isObj(view) || view.kind !== "authority") return cannotBeConfirmedDisplay("authority");
  const nameOf = (id: unknown) => table.documents.find((d) => d.documentId === id)?.filename;
  if (
    !isStr(view.scopeLabel) ||
    !view.scopeLabel.trim() ||
    (view.status !== "resolved" && view.status !== "conflict") ||
    (view.verdict !== undefined && !(VERDICTS as readonly unknown[]).includes(view.verdict)) ||
    // CONFLICTED only via the single mapping table; a resolved view never shows it.
    (view.status === "conflict" && view.verdict !== undefined && view.verdict !== displayVerdictFor("conflict")) ||
    (view.status === "resolved" && view.verdict === displayVerdictFor("conflict")) ||
    !Array.isArray(view.governing) ||
    !view.governing.every((g) => isObj(g) && nameOf(g.documentId) && isStr(g.provisionId)) ||
    (view.status === "resolved" && view.governing.length === 0) ||
    !Array.isArray(view.relations)
  )
    return cannotBeConfirmedDisplay("authority");
  const relations: AuthorityDisplay["relations"] = [];
  const reasons: string[] = [];
  for (const r of view.relations) {
    const links = isObj(r) ? linksFor(table, r.evidence) : null;
    if (!isObj(r) || !nameOf(r.from) || !nameOf(r.to) || !isStr(r.relation) || !RELATION_TEXT[r.relation] || !links)
      return cannotBeConfirmedDisplay("authority");
    // A supersession is shown only with its proof quotes.
    if (r.relation === "supersedes" && links.length === 0) return cannotBeConfirmedDisplay("authority");
    if (r.relation === "conflicts_with" && Array.isArray(r.reasons))
      for (const reason of r.reasons) if (isStr(reason)) reasons.push(conflictReasonText(reason));
    relations.push({ text: `${nameOf(r.from)} ${RELATION_TEXT[r.relation]} ${nameOf(r.to)}.`, links });
  }
  const scopeLabel = view.scopeLabel;
  const governing = [...new Set((view.governing as { documentId: string }[]).map((g) => nameOf(g.documentId)!))];
  const status = view.status;
  const uniqueReasons = [...new Set(reasons)];
  return {
    kind: "authority",
    scopeLabel,
    status,
    ...(status === "conflict"
      ? { verdict: displayVerdictFor("conflict") }
      : view.verdict !== undefined
        ? { verdict: view.verdict as Verdict }
        : {}),
    text:
      status === "resolved"
        ? `${governing.join(" and ")} ${governing.length === 1 ? "governs" : "govern"} ${scopeLabel}.`
        : `The documents disagree about ${scopeLabel}, and which one governs could not be proven.`,
    reasons: status === "conflict" ? (uniqueReasons.length ? uniqueReasons : [conflictReasonText("")]) : [],
    relations,
  };
}

/** Display model of the issued surfaces, scoped to the documents in view.
 *  "cannot be confirmed" entries carry no document and are always shown. */
export function surfacesDisplay(
  table: Pick<Table, "documents">,
  surfaces: EvidenceSurfaces | null,
  documentIds?: readonly string[],
): SurfacesDisplay {
  if (!surfaces) return { exclusions: [], authority: [] };
  const inView = (ids: readonly string[]) => !documentIds || ids.some((id) => documentIds.includes(id));
  const exclusions = surfaces.exclusions
    .map((v) => inventoryDisplay(table, v))
    .filter((d) => d.kind === "cannot-be-confirmed" || inView([d.documentId]));
  const authority = surfaces.authority
    .map((v) => ({ v, d: authorityDisplay(table, v) }))
    .filter(({ v, d }) => {
      if (d.kind === "cannot-be-confirmed") return true;
      const a = v as AuthorityView;
      return inView([...a.governing.map((g) => g.documentId), ...a.relations.flatMap((r) => [r.from, r.to])]);
    })
    .map(({ d }) => d);
  return { exclusions, authority };
}

/** All user-facing text of a surfaces display (verbatim claims excluded
 *  when `withClaims` is false), for export and wording checks. */
export function surfacesText(display: SurfacesDisplay, withClaims = true): string[] {
  const out: string[] = [];
  for (const x of display.exclusions) {
    if (x.kind === "cannot-be-confirmed") { out.push(x.text); continue; }
    out.push(x.planName, x.filename, x.coverageText, ...(x.emptyText ? [x.emptyText] : []));
    if (withClaims) for (const i of x.items) out.push(i.claim, ...i.links.map((l) => `${l.filename}, page ${l.page}`));
  }
  for (const a of display.authority) {
    if (a.kind === "cannot-be-confirmed") { out.push(a.text); continue; }
    out.push(a.text, ...(a.verdict ? [a.verdict] : []), ...a.reasons, ...a.relations.map((r) => r.text));
    if (withClaims) for (const r of a.relations) out.push(...r.links.map((l) => l.quote));
  }
  return out;
}

export interface ExclusionCoverageNote {
  documentId?: string;
  planName?: string;
  coverage: "partial" | "unknown" | typeof CANNOT_BE_CONFIRMED;
  text: string;
}

/** For chat: the inventory coverage state of each named plan whose list may
 *  be incomplete (partial / unknown / cannot be confirmed). Complete
 *  inventories add nothing. */
export function exclusionCoverageNotes(
  table: Pick<Table, "documents">,
  surfaces: EvidenceSurfaces | null,
  documentIds: readonly string[],
): ExclusionCoverageNote[] {
  if (!surfaces || documentIds.length === 0) return [];
  return surfacesDisplay(table, surfaces, documentIds).exclusions.flatMap((x): ExclusionCoverageNote[] => {
    if (x.kind === "cannot-be-confirmed") return [{ coverage: CANNOT_BE_CONFIRMED, text: x.text }];
    if (x.coverage === "complete") return [];
    return [{
      documentId: x.documentId,
      planName: x.planName,
      coverage: x.coverage,
      text: `${x.planName} (${x.filename}): ${x.coverageText}`,
    }];
  });
}
