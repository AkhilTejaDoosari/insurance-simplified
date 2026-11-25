// Generalization fix 6 (2026-11-25): a comparison cell never says "Not stated"
// when the plan's own document states the fact in text that could not be
// bound to the plan. Synthetic text.
import { describe, expect, it } from "vitest";
import { emptyPlanCellText, NOT_CONFIRMED_FOR_PLAN } from "@/app/lib/presentation/adaptive";

const plans = [
  { planId: "p1", name: "A", sources: [{ documentId: "d1", page: 1, quote: "A" }] },
  { planId: "p2", name: "B", sources: [{ documentId: "d2", page: 1, quote: "B" }] },
];
const value = (documentId: string, planId?: string) => ({ documentId, display: "x", qualifiers: {}, evidence: [{ documentId, page: 1, quote: "x", evidenceId: "e" }], ...(planId ? { planId } : {}) });
const table = (values: unknown[], withheld?: unknown[]) => ({ plans, rows: [{ factName: "surgery", verdict: "SUPPORTED", values, ...(withheld ? { withheld } : {}) }] }) as never;

describe("empty comparison cell", () => {
  it("says found but not confirmed for the plan whose document states it", () => {
    expect(emptyPlanCellText(table([value("d1"), value("d2", "p2")]), "surgery", "p1")).toBe(NOT_CONFIRMED_FOR_PLAN);
    expect(emptyPlanCellText(table([], [{ documentId: "d1", page: 1, quote: "x", reason: "label-unrecognized" }]), "surgery", "p1")).toBe(NOT_CONFIRMED_FOR_PLAN);
  });
  it("says not stated when only another document states it", () => {
    expect(emptyPlanCellText(table([value("d2", "p2"), value("d2")]), "surgery", "p1")).toBe("Not stated for this plan.");
    expect(emptyPlanCellText(table([]), "dental-coverage", "p1")).toBe("Not stated for this plan.");
  });
});
