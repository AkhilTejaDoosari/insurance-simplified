"use client";

import React, { useState } from "react";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
import type { ActiveView } from "@/app/lib/presentation/adaptive";
import {
  MAX_SELECTED_PLANS,
  MIN_COMPARED_PLANS,
  planTiers,
  removeSelectedPlan,
  replaceSelectedPlan,
} from "@/app/lib/extraction/selection";
import { planInventoryOf, UNRESOLVED_PLAN_REASON } from "@/app/lib/extraction/plan-inventory";
import { documentTiers } from "@/app/lib/extraction/tiers";
import { documentPlanTitle } from "@/app/lib/extraction/plan-names";

export default function PolicyViewControls({
  table,
  view,
  onChange,
}: {
  table: Table;
  view: ActiveView;
  onChange: (view: ActiveView) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const plans = table.plans ?? [];
  function tierPicker(id: string, tiers: string[]) {
    return tiers.length ? (
      <label className="adaptiveTier">
        Tier shown
        <select
          aria-label={`Tier shown for ${plans.find((p) => p.planId === id)?.name ?? documentPlanTitle(table, id).name}`}
          value={view.tiers[id] ?? ""}
          onChange={(e) =>
            onChange({
              ...view,
              tiers: { ...view.tiers, [id]: e.target.value || null },
            })
          }
        >
          <option value="">All tiers</option>
          {tiers.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  }
  function move(id: string, direction: number) {
    const order = [...view.planIds],
      index = order.indexOf(id),
      to = index + direction;
    if (index < 0 || to < 0 || to >= order.length) return;
    [order[index], order[to]] = [order[to], order[index]];
    onChange({ ...view, planIds: order });
  }
  if (view.mode === "understand") {
    const own = plans.filter((p) =>
      p.sources.some((s) => s.documentId === view.documentId),
    );
    const selectedPlan = view.planIds[0];
    return (
      <div className="policyPicker">
        <label htmlFor="individual-document">
          Choose which uploaded document to understand
        </label>
        <select
          id="individual-document"
          aria-label="Choose a document for individual reading"
          value={view.documentId}
          onChange={(e) =>
            onChange({
              mode: "understand",
              documentId: e.target.value,
              planIds: plans
                .filter((p) =>
                  p.sources.some((s) => s.documentId === e.target.value),
                )
                .slice(0, 1)
                .map((p) => p.planId),
              tiers: {},
            })
          }
        >
          {table.documents.map((d) => (
            <option key={d.documentId} value={d.documentId}>
              {d.filename}
            </option>
          ))}
        </select>
        {own.length > 0 && (
          <label className="adaptiveTier">
            Plan within this document
            <select
              aria-label="Plan within this document"
              value={selectedPlan ?? ""}
              onChange={(e) =>
                onChange({
                  ...view,
                  planIds: e.target.value ? [e.target.value] : [],
                })
              }
            >
              <option value="">Document evidence only</option>
              {own.map((p) => (
                <option key={p.planId} value={p.planId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedPlan
          ? tierPicker(selectedPlan, planTiers(table, selectedPlan))
          : tierPicker(
              view.documentId!,
              documentTiers(table).get(view.documentId!) ?? [],
            )}
        <p className="reviewNote">
          Switch documents without uploading again. This changes your reading,
          question scope and report.{" "}
          {selectedPlan
            ? `Plan in view: ${plans.find((p) => p.planId === selectedPlan)?.name}.`
            : "Plan applicability is not established; source evidence stays clearly separate."}
        </p>
      </div>
    );
  }
  const filenameOf = (documentId: string) =>
    table.documents.find((d) => d.documentId === documentId)?.filename ?? "Uploaded document";
  // Separately attested plans may share a declared name (different documents,
  // no shared policy id). Show their source file so the choices are distinct.
  const nameOf = (id: string) => {
    const plan = plans.find((p) => p.planId === id);
    if (!plan) return id;
    const collides = plans.some((p) => p.planId !== id && p.name.trim().toLowerCase() === plan.name.trim().toLowerCase());
    return collides ? `${plan.name} (${plan.sources.map((s) => filenameOf(s.documentId)).join(", ")})` : plan.name;
  };
  const unresolved = planInventoryOf(table).filter((entry) => entry.status !== "verified-plan");
  const unselected = plans.filter((p) => !view.planIds.includes(p.planId));
  const full = view.planIds.length >= MAX_SELECTED_PLANS;
  const canRemove = view.planIds.length > MIN_COMPARED_PLANS;
  function withoutTier(id: string) {
    const { [id]: _dropped, ...tiers } = view.tiers;
    return tiers;
  }
  function replace(outgoing: string, incoming: string) {
    const column = view.planIds.indexOf(outgoing) + 1;
    onChange({
      ...view,
      planIds: replaceSelectedPlan(view.planIds, table, outgoing, incoming),
      tiers: withoutTier(outgoing),
    });
    setAnnouncement(`${nameOf(incoming)} replaced ${nameOf(outgoing)} in column ${column}.`);
  }
  function remove(id: string) {
    if (!canRemove) return;
    onChange({ ...view, planIds: removeSelectedPlan(view.planIds, id), tiers: withoutTier(id) });
    setAnnouncement(`${nameOf(id)} removed from the comparison.`);
  }
  function add(id: string) {
    if (full) {
      replace(view.planIds[view.planIds.length - 1], id);
      return;
    }
    onChange({ ...view, planIds: [...view.planIds, id] });
    setAnnouncement(`${nameOf(id)} added to the comparison.`);
  }
  return (
    <div
      className="adaptiveSelection"
      role="group"
      aria-label="Choose and order comparison plans"
    >
      <div className="reviewTopline">
        <div>
          <span className="eyelabel">Your comparison</span>
          <h2>Choose two or three plans</h2>
          <p className="planCount">
            {view.planIds.length} of {plans.length} verified{" "}
            {plans.length === 1 ? "plan" : "plans"} in the comparison ·{" "}
            {table.documents.length} uploaded{" "}
            {table.documents.length === 1 ? "document" : "documents"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          aria-label="Reset plan order to A to Z"
          onClick={() =>
            onChange({
              ...view,
              planIds: [...view.planIds].sort((a, b) =>
                nameOf(a).localeCompare(nameOf(b)),
              ),
            })
          }
        >
          A–Z reset
        </button>
      </div>
      <fieldset className="adaptiveShortlist plan-picker" aria-label="Select plans to compare">
        <legend className="sr-only">Choose up to three plans</legend>
        {plans.map((p) => {
          const selected = view.planIds.includes(p.planId);
          return (
            <label key={p.planId}>
              <input
                type="checkbox"
                aria-label={`Compare ${nameOf(p.planId)}`}
                aria-describedby={selected && !canRemove ? "plan-remove-reason" : full && !selected ? "plan-replace-hint" : undefined}
                checked={selected}
                disabled={selected && !canRemove}
                onChange={(e) => (e.target.checked ? add(p.planId) : remove(p.planId))}
              />
              {nameOf(p.planId)}
            </label>
          );
        })}
      </fieldset>
      {full && unselected.length > 0 && (
        <p className="reviewNote" id="plan-replace-hint">
          Three plans are compared at a time. Choosing another plan replaces
          the plan in the last column, or use “Replace with” on a specific plan.
        </p>
      )}
      {!canRemove && (
        <p className="reviewNote" id="plan-remove-reason">
          A comparison needs at least two plans, so a plan can be replaced but
          not removed right now.
        </p>
      )}
      <p className="reviewNote">
        Drag to reorder, use the left/right buttons, or press arrow keys on a
        plan handle. A document can contain more than one independently verified
        plan.
      </p>
      <p className="reviewNote planAnnouncement" aria-live="polite">
        {announcement}
      </p>
      <div className="planShelf">
        {view.planIds.map((id, index) => (
          <div
            key={id}
            className={`planChip${dragged === id ? " dragged" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragged(id);
              e.dataTransfer.setData("text/plain", id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragged(null)}
            onDragOver={(e) => {
              if (dragged && dragged !== id) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/plain");
              if (!view.planIds.includes(from) || from === id) return;
              const order = view.planIds.filter((p) => p !== from);
              order.splice(index, 0, from);
              onChange({ ...view, planIds: order });
              setDragged(null);
            }}
          >
            <button
              type="button"
              className="handle btn--link"
              aria-label={`Reorder ${nameOf(id)} using left and right arrow keys`}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  move(id, e.key === "ArrowLeft" ? -1 : 1);
                }
              }}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <div>
              <strong>{nameOf(id)}</strong>
              {tierPicker(id, planTiers(table, id))}
              {unselected.length > 0 && (
                <label className="adaptiveTier">
                  Replace with
                  <select
                    aria-label={`Replace ${nameOf(id)} with another plan`}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) replace(id, e.target.value);
                    }}
                  >
                    <option value="">Choose a plan…</option>
                    {unselected.map((p) => (
                      <option key={p.planId} value={p.planId}>
                        {nameOf(p.planId)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="btn--link planRemove"
                aria-label={`Remove ${nameOf(id)} from the comparison`}
                // aria-disabled keeps the button focusable so the reason is
                // announced; remove() itself refuses below two plans.
                aria-describedby={canRemove ? undefined : "plan-remove-reason"}
                aria-disabled={!canRemove}
                onClick={() => remove(id)}
              >
                Remove
              </button>
            </div>
            <div className="moveButtons">
              <button
                type="button"
                aria-label={`Move ${nameOf(id)} left`}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`Move ${nameOf(id)} right`}
                disabled={index === view.planIds.length - 1}
                onClick={() => move(id, 1)}
              >
                →
              </button>
            </div>
          </div>
        ))}
      </div>
      {unresolved.length > 0 && (
        <section
          className="planInventory"
          aria-label="Uploaded documents that cannot be compared as plans"
        >
          <h3>
            {unresolved.length} uploaded{" "}
            {unresolved.length === 1 ? "document isn’t" : "documents aren’t"}{" "}
            available for plan comparison
          </h3>
          <ul>
            {unresolved.map((entry) => (
              <li key={entry.documentId}>
                <strong>{filenameOf(entry.documentId)}</strong>
                <p>{entry.status === "verified-plan" ? null : UNRESOLVED_PLAN_REASON[entry.status]}</p>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() =>
                    onChange({
                      mode: "understand",
                      documentId: entry.documentId,
                      planIds: [],
                      tiers: {},
                    })
                  }
                >
                  Read this document on its own
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <span className="sr-only" role="status">
        Plan order:{" "}
        {view.planIds.map((id) => nameOf(id)).join(", ")}
      </span>
    </div>
  );
}
