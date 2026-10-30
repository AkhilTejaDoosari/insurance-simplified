"use client";

import React, { Fragment, useMemo } from "react";
import {
  buildOverview,
  type OverviewItem,
  type OverviewSection,
} from "@/app/lib/extraction/overview";
import type { EffectiveSelection } from "@/app/lib/extraction/selection";
import type {
  RegisteredCellValue,
  RegisteredComparisonTable as Table,
} from "@/app/lib/extraction/types";
import { documentUrl } from "@/app/lib/document-url";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { SECTIONS } from "@/app/lib/extraction/sections";
import ConditionalValue from "@/app/components/ConditionalValue";

type SummaryFinding = OverviewItem & { sourceValue?: RegisteredCellValue };

function Notes({ notes }: { notes?: string[] }) {
  if (!notes || notes.length === 0) return null;
  return (
    <div className="overview__notes">
      {notes.map((note, i) => (
        <span key={i} className="overview__note">
          {note}
        </span>
      ))}
    </div>
  );
}

function EvidenceLinks({
  item,
  sessionId,
}: {
  item: OverviewItem;
  sessionId: string;
}) {
  if (item.evidence.length === 0) return null;
  return (
    <span className="overview__evidence">
      {item.evidence.map((e, i) => (
        <Fragment key={e.evidenceId || `${e.documentId}:${e.page}:${i}`}>
          {i > 0 && ", "}
          <a
            className="btn--link"
            href={documentUrl(
              sessionId,
              e.documentId,
              e.filename,
              e.page,
              e.evidenceId || undefined,
            )}
            target="_blank"
            rel="noopener"
            title={`View source on page ${e.page}`}
          >
            {e.filename}, page {e.page}
          </a>
        </Fragment>
      ))}
    </span>
  );
}

function selectionScopes(
  selection: EffectiveSelection | null,
): { planId?: string; tier?: string | null }[] {
  if (!selection) return [];
  return selection.selectedPlanIds.map((planId) => ({
    planId,
    tier: selection.tiers[planId] ?? null,
  }));
}

function ItemBody({
  item,
  sessionId,
}: {
  item: OverviewItem;
  sessionId: string;
}) {
  return (
    <>
      {item.value && <div className="overview__value">{item.value}</div>}
      <Notes notes={item.notes} />
      {item.statement && (
        <div className="overview__statement">{item.statement}</div>
      )}
      {item.action && (
        <div className="overview__action">
          <strong>Action:</strong> {item.action}
        </div>
      )}
      <div className="overview__meta">
        <EvidenceLinks item={item} sessionId={sessionId} />
        {item.planName && (
          <span className="overview__plan">{item.planName}</span>
        )}
      </div>
    </>
  );
}

export default function PersonalizedOverview({
  table,
  userContext,
  selection,
  sessionId,
}: {
  table: Table;
  userContext: Record<string, string>;
  selection: EffectiveSelection | null;
  sessionId: string;
}) {
  const scopedTable = useMemo(
    () => ({
      ...table,
      rows: table.rows.map((row) => ({
        ...row,
        values: row.values
          .filter((value) => {
            if (
              !value.planId ||
              !table.plans?.some((plan) => plan.planId === value.planId)
            )
              return false;
            if (selection && !selection.selectedPlanIds.includes(value.planId))
              return false;
            const tier = selection?.tiers[value.planId];
            return (
              !tier ||
              !value.qualifiers.planTier ||
              value.qualifiers.planTier.trim().toLowerCase() ===
                tier.trim().toLowerCase()
            );
          })
          .sort(
            (a, b) =>
              (selection?.selectedPlanIds.indexOf(a.planId!) ?? 0) -
              (selection?.selectedPlanIds.indexOf(b.planId!) ?? 0),
          ),
      })),
    }),
    [table, selection],
  );
  const overview = useMemo(
    () => buildOverview(scopedTable, userContext, selectionScopes(selection)),
    [scopedTable, userContext, selection],
  );

  const priorities: Record<OverviewSection, number> = {
    "My Fit": 0,
    "Limits & Risks": 1,
    "My Costs": 2,
    Coverage: 3,
    "Evidence & Actions": 4,
  };
  const labels = new Set<string>();
  const riskNames = new Set([
    "pre-existing-conditions",
    ...(SECTIONS.find((section) => section.title === "Limits & Risks")
      ?.factNames ?? []),
  ]);
  const restrictions = scopedTable.rows
    .filter((row) => riskNames.has(row.factName))
    .flatMap((row) =>
      row.values.map((value, index): SummaryFinding => ({
        id: `risk:${row.factName}:${index}`,
        section: "Limits & Risks",
        kind: "fit",
        label:
          FACTS.find((fact) => fact.name === row.factName)?.label ??
          row.factName,
        sourceValue: value,
        value: value.display,
        planName: table.plans?.find((plan) => plan.planId === value.planId)
          ?.name,
        evidence: value.evidence.map((evidence) => ({
          ...evidence,
          filename:
            table.documents.find((doc) => doc.documentId === value.documentId)
              ?.filename ?? "Document",
        })),
      })),
    );
  const candidates: SummaryFinding[] = [...restrictions, ...overview.items];
  const findings = candidates
    .filter(
      (item) =>
        item.evidence.length > 0 &&
        item.kind !== "unknown" &&
        item.kind !== "unknown-group",
    )
    .sort((a, b) => priorities[a.section] - priorities[b.section])
    .filter((item) => {
      if (labels.has(item.label)) return false;
      labels.add(item.label);
      return true;
    })
    .slice(0, 3);

  return (
    <section
      className="reviewPanel overview"
      aria-label="Personalized overview"
    >
      <header className="reviewTopline">
        <div>
          <span className="eyelabel">The short version</span>
          <h2>What to know first</h2>
        </div>
        <span className="pill">From your documents</span>
      </header>
      {findings.length > 0 ? (
        <div
          className="briefGrid"
          style={{ "--brief-count": findings.length } as React.CSSProperties}
        >
          {findings.map((item, index) => (
            <article className="brief" key={item.id}>
              <span className="eyelabel">
                0{index + 1} · {item.section}
              </span>
              <strong>{item.label}</strong>
              {item.sourceValue ? (
                <>
                  <ConditionalValue
                    value={item.sourceValue}
                    factLabel={item.label}
                    documentName={item.evidence[0]?.filename ?? "Document"}
                    sessionId={sessionId}
                    userContext={userContext}
                  />
                  <div className="overview__meta">{item.planName}</div>
                </>
              ) : (
                <ItemBody item={item} sessionId={sessionId} />
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="emptyDoc">
          There isn&apos;t enough plan-specific evidence for a reliable summary
          yet. Review the document evidence and its applicability warnings
          below. Missing information does not mean no coverage.
        </p>
      )}
    </section>
  );
}
