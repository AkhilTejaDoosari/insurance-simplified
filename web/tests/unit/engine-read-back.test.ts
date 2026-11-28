import { describe, expect, it } from "vitest";
import { confirmSavedEngineDocuments } from "@/app/lib/engine/read-back";
import type { V2Document, V2Fact } from "@/app/lib/engine/client";

const value = (n: string) =>
  ({ kind: "amount", number: n, currency: "USD", basis: "per_year", year_kind: null, text: null, counts_toward_deductible: null }) as V2Fact["value"];
const fact = (o: Partial<V2Fact>): V2Fact => ({
  id: "f",
  label: "Deductible",
  column: "",
  state: "verified",
  quote: "$2,500 per Policy Year",
  page: 2,
  categoryKey: "ded",
  value: value("2500"),
  plain: "You pay the first $2,500 yourself each policy year.",
  ...o,
});
const doc = (facts: V2Fact[]): V2Document => ({
  documentId: "d1", filename: "a.pdf", pages: 2, facts, openItems: [], categories: [], categorySearch: {},
});
const SESSION = [{ documentId: "d1", pages: ["Cover page", "Deductible:  $2,500 per\nPolicy Year. Coinsurance 80%"] }];

describe("saved engine results are re-checked before a reload shows them (TB-3 for V2)", () => {
  it("keeps a fact whose words are on its page and whose value is in its quote", () => {
    const [d] = confirmSavedEngineDocuments([doc([fact({})])], SESSION);
    expect(d.facts[0]).toEqual(fact({}));
  });

  it("a value altered after the engine returned it is no longer verified", () => {
    const [d] = confirmSavedEngineDocuments([doc([fact({ value: value("250") })])], SESSION);
    expect(d.facts[0]).toMatchObject({ state: "couldnt_confirm", value: null, plain: "", page: 2 });
  });

  it("a quote that is not printed on its page is no longer verified", () => {
    for (const altered of [fact({ quote: "$0 per Policy Year", value: value("0") }), fact({ page: 1 })]) {
      const [d] = confirmSavedEngineDocuments([doc([altered])], SESSION);
      expect(d.facts[0].state).toBe("couldnt_confirm");
    }
  });

  it("drops documents that are not in the session", () => {
    expect(confirmSavedEngineDocuments([{ ...doc([]), documentId: "other" }], SESSION)).toEqual([]);
  });
});
