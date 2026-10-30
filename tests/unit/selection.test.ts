import { describe, expect, it } from "vitest";
import { alphabeticalPlanIds, createSelection, moveSelectedPlan, reconcileSelection, resetPlanOrder, selectPlan, selectTier, selectDocumentTier, selectedPlanIds, selectionKey, setSection, setSelectedPlanIds, planTiers, planDocuments } from "@/app/lib/extraction/selection";
import type { ComparisonTable } from "@/app/lib/extraction/types";

const source = (documentId: string, name: string) => ({ documentId, page: 1, quote: `Policy name: ${name}` });
const table: ComparisonTable = {
  schemaVersion: "v1", factListVersion: "v1", documents: [
    { documentId: "a", filename: "same.pdf", pageCount: 1 },
    { documentId: "b", filename: "same.pdf", pageCount: 1 },
  ],
  plans: [
    { planId: "alpha", name: "Alpha", sources: [source("a", "Alpha")] },
    { planId: "beta", name: "Beta", sources: [source("a", "Beta")] },
    { planId: "gamma", name: "Gamma", sources: [source("b", "Gamma")] },
  ],
  rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [
    { documentId: "a", planId: "alpha", display: "$500", qualifiers: { planTier: "Lite" }, evidence: [source("a", "Alpha")] },
    { documentId: "a", planId: "alpha", display: "$750", qualifiers: { planTier: "Gold" }, evidence: [source("a", "Alpha")] },
    { documentId: "b", planId: "gamma", display: "$900", qualifiers: { planTier: "Plus" }, evidence: [source("b", "Gamma")] },
  ] }],
};

