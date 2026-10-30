"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  RegisteredCellValue,
  RegisteredComparisonTable as Table,
  RegisteredTableRow,
} from "@/app/lib/extraction/types";
import { FACTS } from "@/app/lib/extraction/fact-list";
import {
  ELIGIBILITY_ROW_LABEL,
  ELIGIBILITY_ROW_NAME,
  contextFieldRulesOut,
  eligibilityMissingField,
} from "@/app/lib/extraction/eligibility";
import {
  VARIES_BY_AGE,
  NO_RATE_FOR_AGE_PREFIX,
} from "@/app/lib/extraction/premium";
import {
  buildWorkspaceGroups,
  type WorkspaceSubgroup,
} from "@/app/lib/extraction/workspace-groups";
import { sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import { SECTIONS } from "@/app/lib/extraction/sections";
import { cellValues } from "@/app/lib/extraction/tiers";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import { documentPlanTitle } from "@/app/lib/extraction/plan-names";
import {
  alphabeticalPlanIds,
  planDocuments,
  planTiers,
  type Section,
} from "@/app/lib/extraction/selection";
import VerdictBadge from "@/app/components/VerdictBadge";
import VerifyContact from "@/app/components/VerifyContact";
import ConditionalValue from "@/app/components/ConditionalValue";
import type { ContactHit } from "@/app/lib/extraction/contacts";
import {
  describeExtractFailure,
  type ExtractFailure,
} from "@/app/lib/extract-errors";

const LABELS = new Map(FACTS.map((f) => [f.name, f.label]));
const labelFor = (factName: string): string =>
  LABELS.get(factName) ??
  (factName === ELIGIBILITY_ROW_NAME ? ELIGIBILITY_ROW_LABEL : factName);
const FACT_CONTEXT = new Map(FACTS.map((f) => [f.name, f.contextField]));
const ALL_TIERS = "__all__";
// V1.1: My Fit and My Costs facts always render so high-impact unknowns
// (eligibility, deductible, premium) are not silently hidden.
const CORE_FACTS = new Set([
  ...SECTIONS[0].factNames,
  ...SECTIONS[1].factNames,
]);

const FIELD_LABELS: Record<string, string> = {
  age: "Age",
  countryOrResidency: "Country / residency",
  visaOrStatus: "Visa / status",
  location: "City / ZIP",
  coverageDates: "Coverage dates",
};

export function MissingContextPrompt({
  factName,
  field,
  sessionId,
  onRequestStart,
  onRequestEnd,
  onFailed,
  onApplied,
}: {
  factName: string;
  field: string;
  sessionId: string;
  onRequestStart: () => number | null;
  onRequestEnd: (generation: number) => void;
  onFailed?: (
    failure: ExtractFailure,
    generation: number,
    status?: number,
  ) => void;
  onApplied: (
    table: Table,
    field: string,
    value: string,
    contacts?: ContactHit[],
    generation?: number,
  ) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function apply() {
    if (!value.trim() || busy) return;
    const generation = onRequestStart();
    if (generation === null) {
      setError("Another update is in progress. Try again when it finishes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, context: { [field]: value.trim() } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const failure = describeExtractFailure(data, null, res.status);
        onFailed?.(failure, generation, res.status);
        setError(failure.message);
        return;
      }
      onApplied(
        data as Table & { contacts?: ContactHit[] },
        field,
        value.trim(),
        (data as { contacts?: ContactHit[] }).contacts,
        generation,
      );
      setOpen(false);
    } catch {
      const failure = describeExtractFailure(null, true);
      onFailed?.(failure, generation);
      setError(failure.message);
    } finally {
      onRequestEnd(generation);
      setBusy(false);
    }
  }

  return (
    <div className="table__needs-input">
      <span className="table__needs-badge">NEEDS YOUR INPUT</span>
      {!open ? (
        <button
          type="button"
          className="btn--link"
          onClick={() => setOpen(true)}
        >
          Add information
        </button>
      ) : (
        <span className="table__needs-form">
          <label>
            {FIELD_LABELS[field] ?? field}
            <input
              className="input"
              aria-label={`${FIELD_LABELS[field] ?? field} for ${labelFor(factName)}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void apply();
              }}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => void apply()}
            disabled={busy}
          >
            {busy ? "…" : "Apply"}
          </button>
        </span>
      )}
      {error && (
        <span role="alert" className="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface PlanView {
  planId: string;
  verified: boolean;
  displayName: string;
  sourceDocuments: string[];
  tiers: string[];
  selectedTier: string | null;
}

function buildPlanViews(
  table: Table,
  selectedPlanIds: string[],
  tierSelection: Record<string, string | null>,
): PlanView[] {
  const planInfos = table.plans ?? [];
  const hasPlans = planInfos.length > 0;
  const syntheticPlans = hasPlans
    ? []
    : table.documents.map((d) => ({
        planId: d.documentId,
        name: documentPlanTitle(table, d.documentId).name,
        sourceDocuments: [d.documentId],
      }));
  const sources = hasPlans
    ? planInfos.map((p) => ({
        planId: p.planId,
        name: p.name,
        sourceDocuments: planDocuments(table, p.planId),
      }))
    : syntheticPlans;

  return selectedPlanIds
    .slice(0, 3)
    .map((planId) => {
      const source = sources.find((s) => s.planId === planId);
      if (!source) return null;
      const tiers = hasPlans
        ? planTiers(table, planId)
        : planTiersForDocuments(table, source.sourceDocuments);
      const selectedTier = tierSelection[planId] ?? null;
      return {
        planId,
        verified: hasPlans,
        displayName: source.name,
        sourceDocuments: source.sourceDocuments,
        tiers,
        selectedTier,
      };
    })
    .filter((v): v is PlanView => v !== null);
}

function planTiersForDocuments(table: Table, documentIds: string[]): string[] {
  const tiers: string[] = [];
  const key = (t: string) => t.trim().toLowerCase();
  for (const row of table.rows) {
    for (const v of row.values) {
      if (!documentIds.includes(v.documentId)) continue;
      const tier = v.qualifiers.planTier?.trim();
      if (!tier) continue;
      if (!tiers.some((t) => key(t) === key(tier))) tiers.push(tier);
    }
  }
  return tiers;
}

function planValues<T extends RegisteredCellValue>(
  values: T[],
  plan: PlanView,
): T[] {
  // Document association is not proof of plan applicability (C6).
  return plan.verified ? values.filter((v) => v.planId === plan.planId) : [];
}

function tierVisible(value: RegisteredCellValue, plan: PlanView): boolean {
  if (plan.selectedTier === null) return true;
  const own = value.qualifiers.planTier?.trim();
  if (!own) return true;
  return own.toLowerCase() === plan.selectedTier.toLowerCase();
}

function isRowVisible<R extends RegisteredTableRow>(
  row: R,
  plans: PlanView[],
): boolean {
  return plans.some((plan) =>
    planValues(row.values, plan).some((v) => tierVisible(v, plan)),
  );
}

function PlanCells({
  row,
  plan,
  sessionId,
  userContext,
  documentFilenames,
}: {
  row: RegisteredTableRow;
  plan: PlanView;
  sessionId: string;
  userContext: Record<string, string>;
  documentFilenames: Map<string, string>;
}) {
  const label = labelFor(row.factName);
  const conciseNetwork = row.factName === "network";
  const values = planValues(row.values, plan).filter((v) =>
    tierVisible(v, plan),
  );

  const cellState = ():
    | { kind: "not-stated" }
    | { kind: "plain" }
    | { kind: "appears-eligible" }
    | { kind: "needs-verification" }
    | { kind: "does-not-fit"; rationale?: string }
    | { kind: "conflicted" } => {
    if (values.length === 0) return { kind: "not-stated" };
    if (hasSameScopeContradiction(values)) return { kind: "conflicted" };
    if (row.verdict === "NEEDS VERIFICATION")
      return { kind: "needs-verification" };
    if (row.verdict === "CONFLICTED") {
      const readings = new Set(
        values.map((v) => v.display.trim().toLowerCase().replace(/\s+/g, " ")),
      );
      if (values.length > 1 && readings.size > 1) return { kind: "conflicted" };
      return { kind: "plain" };
    }
    if (row.verdict === "DOES NOT APPEAR TO FIT") {
      const field = /'([^']+)'/.exec(row.rationale ?? "")?.[1];
      const ruledOut =
        !field ||
        values.every((v) =>
          contextFieldRulesOut(
            field,
            userContext,
            [v.display, ...v.evidence.map((e) => e.quote)].join("\n"),
          ),
        );
      if (ruledOut) return { kind: "does-not-fit", rationale: row.rationale };
      return row.factName === ELIGIBILITY_ROW_NAME
        ? { kind: "appears-eligible" }
        : { kind: "plain" };
    }
    return row.factName === ELIGIBILITY_ROW_NAME
      ? { kind: "appears-eligible" }
      : { kind: "plain" };
  };

  const renderValues = () => {
    if (values.length === 0) {
      return (
        <span className="table__empty" aria-label="Not stated">
          Not stated
        </span>
      );
    }
    const primaryQuote = values[0]?.evidence[0]?.quote;
    const showNumericSource =
      values.length > 1 &&
      values.every((value) => /^\$[\d,]+/.test(value.display.trim()));
    const sharedQuote =
      showNumericSource &&
      primaryQuote &&
      values.every((value) => value.evidence[0]?.quote === primaryQuote) &&
      !values.some((value) => value.display.includes(primaryQuote))
        ? primaryQuote
        : null;

    return (
      <>
        {values.map((v, i) => (
          <ConditionalValue
            key={`${v.documentId}:${i}`}
            value={v}
            factLabel={label}
            documentName={
              documentFilenames.get(v.documentId) ?? plan.displayName
            }
            sessionId={sessionId}
            userContext={userContext}
            concise={conciseNetwork}
            numericScope={showNumericSource}
          />
        ))}
        {sharedQuote && (
          <span className="cell-value__source">
            Source wording: {sharedQuote}
          </span>
        )}
        {!sharedQuote &&
          showNumericSource &&
          values.map((value, index) => {
            const quote = value.evidence[0]?.quote;
            return quote && !value.display.includes(quote) ? (
              <span
                className="cell-value__source"
                key={`${value.documentId}:${index}`}
              >
                {value.display} — source wording: {quote}
              </span>
            ) : null;
          })}
      </>
    );
  };

  const state = cellState();
  switch (state.kind) {
    case "not-stated":
      return (
        <td className="table__group-start">
          <span className="table__empty" aria-label="Not stated">
            Not stated
          </span>
        </td>
      );
    case "plain":
      return <td className="table__group-start">{renderValues()}</td>;
    case "appears-eligible":
      return (
        <td className="table__group-start">
          <span className="verdict verdict--ok">Appears eligible</span>
          {renderValues()}
        </td>
      );
    case "needs-verification":
      return (
        <td className="table__group-start">
          <VerdictBadge verdict="NEEDS VERIFICATION" />
          {renderValues()}
        </td>
      );
    case "does-not-fit":
      return (
        <td className="table__group-start">
          <VerdictBadge verdict="DOES NOT APPEAR TO FIT" />
          {state.rationale ? (
            <span className="table__rationale">{state.rationale}</span>
          ) : null}
          {renderValues()}
        </td>
      );
    case "conflicted":
      return (
        <td className="table__group-start">
          <VerdictBadge verdict="CONFLICTED" />
          <span className="table__rationale">
            Conflicting evidence for the same plan and scope. Verify both source
            pages.
          </span>
          {renderValues()}
        </td>
      );
  }
}

function SubgroupRows({
  subgroup,
  plans,
  sessionId,
  userContext,
  userContextRef,
  onTableUpdate,
  onContextUpdate,
  onContextRequestStart,
  onContextRequestEnd,
  onContextRequestFailure,
  documentFilenames,
  onAskFact,
}: {
  subgroup: WorkspaceSubgroup<RegisteredTableRow>;
  plans: PlanView[];
  sessionId: string;
  userContext: Record<string, string>;
  userContextRef?: React.MutableRefObject<Record<string, string>>;
  onTableUpdate?: (
    next: Table,
    contacts?: ContactHit[],
    generation?: number,
  ) => void;
  onContextUpdate?: (next: Record<string, string>, generation?: number) => void;
  onContextRequestStart?: () => number | null;
  onContextRequestEnd?: (generation: number) => void;
  onContextRequestFailure?: (
    failure: ExtractFailure,
    generation: number,
    status?: number,
  ) => void;
  documentFilenames: Map<string, string>;
  onAskFact?: (question: string) => void;
}) {
  const renderedRows = subgroup.rows.filter(
    (row) => CORE_FACTS.has(row.factName) || isRowVisible(row, plans),
  );
  if (renderedRows.length === 0) return null;
  return (
    <>
      <tr className="table__subgroup">
        <th colSpan={plans.length + 1} scope="colgroup">
          {subgroup.title}
        </th>
      </tr>
      {renderedRows.map((row) => {
        const contextField = FACT_CONTEXT.get(row.factName);
        const missingPremiumAge =
          row.factName === "premium" &&
          row.verdict === "NEEDS VERIFICATION" &&
          row.values.length === 0 &&
          row.rationale === VARIES_BY_AGE &&
          !(userContext?.age ?? "").trim();
        const missingField =
          row.factName === ELIGIBILITY_ROW_NAME
            ? eligibilityMissingField(row, userContext ?? {})
            : missingPremiumAge
              ? "age"
              : contextField && !(userContext?.[contextField] ?? "").trim()
                ? contextField
                : null;
        return (
          <tr key={row.factName}>
            <th scope="row" className="table__fact">
              {labelFor(row.factName)}
              {onAskFact && (
                <button
                  type="button"
                  className="fact-question"
                  aria-label={`Ask about ${labelFor(row.factName)}`}
                  onClick={() =>
                    onAskFact(
                      `What should I check about ${labelFor(row.factName).toLowerCase()} for the selected plans and tiers?`,
                    )
                  }
                >
                  Ask ↗
                </button>
              )}
              {missingField && onTableUpdate && (
                <MissingContextPrompt
                  factName={row.factName}
                  field={missingField}
                  sessionId={sessionId}
                  onRequestStart={onContextRequestStart ?? (() => 0)}
                  onRequestEnd={onContextRequestEnd ?? (() => {})}
                  onFailed={onContextRequestFailure}
                  onApplied={(next, field, val, nextContacts, generation) => {
                    onTableUpdate(next, nextContacts, generation);
                    onContextUpdate?.({ [field]: val }, generation);
                  }}
                />
              )}
            </th>
            {plans.map((plan) => (
              <PlanCells
                key={plan.planId}
                row={row}
                plan={plan}
                sessionId={sessionId}
                userContext={userContext ?? {}}
                documentFilenames={documentFilenames}
              />
            ))}
          </tr>
        );
      })}
    </>
  );
}

export const VERIFY_SECTION: Section = "Evidence & Actions";

export default function ComparisonTable({
  table,
  sessionId,
  userContext,
  onContextUpdate,
  onTableUpdate,
  onContextRequestStart,
  onContextRequestEnd,
  onContextRequestFailure,
  selectedPlanIds,
  onSelectedPlanIdsChange,
  onMovePlan,
  onResetPlanOrder,
  initialTierSelection,
  tierSelection,
  onTierSelectionChange,
  contacts,
  onAskFact,
}: {
  table: Table;
  sessionId: string;
  userContext?: Record<string, string>;
  onContextUpdate?: (next: Record<string, string>, generation?: number) => void;
  onTableUpdate?: (
    next: Table,
    contacts?: ContactHit[],
    generation?: number,
  ) => void;
  onContextRequestStart?: () => number | null;
  onContextRequestEnd?: (generation: number) => void;
  onContextRequestFailure?: (
    failure: ExtractFailure,
    generation: number,
    status?: number,
  ) => void;
  selectedPlanIds?: string[];
  onSelectedPlanIdsChange?: (planIds: string[]) => void;
  /** Phase C reordering: swap a visible plan with its neighbour. */
  onMovePlan?: (planId: string, direction: "left" | "right") => void;
  /** Phase C: restore the verified alphabetical default order. */
  onResetPlanOrder?: () => void;
  /** Legacy document-scoped tier selection; treated as plan-scoped for backward compatibility. */
  initialTierSelection?: Record<string, string>;
  tierSelection?: Record<string, string | null>;
  onTierSelectionChange?: (planId: string, tier: string | null) => void;
  selectedSection?: Section;
  onSectionChange?: (section: Section) => void;
  contacts?: ContactHit[];
  onAskFact?: (question: string) => void;
}) {
  const presentationGroups = sanitizeGroups(
    table.presentationGroups ? { groups: table.presentationGroups } : null,
    table.rows,
  );
  const workspace = buildWorkspaceGroups(table.rows, presentationGroups);

  const provenPlanIds = useMemo(() => {
    if (table.plans && table.plans.length > 0)
      return table.plans.map((p) => p.planId);
    // Legacy tables without proven plans: each document is its own synthetic plan view.
    return table.documents.map((d) => d.documentId);
  }, [table.plans, table.documents]);
  // Default comparison order: verified plans A–Z by declared name (legacy
  // upload order when no plan identity is verifiable).
  const defaultPlanIds = useMemo(
    () => alphabeticalPlanIds(table).slice(0, 3),
    [table],
  );
  const [internalPlanIds, setInternalPlanIds] = useState<string[] | null>(null);
  const effectivePlanIds = selectedPlanIds ?? internalPlanIds ?? defaultPlanIds;

  const [internalTiers, setInternalTiers] = useState<
    Record<string, string | null>
  >(() => {
    const map: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(initialTierSelection ?? {})) {
      map[key] = value === ALL_TIERS ? null : value;
    }
    return map;
  });
  const effectiveTiers = tierSelection ?? internalTiers;

  const plans = useMemo(
    () => buildPlanViews(table, effectivePlanIds, effectiveTiers),
    [table, effectivePlanIds, effectiveTiers],
  );

  const planNames = useMemo(
    () =>
      new Map(
        table.documents.map(
          (d) =>
            [d.documentId, documentPlanTitle(table, d.documentId)] as const,
        ),
      ),
    [table],
  );

  const documentFilenames = useMemo(
    () =>
      new Map(table.documents.map((d) => [d.documentId, d.filename] as const)),
    [table],
  );

  const valueColumns = plans.length;
  const firstHeaderRow = useRef<HTMLTableRowElement>(null);
  const tableEl = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const row = firstHeaderRow.current;
    const el = tableEl.current;
    if (!row || !el) return;
    const apply = () =>
      el.style.setProperty("--header-row-1", `${row.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(row);
    return () => observer.disconnect();
  }, [valueColumns]);

  function setPlanIds(next: string[]) {
    if (onSelectedPlanIdsChange) onSelectedPlanIdsChange(next.slice(0, 3));
    else setInternalPlanIds(next.slice(0, 3));
  }

  /** Reorder the visible plans (Phase C): controlled via the page selection
   *  when wired, otherwise locally on the component's own view state. */
  function movePlan(planId: string, direction: "left" | "right") {
    if (onMovePlan) {
      onMovePlan(planId, direction);
      return;
    }
    const current = [...effectivePlanIds];
    const index = current.indexOf(planId);
    const target = direction === "left" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    setPlanIds(current);
  }

  function resetOrder() {
    if (onResetPlanOrder) {
      onResetPlanOrder();
      return;
    }
    const selected = new Set(effectivePlanIds);
    setPlanIds(alphabeticalPlanIds(table).filter((id) => selected.has(id)));
  }

  const visibleGroups = workspace.filter((group) =>
    group.subgroups.some((sub) =>
      sub.rows.some(
        (row) => CORE_FACTS.has(row.factName) || isRowVisible(row, plans),
      ),
    ),
  );
  const unassignedRows = table.rows
    .map((row) => ({
      ...row,
      values: row.values.filter((value) => {
        if (
          value.planId &&
          table.plans?.some((plan) => plan.planId === value.planId)
        )
          return false;
        const documentViews = plans.filter((plan) =>
          plan.sourceDocuments.includes(value.documentId),
        );
        return (
          documentViews.length === 0 ||
          documentViews.some((plan) => tierVisible(value, plan))
        );
      }),
    }))
    .filter((row) => row.values.length > 0);

  function setTier(planId: string, tier: string | null) {
    if (onTierSelectionChange) onTierSelectionChange(planId, tier);
    else setInternalTiers((prior) => ({ ...prior, [planId]: tier }));
  }

  return (
    <div className="comparison-stack">
      <section
        className="reviewPanel comparison"
        style={{ "--value-columns": valueColumns } as React.CSSProperties}
        aria-label={
          table.documents.length === 1
            ? "Document understanding"
            : "Plan comparison"
        }
      >
        <div className="comparison__intro">
          <div className="comparison__intro-text">
            <span className="eyelabel">Your documents</span>
            <h2>
              {plans.length === 1
                ? "Understand your document"
                : "Coverage comparison"}
            </h2>
            <p>
              {table.documents.length === 1
                ? "Review the stated benefits, costs, eligibility, restrictions and missing details. Select a tier when available; open any value to check its source page."
                : "Open any value to see the exact source page it came from."}
            </p>
          </div>
          {plans.length > 1 && (
            <button
              type="button"
              className="btn comparison__reset-order"
              aria-label="Reset plan order to A to Z"
              onClick={resetOrder}
            >
              Reset to A–Z
            </button>
          )}
        </div>

        <p className="reviewNote">
          {plans.length > 1
            ? "Drag the plan names to rearrange columns, or use the arrow buttons. Up to three plans shown."
            : "A continuous reading of your document. Values without verified plan applicability are kept separately below."}
        </p>
        <div className="planShelf" aria-label="Reorder comparison plans">
          {plans.map((plan, index) => (
            <div
              className="planChip"
              key={plan.planId}
              draggable={plans.length > 1}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", plan.planId);
                e.dataTransfer.effectAllowed = "move";
                e.currentTarget.classList.add("dragged");
              }}
              onDragEnd={(e) => e.currentTarget.classList.remove("dragged")}
              onDragOver={(e) => {
                if (plans.length > 1) {
                  e.preventDefault();
                  e.currentTarget.classList.add("dropTarget");
                }
              }}
              onDragLeave={(e) =>
                e.currentTarget.classList.remove("dropTarget")
              }
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("dropTarget");
                const ids = [...effectivePlanIds];
                const from = ids.indexOf(e.dataTransfer.getData("text/plain"));
                const to = ids.indexOf(plan.planId);
                if (from < 0 || to < 0 || from === to) return;
                ids.splice(to, 0, ...ids.splice(from, 1));
                setPlanIds(ids);
              }}
            >
              <span className="handle" aria-hidden="true">
                ⠿
              </span>
              <strong>{plan.displayName}</strong>
              {plans.length > 1 && (
                <div className="moveButtons">
                  <button
                    type="button"
                    aria-label={`Move ${plan.displayName} left`}
                    disabled={index === 0}
                    onClick={() => movePlan(plan.planId, "left")}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${plan.displayName} right`}
                    disabled={index === plans.length - 1}
                    onClick={() => movePlan(plan.planId, "right")}
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {visibleGroups.length === 0 ? (
          <p className="comparison__empty" role="status">
            No stated facts in this group for the selected plans. This does not
            mean the plan has no coverage.
          </p>
        ) : (
          <div className="comparison__table-wrap">
            <table
              className={`table${plans.length === 1 ? " table--single" : ""}`}
              ref={tableEl}
              aria-label="Insurance document comparison"
            >
              <colgroup>
                <col className="col-fact" />
                {plans.map((plan) => (
                  <col key={plan.planId} />
                ))}
              </colgroup>
              <thead>
                <tr ref={firstHeaderRow}>
                  <th scope="col">What matters</th>
                  {plans.map((plan) => (
                    <th
                      key={plan.planId}
                      scope="col"
                      className="table__group-start"
                      draggable={plans.length > 1}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", plan.planId);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (plans.length > 1) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = e.dataTransfer.getData("text/plain");
                        if (!fromId || fromId === plan.planId) return;
                        const current = [...effectivePlanIds];
                        const fromIndex = current.indexOf(fromId);
                        const toIndex = current.indexOf(plan.planId);
                        if (fromIndex === -1 || toIndex === -1) return;
                        current.splice(fromIndex, 1);
                        current.splice(toIndex, 0, fromId);
                        setPlanIds(current);
                      }}
                    >
                      <span className="table__group-name">
                        {plan.displayName}
                      </span>
                      {plan.tiers.length > 1 && (
                        <label className="table__tier-picker">
                          <span className="sr-only">
                            Tier shown for {plan.displayName}
                          </span>
                          <select
                            className="select select--compact"
                            value={
                              plan.selectedTier === null
                                ? ALL_TIERS
                                : plan.selectedTier
                            }
                            onChange={(e) =>
                              setTier(
                                plan.planId,
                                e.target.value === ALL_TIERS
                                  ? null
                                  : e.target.value,
                              )
                            }
                          >
                            <option value={ALL_TIERS}>All tiers</option>
                            {plan.tiers.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => (
                  <Fragment key={group.section.title}>
                    <tr className="table__category">
                      <th colSpan={plans.length + 1} scope="colgroup">
                        {group.section.title}
                      </th>
                    </tr>
                    {group.subgroups.map((subgroup) => (
                      <SubgroupRows
                        key={subgroup.title}
                        subgroup={subgroup}
                        plans={plans}
                        sessionId={sessionId}
                        userContext={userContext ?? {}}
                        onTableUpdate={onTableUpdate}
                        onContextUpdate={onContextUpdate}
                        onContextRequestStart={onContextRequestStart}
                        onContextRequestEnd={onContextRequestEnd}
                        onContextRequestFailure={onContextRequestFailure}
                        documentFilenames={documentFilenames}
                        onAskFact={onAskFact}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {provenPlanIds.length > 1 && (
          <div
            className="plan-picker"
            role="group"
            aria-label="Select plans to compare"
          >
            <span className="plan-picker__label">
              Compared plans ({effectivePlanIds.length}/3):
            </span>
            {/* Picker items are a pure A–Z list of verified plan names; the
              checkbox state and the table's reorder controls carry the
              selection state, never the picker order itself. */}
            {alphabeticalPlanIds(table).map((planId) => {
              const plan = table.plans?.find((p) => p.planId === planId);
              const checked = effectivePlanIds.includes(planId);
              return (
                <label key={planId} className="plan-picker__item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...effectivePlanIds, planId]
                        : effectivePlanIds.filter((id) => id !== planId);
                      setPlanIds(next);
                    }}
                    disabled={
                      checked
                        ? effectivePlanIds.length === 1
                        : effectivePlanIds.length >= 3
                    }
                    aria-describedby="plan-picker-help"
                  />
                  <span>
                    {planNames.get(planId)?.name ?? plan?.name ?? planId}
                  </span>
                </label>
              );
            })}
            <span id="plan-picker-help" className="plan-picker__help">
              Choose up to three plans.
            </span>
          </div>
        )}
      </section>
      {unassignedRows.length > 0 && (
        <section
          className="reviewPanel"
          aria-label="Document evidence requiring verification"
        >
          <div className="reviewTopline">
            <div>
              <span className="eyelabel">Unresolved evidence</span>
              <h2>Worth checking in the documents</h2>
            </div>
          </div>
          <p className="reviewNote">
            These facts have source evidence, but cannot be confirmed as
            benefits or costs of a selected plan. Verify the applicable plan,
            tier and purchased options before relying on them.
          </p>
          <div className="unassigned-evidence">
            {unassignedRows.map((row) => {
              const numericScope =
                row.values.length > 1 &&
                row.values.every((value) =>
                  /^\$[\d,]+/.test(value.display.trim()),
                );
              const renderSource = (
                value: RegisteredCellValue,
                index: number,
              ) => (
                <div
                  className="document-passage"
                  key={`${value.documentId}:${index}`}
                >
                  <p className="reviewNote">
                    {documentFilenames.get(value.documentId)}
                  </p>
                  <ConditionalValue
                    value={value}
                    numericScope={numericScope}
                    factLabel={labelFor(row.factName)}
                    documentName={
                      documentFilenames.get(value.documentId) ?? "Document"
                    }
                    sessionId={sessionId}
                    userContext={userContext}
                  />
                  {numericScope && value.evidence[0] && (
                    <span className="cell-value__source">
                      Source wording: {value.evidence[0].quote}
                    </span>
                  )}
                </div>
              );
              return (
                <article className="emptyDoc" key={row.factName}>
                  <span className="stateMark unconfirmed">
                    Unverified applicability
                  </span>
                  <h3>{labelFor(row.factName)}</h3>
                  {row.values.slice(0, 3).map(renderSource)}
                  {row.values.length > 3 && (
                    <details className="source-details">
                      <summary>
                        Show {row.values.length - 3} more source passages
                      </summary>
                      {row.values
                        .slice(3)
                        .map((value, index) => renderSource(value, index + 3))}
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      <VerifyContact
        table={table}
        sessionId={sessionId}
        contacts={contacts ?? []}
        planNames={planNames}
        orderedPlanTitles={plans.map((plan) => plan.displayName)}
        selectedPlanIds={plans.map((plan) => plan.planId)}
      />
    </div>
  );
}
