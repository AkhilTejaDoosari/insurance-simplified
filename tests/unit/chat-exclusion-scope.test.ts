// P0-04 regression: exclusion/applicability outcomes attached to a chat reply
// are resolved only for documents in the chat's selection scope. Before the
// fix every registered plan document was resolved, so an answer under plan A
// could carry plan B's outcome. Synthetic fixture.
import { describe, expect, it } from "vitest";
import { resolveExclusionOutcomes } from "@/app/lib/evidence/exclusion-outcomes";
import { exclusionScenario, M7D_DOC } from "../integration/m7d-trust-fixtures";

describe("exclusion outcomes follow the chat selection scope (P0-04)", () => {
  it("resolves a document in the scope", () => {
    const { store, authority } = exclusionScenario();
    expect(resolveExclusionOutcomes(store, authority, "Is acupuncture covered?", { documentIds: [M7D_DOC] }).length).toBeGreaterThan(0);
  });

  it("never resolves a document outside the scope", () => {
    const { store, authority } = exclusionScenario();
    expect(resolveExclusionOutcomes(store, authority, "Is acupuncture covered?", { documentIds: ["another-document"] })).toEqual([]);
  });
});