describe("effective selection", () => {
  it("changes one plan tier without changing another, facts, or top-level view count", () => {
    const before = structuredClone(table);
    const initial = createSelection(table, "fingerprint-A");
    const chosen = selectTier(selectPlan(initial, table, "a", "alpha"), table, "alpha", "Gold");
    const other = selectTier(chosen, table, "gamma", "Plus");
    expect(other.tiers).toEqual({ alpha: "Gold", gamma: "Plus" });
    expect(Object.keys(other.planByDocument)).toEqual(["a", "b"]);
    expect(table).toEqual(before);
    expect(selectTier(other, table, "alpha", null).tiers.gamma).toBe("Plus");
  });

  it("maps an actual document tier control to its uniquely evidenced plan without changing another plan", () => {
    const onePlanPerDocument = { ...table, plans: [table.plans![0], table.plans![2]] };
    const chosen = selectDocumentTier(createSelection(onePlanPerDocument, "v1"), onePlanPerDocument, "a", "Gold");
    const both = selectDocumentTier(chosen, onePlanPerDocument, "b", "Plus");
    expect(both.tiers).toEqual({ alpha: "Gold", gamma: "Plus" });
    expect(both.legacyTiersByDocument).toEqual({ a: "Gold", b: "Plus" });
    expect(selectDocumentTier(both, onePlanPerDocument, "a", null).tiers).toEqual({ alpha: null, gamma: "Plus" });
  });

  it("does not assign a plan from a filename and rejects alien tiers", () => {
    const legacy = { ...table, plans: undefined };
    // Legacy tables without proven plans use each document as its own synthetic plan view.
    expect(createSelection(legacy, "legacy").planByDocument).toEqual({ a: "a", b: "b" });
    const initial = selectPlan(createSelection(table, "v1"), table, "a", "alpha");
    expect(() => selectTier(initial, table, "alpha", "Plus")).toThrow(/tier/);
    expect(() => selectPlan(initial, table, "a", "gamma")).toThrow(/plan/);
  });

  it("retains document-scoped legacy tiers only while the verified result is unchanged", () => {
    const legacy = { ...table, plans: undefined };
    const choice = selectDocumentTier(createSelection(legacy, "v1"), legacy, "a", "Gold");
    expect(reconcileSelection(choice, legacy, "v1").legacyTiersByDocument.a).toBe("Gold");
    expect(reconcileSelection(choice, legacy, "v2").legacyTiersByDocument.a).toBeUndefined();
    expect(() => selectDocumentTier(choice, legacy, "a", "Plus")).toThrow(/tier/);
  });

  it("keeps section changes independent while plan changes and replacements invalidate stale choices and keys", () => {
    const selected = selectTier(selectPlan(createSelection(table, "v1"), table, "a", "alpha"), table, "alpha", "Lite");
    const section = setSection(selected, "My Costs");
    expect(section.tiers.alpha).toBe("Lite");
    expect(selectionKey(section)).not.toBe(selectionKey(selected));
    const switched = selectPlan(selected, table, "a", "beta");
    expect(switched.tiers.alpha).toBeUndefined();
    expect(selectPlan(selectDocumentTier(selected, table, "a", "Gold"), table, "a", "beta").legacyTiersByDocument.a).toBeUndefined();
    const replaced = reconcileSelection(selected, { ...table, documents: [table.documents[1]], plans: [table.plans![2]], rows: [] }, "v2");
    expect(replaced.planByDocument).toEqual({ b: "gamma" });
    expect(replaced.tiers.alpha).toBeUndefined();
    expect(selectionKey(replaced)).not.toBe(selectionKey(selected));
  });

  it("counts one sourced plan across two documents as one logical view", () => {
    const shared: ComparisonTable = { ...table, plans: [{ planId: "shared", name: "Alpha", policyIdentifier: "ABC-123", sources: [source("a", "Alpha"), source("b", "Alpha")] }] };
    expect(selectedPlanIds(createSelection(shared, "v1"))).toEqual(["shared"]);
  });

  it("preserves only still-valid plan and tier choices after a context-only result refresh", () => {
    const chosen = selectTier(selectPlan(createSelection(table, "before"), table, "a", "alpha"), table, "alpha", "Gold");
    const withOther = selectTier(chosen, table, "gamma", "Plus");
    const refreshed = reconcileSelection(withOther, table, "after", { contextOnly: true });
    expect(refreshed.planByDocument).toEqual({ a: "alpha", b: "gamma" });
    expect(refreshed.tiers).toEqual({ alpha: "Gold", gamma: "Plus" });
    expect(refreshed.resultFingerprint).toBe("after");
    expect(selectionKey(refreshed)).not.toBe(selectionKey(withOther));

    const noGold = { ...table, rows: [{ ...table.rows[0], values: table.rows[0].values.filter((v) => v.qualifiers.planTier !== "Gold") }] };
    expect(reconcileSelection(withOther, noGold, "after", { contextOnly: true }).tiers.alpha).toBeUndefined();
    expect(reconcileSelection(withOther, noGold, "after").tiers).toEqual({});
  });

  it("maintains a plan shortlist of at most three selected proven plans", () => {
    const manyPlans: ComparisonTable = {
      ...table,
      plans: [
        { planId: "p1", name: "One", sources: [source("a", "One")] },
        { planId: "p2", name: "Two", sources: [source("a", "Two")] },
        { planId: "p3", name: "Three", sources: [source("b", "Three")] },
        { planId: "p4", name: "Four", sources: [source("b", "Four")] },
      ],
      rows: [],
    };
    const initial = createSelection(manyPlans, "v1");
    expect(initial.selectedPlanIds.length).toBeLessThanOrEqual(3);
    const selected = setSelectedPlanIds(initial, manyPlans, ["p2", "p4", "p3"]);
    expect(selected.selectedPlanIds).toEqual(["p2", "p4", "p3"]);
    expect(() => setSelectedPlanIds(selected, manyPlans, ["p1", "p2", "p3", "p4"])).toThrow(/At most 3/);
    expect(() => setSelectedPlanIds(selected, manyPlans, ["p1", "unknown"])).toThrow(/plan/);
  });

  it("lists document and tiers for a proven plan independently of the shortlist", () => {
    expect(planDocuments(table, "alpha")).toEqual(["a"]);
    expect(planDocuments(table, "gamma")).toEqual(["b"]);
    expect(planTiers(table, "alpha")).toEqual(["Lite", "Gold"]);
    expect(planTiers(table, "gamma")).toEqual(["Plus"]);
  });

  it("invalidates selected plan and tier choices that no longer exist after reconcile", () => {
    const selected = setSelectedPlanIds(
      selectTier(selectPlan(createSelection(table, "v1"), table, "a", "alpha"), table, "alpha", "Gold"),
      table,
      ["alpha"],
    );
    const reduced = reconcileSelection(selected, { ...table, plans: [table.plans![2]], rows: [] }, "v2");
    expect(reduced.selectedPlanIds).toEqual(["gamma"]);
    expect(reduced.tiers.alpha).toBeUndefined();
  });

  it("defaults proven plans to verified alphabetical order (Phase C)", () => {
    const unordered: ComparisonTable = {
      ...table,
      plans: [
        { planId: "zeta", name: "Zeta Plan", sources: [source("a", "Zeta Plan")] },
        { planId: "alpha", name: "Alpha Plan", sources: [source("a", "Alpha Plan")] },
        { planId: "mid", name: "Mid Plan", sources: [source("b", "Mid Plan")] },
      ],
      rows: [],
    };
    expect(alphabeticalPlanIds(unordered)).toEqual(["alpha", "mid", "zeta"]);
    expect(createSelection(unordered, "v1").selectedPlanIds).toEqual(["alpha", "mid", "zeta"]);
  });

  it("moves a selected plan left and right without changing the plan set or tiers", () => {
    const initial = createSelection(table, "v1"); // alpha, beta, gamma
    const movedRight = moveSelectedPlan(initial, "alpha", "right");
    expect(movedRight.selectedPlanIds).toEqual(["beta", "alpha", "gamma"]);
    const movedBack = moveSelectedPlan(movedRight, "alpha", "left");
    expect(movedBack.selectedPlanIds).toEqual(["alpha", "beta", "gamma"]);
    const two = setSelectedPlanIds(initial, table, ["alpha", "gamma"]);
    const swapped = moveSelectedPlan(two, "alpha", "right");
    expect(swapped.selectedPlanIds).toEqual(["gamma", "alpha"]);
    expect(new Set(swapped.selectedPlanIds)).toEqual(new Set(["alpha", "gamma"]));
    expect(swapped.tiers).toEqual(initial.tiers);
    // Edge moves are no-ops.
    expect(moveSelectedPlan(initial, "alpha", "left") === initial).toBe(true);
    expect(moveSelectedPlan(initial, "gamma", "right") === initial).toBe(true);
    // Moving a plan that is not selected changes nothing.
    const subset = setSelectedPlanIds(createSelection(table, "v1"), table, ["alpha", "beta"]);
    expect(moveSelectedPlan(subset, "gamma", "left") === subset).toBe(true);
  });

  it("preserves manual order across tier changes and context-only refreshes", () => {
    const reordered = moveSelectedPlan(moveSelectedPlan(createSelection(table, "v1"), "alpha", "right"), "gamma", "left");
    expect(reordered.selectedPlanIds).toEqual(["beta", "gamma", "alpha"]);
    const withTier = selectTier(reordered, table, "gamma", "Plus");
    expect(withTier.selectedPlanIds).toEqual(["beta", "gamma", "alpha"]);
    const refreshed = reconcileSelection(withTier, table, "v1", { contextOnly: true });
    expect(refreshed.selectedPlanIds).toEqual(["beta", "gamma", "alpha"]);
  });

  it("resets a manual order back to the verified A–Z default while keeping the same plan set", () => {
    const shortlist = setSelectedPlanIds(createSelection(table, "v1"), table, ["gamma", "alpha"]);
    const manual = moveSelectedPlan(shortlist, "gamma", "left");
    expect(manual.selectedPlanIds).toEqual(["gamma", "alpha"]);
    const reset = resetPlanOrder(manual, table);
    expect(reset.selectedPlanIds).toEqual(["alpha", "gamma"]);
    expect(reset.tiers).toEqual(manual.tiers);
  });
});
