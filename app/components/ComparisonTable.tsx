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
import { VARIES_BY_AGE, NO_RATE_FOR_AGE_PREFIX } from "@/app/lib/extraction/premium";
import { summarizeNetworkDisplay } from "@/app/lib/extraction/network-display";
import { SECTIONS } from "@/app/lib/extraction/sections";
import { organizeRows, sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import { documentTiers, cellValues } from "@/app/lib/extraction/tiers";
import { getPlanDisplayName } from "@/app/lib/extraction/plan-names";
import { documentUrl } from "@/app/lib/document-url";
import VerdictBadge from "@/app/components/VerdictBadge";
import VerifyContact from "@/app/components/VerifyContact";
import type { ContactHit } from "@/app/lib/extraction/contacts";

export const VERIFY_SECTION = {
  title: "Verify & Contact",
  description:
    "Unresolved items to check before enrolling, and plan contact information from your documents.",
};

const LABELS = new Map(FACTS.map((f) => [f.name, f.label]));
const labelFor = (factName: string): string =>
  LABELS.get(factName) ?? (factName === ELIGIBILITY_ROW_NAME ? ELIGIBILITY_ROW_LABEL : factName);
const FACT_CONTEXT = new Map(FACTS.map((f) => [f.name, f.contextField]));
const ALL_TIERS = "__all__";

const FIELD_LABELS: Record<string, string> = {
  age: "Age",
  countryOrResidency: "Country / residency",
  visaOrStatus: "Visa / status",
  location: "City / ZIP",
  coverageDates: "Coverage dates",
};

function MissingContextPrompt({
  factName,
  field,
  sessionId,
  onApplied,
}: {
  factName: string;
  field: string;
  sessionId: string;
  onApplied: (table: Table, field: string, value: string, contacts?: ContactHit[]) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function apply() {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, context: { [field]: value.trim() } }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? data.error ?? "Update failed");
      }
      onApplied(data as Table & { contacts?: ContactHit[] }, field, value.trim(), (data as { contacts?: ContactHit[] }).contacts);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="table__needs-input">
      <span className="table__needs-badge">NEEDS YOUR INPUT</span>
      {!open ? (
        <button type="button" className="btn--link" onClick={() => setOpen(true)}>
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
          <button type="button" className="btn" onClick={() => void apply()} disabled={busy}>
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

/** One document's slot in the header: single-tier docs get one column; a
 *  multi-tier doc gets one column per visible tier under a shared header. */
interface DocumentGroup {
  documentId: string;
  filename: string;
  displayName: string;
  tiers: string[];
  /** Tiers currently shown; undefined entries mean "the whole document". */
  visible: (string | undefined)[];
}

/** True when a multi-tier document carries only tier-agnostic values for
 *  the row, so it renders one cell spanning its tier columns. */
function isSpannedGroup<R extends { qualifiers: { planTier?: string } }>(
  group: DocumentGroup,
  own: R[],
): boolean {
  return group.tiers.length > 1 && own.every((v) => !v.qualifiers.planTier?.trim());
}

/** A row is visible iff at least one currently rendered cell holds a value.
 *  NOT STATED rows carry no values, so they filter out wherever visibility
 *  applies; supported, excluded, verification, and conflicted rows stay. */
function isRowVisible<R extends RegisteredTableRow>(
  row: R,
  docGroups: DocumentGroup[],
): boolean {
  return docGroups.some((group) => {
    const own = cellValues(row.values, group.documentId);
    if (group.tiers.length < 2 || isSpannedGroup(group, own)) {
      return own.length > 0;
    }
    return group.visible.some(
      (tier) => cellValues(row.values, group.documentId, tier).length > 0,
    );
  });
}

function TierCells({
  row,
  group,
  sessionId,
  planNames,
  userContext,
}: {
  row: RegisteredTableRow;
  group: DocumentGroup;
  sessionId: string;
  planNames: Map<string, { name: string; source: "extracted" | "filename" }>;
  userContext: Record<string, string>;
}) {
  const label = labelFor(row.factName);
  const conciseNetwork = row.factName === "network";
  const cellText = (display: string): string =>
    conciseNetwork ? summarizeNetworkDisplay(display) : display;
  /** Verdict state belongs to the plan value, never to the whole row. */
  const cellState = (
    values: RegisteredCellValue[],
  ):
    | { kind: "not-stated" }
    | { kind: "plain" }
    | { kind: "appears-eligible" }
    | { kind: "needs-verification" }
    | { kind: "does-not-fit"; rationale?: string }
    | { kind: "conflicted" } => {
    if (values.length === 0) return { kind: "not-stated" };
    if (row.verdict === "NEEDS VERIFICATION") return { kind: "needs-verification" };
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
  const render = (values: RegisteredCellValue[], key: string, colSpan = 1, first = false) => (
    <td key={key} colSpan={colSpan} className={first ? "table__group-start" : undefined}>
      {(() => {
        const state = cellState(values);
        if (state.kind === "not-stated") {
          return (
            <span className="table__empty" aria-label="Not stated">
              Not stated
            </span>
          );
        }
        const primaryQuote = values[0]?.evidence[0]?.quote;
        const showNumericSource = values.length > 1 &&
          values.every((value) => /^\$[\d,]+/.test(value.display.trim()));
        const sharedQuote = showNumericSource && primaryQuote &&
          values.every((value) => value.evidence[0]?.quote === primaryQuote) &&
          !values.some((value) => value.display.includes(primaryQuote))
          ? primaryQuote
          : null;
        const valuesList =
          values.length > 0 ? (
            <>
              {values.map((v, i) => {
                // Each value links to ITS OWN primary evidence (the first cited
                // passage — deterministic); never the whole row's evidence. A
                // value with no evidence renders as plain text: the contract
                // forbids inventing a citation.
                const primary = v.evidence[0];
                const networkScope = showNumericSource
                  ? (["in-network", "out-of-network"] as const).find((scope) =>
                      primary?.quote.toLowerCase().includes(`${v.display.trim().toLowerCase()} ${scope}`),
                    )
                  : undefined;
                const displayText = `${cellText(v.display)}${networkScope ? ` ${networkScope}` : ""}`;
                if (!primary) {
                  return (
                    <span key={i} className="cell-value">
                      {displayText}
                    </span>
                  );
                }
                const planInfo = planNames.get(v.documentId);
                const displayName = planInfo?.name ?? v.documentId;
                return (
                  <a
                    key={i}
                    className="cell-value"
                    href={documentUrl(sessionId, v.documentId, displayName, primary.page, primary.evidenceId)}
                    target="_blank"
                    rel="noopener"
                    title={`View source evidence for ${label} — ${displayName}, page ${primary.page}`}
                    aria-label={`View source evidence for ${label} — ${displayName}, page ${primary.page}`}
                  >
                    {displayText}
                  </a>
                );
              })}
              {sharedQuote && (
                <span className="cell-value__source">Source wording: {sharedQuote}</span>
              )}
              {!sharedQuote && showNumericSource && values.map((value, index) => {
                const quote = value.evidence[0]?.quote;
                return quote && !value.display.includes(quote) ? (
                  <span className="cell-value__source" key={`${value.documentId}:${index}`}>
                    {value.display} — source wording: {quote}
                  </span>
                ) : null;
              })}
            </>
          ) : (
            <span className="table__empty" aria-label="Not stated">
              Not stated
            </span>
          );
        switch (state.kind) {
          case "plain":
            return valuesList;
          case "appears-eligible":
            return (
              <>
                <span className="verdict verdict--ok">Appears eligible</span>
                {valuesList}
              </>
            );
          case "needs-verification":
            return (
              <>
                <VerdictBadge verdict="NEEDS VERIFICATION" />
                {valuesList}
              </>
            );
          case "does-not-fit":
            return (
              <>
                <VerdictBadge verdict="DOES NOT APPEAR TO FIT" />
                {state.rationale ? (
                  <span className="table__rationale">{state.rationale}</span>
                ) : null}
                {valuesList}
              </>
            );
          case "conflicted":
            return (
              <>
                <VerdictBadge verdict="CONFLICTED" />
                {valuesList}
              </>
            );
        }
      })()}
    </td>
  );

  const own = cellValues(row.values, group.documentId);
  if (isSpannedGroup(group, own)) {
    return render(own, group.documentId, group.visible.length, true);
  }
  return (
    <Fragment>
      {group.visible.map((tier, i) =>
        render(
          cellValues(row.values, group.documentId, tier),
          `${group.documentId}:${tier ?? ""}`,
          1,
          i === 0,
        ),
      )}
    </Fragment>
  );
}

export default function ComparisonTable({
  table,
  sessionId,
  userContext,
  onContextUpdate,
  onTableUpdate,
  initialTierSelection,
  contacts,
}: {
  table: Table;
  sessionId: string;
  userContext?: Record<string, string>;
  onContextUpdate?: (next: Record<string, string>) => void;
  onTableUpdate?: (next: Table, contacts?: ContactHit[]) => void;
  initialTierSelection?: Record<string, string>;
  contacts?: ContactHit[];
}) {
  const groups = organizeRows(table.rows, sanitizeGroups(
    table.presentationGroups ? { groups: table.presentationGroups } : null,
    table.rows,
  ));
  const [activeSection, setActiveSection] = useState(
    () => groups[0]?.section.title ?? VERIFY_SECTION.title,
  );
  const visibleSections = [...groups.map(({ section }) => section), VERIFY_SECTION];
  const activeGroup = groups.find(({ section }) => section.title === activeSection) ?? groups[0];
  const activeSectionDef =
    visibleSections.find((s) => s.title === activeSection) ?? activeGroup?.section ?? VERIFY_SECTION;
  const isVerify = activeSection === VERIFY_SECTION.title;
  const activeRows = activeGroup?.rows ?? [];
  const tiersByDoc = useMemo(() => documentTiers(table), [table]);
  const [selection, setSelection] = useState<Record<string, string>>(initialTierSelection ?? {});
  
  // Plan display names
  const planNames = useMemo(
    () => new Map(
      table.documents.map((d) => {
        const { name, source } = getPlanDisplayName({ filename: d.filename, pages: [] });
        return [d.documentId, { name, source }] as const;
      })
    ),
    [table]
  );

  const docGroups: DocumentGroup[] = table.documents.map((d) => {
    const tiers = tiersByDoc.get(d.documentId) ?? [];
    const planInfo = planNames.get(d.documentId);
    const displayName = planInfo?.name ?? d.filename;
    if (tiers.length < 2) {
      return { documentId: d.documentId, filename: d.filename, displayName, tiers, visible: [undefined] };
    }
    const chosen = selection[d.documentId] ?? ALL_TIERS;
    const visible = chosen === ALL_TIERS ? tiers : tiers.filter((t) => t === chosen);
    return { documentId: d.documentId, filename: d.filename, displayName, tiers, visible };
  });
  const hasTierRow = docGroups.some((g) => g.tiers.length > 1);
  const valueColumns = docGroups.reduce((n, g) => n + g.visible.length, 0);
  // Visibility classes (locked policy): Essentials rows always render.
  // Comparative and highlight rows render only when at least one currently
  // displayed cell holds a value — evaluated against the live tier scope,
  // so hidden tiers never keep a row alive.
  const coreFacts = SECTIONS[0].factNames;
  const renderedRows = activeRows.filter((row) =>
    coreFacts.includes(row.factName) || isRowVisible(row, docGroups));

  // The tier sub-header sticks just below the document header, whose height
  // depends on wrapping filenames — measure it rather than guess.
  const firstHeaderRow = useRef<HTMLTableRowElement>(null);
  const tableEl = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const row = firstHeaderRow.current;
    const el = tableEl.current;
    if (!row || !el) return;
    const apply = () => el.style.setProperty("--header-row-1", `${row.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(row);
    return () => observer.disconnect();
  }, [hasTierRow, valueColumns]);

  return (
    <section
      className="card comparison"
      style={{ "--value-columns": valueColumns } as React.CSSProperties}
      aria-label={table.documents.length === 1 ? "Document understanding" : "Plan comparison"}
    >
      <div className="comparison__intro">
        <h2>{table.documents.length === 1 ? "Understand your document" : "Your plans, side by side"}</h2>
        <p>{table.documents.length === 1
          ? "Review the stated benefits, costs, eligibility, restrictions and missing details. Select a tier when available; open any value to check its source page."
          : "Open any value to see the exact source page it came from."}</p>
      </div>

      <div className="comparison__tabs" role="group" aria-label="Comparison sections">
        {visibleSections.map((section) => {
          const active = section.title === activeSection;
          return (
            <button
              key={section.title}
              type="button"
              className="comparison__tab"
              aria-pressed={active}
              onClick={() => setActiveSection(section.title)}
            >
              {section.title}
            </button>
          );
        })}
      </div>

      <div className="comparison__section-summary" aria-live="polite">
        <h3>{activeSectionDef.title}</h3>
        <p>{activeSectionDef.description}</p>
      </div>

      {isVerify ? (
        <VerifyContact
          table={table}
          sessionId={sessionId}
          contacts={contacts ?? []}
          planNames={planNames}
        />
      ) : renderedRows.length === 0 ? (
        <p className="comparison__empty" role="status">
          No stated facts in this group for the selected tiers.
        </p>
      ) : (
      <div className="comparison__table-wrap">
        <table className="table" ref={tableEl} aria-label={activeSectionDef.title}>
          <colgroup>
            <col className="col-fact" />
            {docGroups.map((g) =>
              g.visible.map((tier) => <col key={`${g.documentId}:${tier ?? ""}`} />),
            )}
          </colgroup>
          <thead>
            <tr ref={firstHeaderRow}>
              <th scope="col" rowSpan={hasTierRow ? 2 : 1}>
                What matters
              </th>
              {docGroups.map((g) =>
                g.tiers.length > 1 ? (
                  <th
                    key={g.documentId}
                    scope="colgroup"
                    colSpan={g.visible.length}
                    className="table__group table__group-start"
                  >
                    <span className="table__group-name">{g.displayName}</span>
                    <label className="table__tier-picker">
                      <span className="sr-only">Tier shown for {g.displayName}</span>
                      <select
                        className="select select--compact"
                        value={selection[g.documentId] ?? ALL_TIERS}
                        onChange={(e) =>
                          setSelection({ ...selection, [g.documentId]: e.target.value })
                        }
                      >
                        <option value={ALL_TIERS}>All tiers</option>
                        {g.tiers.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </th>
                ) : (
                  <th
                    key={g.documentId}
                    scope="col"
                    rowSpan={hasTierRow ? 2 : 1}
                    className="table__group-start"
                  >
                    {g.displayName}
                  </th>
                ),
              )}
            </tr>
            {hasTierRow && (
              <tr className="table__tiers">
                {docGroups.flatMap((g) =>
                  g.tiers.length > 1
                    ? g.visible.map((tier, i) => (
                        <th
                          key={`${g.documentId}:${tier}`}
                          scope="col"
                          className={i === 0 ? "table__group-start" : undefined}
                        >
                          {tier}
                        </th>
                      ))
                    : [],
                )}
              </tr>
            )}
          </thead>
          <tbody>
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
                  {missingField && onTableUpdate && (
                    <MissingContextPrompt
                      factName={row.factName}
                      field={missingField}
                      sessionId={sessionId}
                      onApplied={(next, field, val, nextContacts) => {
                        onTableUpdate(next, nextContacts);
                        onContextUpdate?.({ ...(userContext ?? {}), [field]: val });
                      }}
                    />
                  )}
                </th>
                {docGroups.map((g) => (
                  <TierCells key={g.documentId} row={row} group={g} sessionId={sessionId} planNames={planNames} userContext={userContext ?? {}} />
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
