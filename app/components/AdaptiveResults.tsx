"use client";

import React, { useMemo, useState, type ComponentProps } from "react";
import type ComparisonTable from "@/app/components/ComparisonTable";
import { MissingContextPrompt } from "@/app/components/ComparisonTable";
import ConditionalValue from "@/app/components/ConditionalValue";
import VerifyContact from "@/app/components/VerifyContact";
import {
  buildPresentation,
  indexFacts,
  projectView,
  type ActiveView,
  type PresentationFact,
} from "@/app/lib/presentation/adaptive";
import { documentPlanTitle } from "@/app/lib/extraction/plan-names";
import { documentUrl } from "@/app/lib/document-url";
import { FACTS } from "@/app/lib/extraction/fact-list";
import {
  eligibilityMissingField,
  ELIGIBILITY_ROW_NAME,
} from "@/app/lib/extraction/eligibility";

type Props = ComponentProps<typeof ComparisonTable> & {
  view: ActiveView;
  selectionControls?: React.ReactNode;
};
type FactValueOptions = {
  showContext?: boolean;
  whyMatters?: boolean;
  showTierQualifier?: boolean;
};

export default function AdaptiveResults(props: Props) {
  const {
    table,
    view,
    sessionId,
    userContext = {},
    contacts = [],
    onAskFact,
  } = props;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const spec = useMemo(
    () => buildPresentation(table, view, userContext),
    [table, view, userContext],
  );
  const hasComparisonTable = spec.blocks.some(
    (block) => block.type === "comparison-table",
  );
  const facts = useMemo(() => indexFacts(table, view, userContext), [table, view, userContext]);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const projected = projectView(table, view);
  const nameOf = (id: string) =>
    table.plans?.find((p) => p.planId === id)?.name ??
    table.documents.find((d) => d.documentId === id)?.filename ??
    "Document evidence";
  const filenameOf = (id: string) =>
    table.documents.find((d) => d.documentId === id)?.filename ??
    "Source document";
  const stateText = (fact: PresentationFact) =>
    fact.state === "unverified-applicability"
      ? "Unverified applicability — document evidence, not a confirmed plan benefit."
      : fact.state === "conflicting-evidence"
        ? "Conflicting evidence — confirm which value applies."
        : fact.state === "needs-verification"
          ? "Needs verification — check the conditions before relying on this."
          : null;

  function factValue(
    fact: PresentationFact,
    options: FactValueOptions = {},
  ) {
    const {
      showContext = true,
      whyMatters = false,
      showTierQualifier = true,
    } = options;
    const row = table.rows.find((r) => r.factName === fact.concept);
    const contextField = FACTS.find(
      (f) => f.name === fact.concept,
    )?.contextField;
    const missingField = row
      ? ((row.factName === ELIGIBILITY_ROW_NAME
          ? eligibilityMissingField(row, userContext)
          : null) ??
        (contextField && !userContext[contextField]?.trim()
          ? contextField
          : undefined))
      : undefined;
    const interpretations = fact.interpretations.map((item) => (
      <p className="adaptiveUncertainty" key={item.ruleId}>
        <strong>
          {item.kind === "potential-conflict"
            ? "Potential conflict: "
            : item.kind === "unresolved-question"
              ? "Applicability unknown: "
              : "Source context: "}
        </strong>
        {item.statement}
        {item.question && <span className="cell-condition">{item.question}</span>}
      </p>
    ));
    const hasEvidenceBackedExplanation =
      whyMatters &&
      fact.state !== "unverified-applicability" &&
      fact.interpretations.some((item) => item.kind !== "documented-fact");
    return (
      <>
        <ConditionalValue
          value={fact.value}
          factLabel={fact.label}
          documentName={filenameOf(fact.value.documentId)}
          sessionId={sessionId}
          userContext={userContext}
          showTierQualifier={showTierQualifier}
        />
        {hasEvidenceBackedExplanation ? (
          <div className="adaptiveWhy">
            <strong>Why it matters</strong>
            {interpretations}
          </div>
        ) : (
          interpretations
        )}
        {stateText(fact) && (
          <p className="adaptiveUncertainty" role="note">
            {stateText(fact)}
          </p>
        )}
        {showContext && missingField &&
          props.onContextRequestStart &&
          props.onContextRequestEnd &&
          props.onTableUpdate && (
            <MissingContextPrompt
              factName={fact.concept}
              field={missingField}
              sessionId={sessionId}
              onRequestStart={props.onContextRequestStart}
              onRequestEnd={props.onContextRequestEnd}
              onFailed={props.onContextRequestFailure}
              onApplied={(next, field, value, nextContacts, generation) => {
                if (generation === undefined) return;
                props.onContextUpdate?.({ [field]: value }, generation);
                props.onTableUpdate?.(next, nextContacts, generation);
              }}
            />
          )}
      </>
    );
  }
  function evidence(fact: PresentationFact) {
    return (
      <details className="cell-detail">
        <summary>Source wording</summary>
        {fact.value.evidence.map((e) => (
          <blockquote key={e.evidenceId}>
            {e.quote}
            <br />
            <a
              target="_blank"
              rel="noopener"
              href={documentUrl(
                sessionId,
                e.documentId,
                filenameOf(e.documentId),
                e.page,
                e.evidenceId,
              )}
            >
              {filenameOf(e.documentId)} · page {e.page}
            </a>
          </blockquote>
        ))}
      </details>
    );
  }
  function card(fact: PresentationFact, finding = false) {
    return (
      <article
        key={fact.id}
        className={
          finding
            ? `brief adaptiveFinding adaptiveFinding--${/exclu|restrict|eligib/.test(fact.concept) ? "risk" : /cost|premium|deductible|limit/.test(fact.concept) ? "cost" : "detail"}`
            : "adaptiveFact"
        }
      >
        <span className="eyelabel">
          {fact.scope.planIds[0]
            ? nameOf(fact.scope.planIds[0])
            : "Document evidence"}
        </span>
        <h3>{fact.label}</h3>
        {factValue(fact, { showContext: !finding, whyMatters: finding })}
        {!finding && evidence(fact)}
        {onAskFact && (
          <button
            type="button"
          className="btn--link adaptiveAsk"
          aria-label={`Ask about ${fact.label}`}
            onClick={() =>
              onAskFact(
                `What should I verify about ${fact.label.toLowerCase()}?`,
              )
            }
          >
            Ask about this ↗
          </button>
        )}
      </article>
    );
  }
  function comparison(selected: PresentationFact[]) {
    const concepts = [...new Set(selected.map((f) => f.concept))];
    const hasDifferentTierScopes = concepts.some((concept) => {
      const tiers = new Set(
        selected
          .filter((fact) => fact.concept === concept)
          .map((fact) => fact.qualifiers.planTier ?? "__unspecified__"),
      );
      return tiers.size > 1;
    });
    const missingCellCount = concepts.reduce(
      (count, concept) =>
        count +
        view.planIds.filter(
          (id) =>
            !selected.some(
              (fact) =>
                fact.concept === concept && fact.scope.planIds.includes(id),
            ),
        ).length,
      0,
    );
    const showAll = expanded.comparison;
    const visible = showAll ? concepts : concepts.slice(0, 8);
    return (
      <>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Policy comparison; scroll horizontally on small screens"
        >
          <table className="table adaptiveTable">
            <caption className="sr-only">
              Evidence-backed comparison of the selected plans
            </caption>
            <thead>
              <tr>
                <th scope="col">What to compare</th>
                {view.planIds.map((id) => (
                <th key={id} scope="col">
                  {nameOf(id)}
                  {view.tiers[id] ? (
                    <small>Selected tier: {view.tiers[id]}</small>
                  ) : selected.some(
                      (fact) =>
                        fact.scope.planIds.includes(id) &&
                        Boolean(fact.qualifiers.planTier),
                    ) ? (
                    <small>All tiers shown</small>
                  ) : null}
                </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((concept) => (
                <tr key={concept}>
                  <th scope="row">
                    {selected.find((f) => f.concept === concept)!.label}
                  </th>
                  {view.planIds.map((id) => (
                    <td key={id}>
                      {selected.filter(
                        (f) =>
                          f.concept === concept && f.scope.planIds.includes(id),
                      ).length ? (
                        selected
                          .filter(
                            (f) =>
                              f.concept === concept &&
                              f.scope.planIds.includes(id),
                          )
                          .map((f) => {
                            const cellFacts = selected.filter(
                              (candidate) =>
                                candidate.concept === concept &&
                                candidate.scope.planIds.includes(id),
                            );
                            const separateTierGroups =
                              cellFacts.length > 1 &&
                              new Set(
                                cellFacts.map(
                                  (candidate) =>
                                    candidate.qualifiers.planTier ??
                                    "__unspecified__",
                                ),
                              ).size > 1;
                            const tier = f.qualifiers.planTier;
                            const tierLabel = tier
                              ? `${tier} tier`
                              : "Tier not specified in evidence";
                            return (
                              <div
                                className={`adaptiveCell${separateTierGroups ? " adaptiveCell--tiered" : ""}`}
                                key={f.id}
                                {...(separateTierGroups
                                  ? {
                                      role: "group" as const,
                                      "aria-label": `${tierLabel} value`,
                                    }
                                  : {})}
                              >
                                {separateTierGroups && (
                                  <strong className="adaptiveCell__tier-label">
                                    {tierLabel}
                                  </strong>
                                )}
                                {factValue(f, {
                                  showTierQualifier:
                                    !separateTierGroups && !view.tiers[id],
                                })}
                                {evidence(f)}
                              </div>
                            );
                          })
                      ) : (
                        <span className="text-muted">Not stated for this plan.</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasDifferentTierScopes && (
          <p className="reviewNote" role="note">
            Tier-specific values are labeled separately; values from different
            tiers are not directly comparable.
          </p>
        )}
        {missingCellCount > 0 && (
          <p className="reviewNote" role="note">
            Missing information is not a denial of coverage.
          </p>
        )}
        {concepts.length > 8 && (
          <button
            type="button"
            className="btn--link"
            aria-expanded={!!showAll}
            onClick={() =>
              setExpanded((p) => ({
                ...p,
                comparison: !showAll,
              }))
            }
          >
            {showAll
              ? "Show fewer details"
              : `Read all ${concepts.length} comparison dimensions`}
          </button>
        )}
      </>
    );
  }
  return (
    <div className="adaptiveResults" data-view-mode={view.mode}>
      {!hasComparisonTable &&
        spec.blocks[0]?.type !== "finding" &&
        props.selectionControls}
      {spec.blocks.map((block, i) => {
        const selected = block.factIds.map((id) => byId.get(id)!);
        if (block.type === "contact-details")
          return (
            <VerifyContact
              key={i}
              table={projected}
              sessionId={sessionId}
              contacts={contacts.filter((c) =>
                projected.documents.some((d) => d.documentId === c.documentId),
              )}
              planNames={
                new Map(
                  projected.documents.map((d) => [
                    d.documentId,
                    documentPlanTitle(projected, d.documentId),
                  ]),
                )
              }
              selectedPlanIds={
                view.mode === "compare" ? view.planIds : [view.documentId!]
              }
              orderedPlanTitles={
                view.mode === "compare"
                  ? view.planIds.map(nameOf)
                  : [filenameOf(view.documentId!)]
              }
            />
          );
        if (block.type === "evidence-disclosure")
          return (
            <section
              key={i}
              className="reviewPanel"
              aria-label="Document evidence requiring verification"
            >
              <details>
                <summary>
                  <strong>{block.heading}</strong> · {selected.length}{" "}
                  source-backed {selected.length === 1 ? "fact" : "facts"}
                </summary>
                <p className="reviewNote">
              These passages are not assigned to a verified plan. Do not
                  treat them as confirmed benefits or costs.
                </p>
                <div className="adaptiveFacts">
                  {selected.map((f) => card(f))}
                </div>
              </details>
            </section>
          );
        return (
          <React.Fragment key={`${block.type}:${i}`}>
            <section className="reviewPanel" aria-label={block.heading}>
              <div className="reviewTopline">
                <div>
                  <span className="eyelabel">
                    {block.type === "finding"
                      ? "The reading brief"
                      : block.type === "key-value-group"
                        ? "Read it by topic"
                        : "Your policy details"}
                  </span>
                  <h2>{block.heading}</h2>
                </div>
              </div>
              {block.type === "comparison-table" && props.selectionControls}
              {block.type === "finding" && (
                <div className="adaptiveFindings">
                  {selected.map((f) => card(f, true))}
                </div>
              )}
              {block.type === "key-value-group" && (
                <>
                  <div className="adaptiveFacts">
                    {(expanded[block.heading]
                      ? selected
                      : selected.slice(0, block.display.maxVisible)
                    ).map((f) => card(f))}
                  </div>
                  {selected.length > block.display.maxVisible && (
                    <button
                      type="button"
                      className="btn--link"
                      aria-expanded={!!expanded[block.heading]}
                      onClick={() =>
                        setExpanded((p) => ({
                          ...p,
                          [block.heading]: !p[block.heading],
                        }))
                      }
                    >
                      {expanded[block.heading]
                        ? "Show fewer details"
                        : `Read all ${selected.length} details`}
                    </button>
                  )}
                </>
              )}
              {block.type === "comparison-table" && comparison(selected)}
              {block.type === "unresolved-questions" && (
                <>
                  {!facts.length && (
                    <p>
                      No verified structured facts are available for this
                      selection. Check the original policy and ask the insurer;
                      absence here is not a coverage decision.
                    </p>
                  )}
                  <div className="adaptiveFacts">
                    {selected.map((f) => card(f))}
                  </div>
                  {block.display.questions?.map((question) => (
                    <div
                      className="adaptiveContextQuestion"
                      key={`${question.concept}:${question.field}`}
                    >
                      <h3>{question.label} · more context needed</h3>
                      <p className="reviewNote">
                        Tell us the missing detail; we will not assume an
                        answer.
                      </p>
                      {props.onContextRequestStart &&
                        props.onContextRequestEnd &&
                        props.onTableUpdate && (
                          <MissingContextPrompt
                            factName={question.concept}
                            field={question.field}
                            sessionId={sessionId}
                            onRequestStart={props.onContextRequestStart}
                            onRequestEnd={props.onContextRequestEnd}
                            onFailed={props.onContextRequestFailure}
                            onApplied={(
                              next,
                              field,
                              value,
                              nextContacts,
                              generation,
                            ) => {
                              if (generation === undefined) return;
                              props.onContextUpdate?.(
                                { [field]: value },
                                generation,
                              );
                              props.onTableUpdate?.(
                                next,
                                nextContacts,
                                generation,
                              );
                            }}
                          />
                        )}
                    </div>
                  ))}
                </>
              )}
            </section>
            {block.type === "finding" &&
              !hasComparisonTable &&
              props.selectionControls}
          </React.Fragment>
        );
      })}
    </div>
  );
}
