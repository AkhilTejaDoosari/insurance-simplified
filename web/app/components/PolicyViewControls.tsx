"use client";

import React, { useState } from "react";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
import type { ActiveView } from "@/app/lib/presentation/adaptive";
import { planTiers } from "@/app/lib/extraction/selection";
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
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          aria-label="Reset plan order to A to Z"
          onClick={() =>
            onChange({
              ...view,
              planIds: [...view.planIds].sort((a, b) =>
                (plans.find((p) => p.planId === a)?.name ?? a).localeCompare(
                  plans.find((p) => p.planId === b)?.name ?? b,
                ),
              ),
            })
          }
        >
          A–Z reset
        </button>
      </div>
      <fieldset className="adaptiveShortlist plan-picker" aria-label="Select plans to compare">
        <legend className="sr-only">Choose up to three plans</legend>
        {plans.map((p) => (
          <label key={p.planId}>
            <input
              type="checkbox"
              aria-label={`Compare ${p.name}`}
              checked={view.planIds.includes(p.planId)}
              disabled={
                view.planIds.includes(p.planId)
                  ? view.planIds.length <= 2
                  : view.planIds.length >= 3
              }
              onChange={(e) =>
                onChange({
                  ...view,
                  planIds: e.target.checked
                    ? [...view.planIds, p.planId]
                    : view.planIds.filter((id) => id !== p.planId),
                })
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <p className="reviewNote">
        Drag to reorder, use the left/right buttons, or press arrow keys on a
        plan handle. A document can contain more than one independently verified
        plan.
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
              aria-label={`Reorder ${plans.find((p) => p.planId === id)?.name} using left and right arrow keys`}
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
              <strong>{plans.find((p) => p.planId === id)?.name}</strong>
              {tierPicker(id, planTiers(table, id))}
            </div>
            <div className="moveButtons">
              <button
                type="button"
                aria-label={`Move ${plans.find((p) => p.planId === id)?.name} left`}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`Move ${plans.find((p) => p.planId === id)?.name} right`}
                disabled={index === view.planIds.length - 1}
                onClick={() => move(id, 1)}
              >
                →
              </button>
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">
        Plan order:{" "}
        {view.planIds
          .map((id) => plans.find((p) => p.planId === id)?.name)
          .join(", ")}
      </span>
    </div>
  );
}
