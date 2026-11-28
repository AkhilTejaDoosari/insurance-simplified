import { describe, expect, it } from "vitest";
import { bundleFromEngine } from "@/app/demo/lib/demo-adapter";
import { demoModel, initialNeeds } from "@/app/demo/lib/demo-logic";
import type { V2Document, V2Fact } from "@/app/lib/engine/client";

const CATS = [
  { key: "ded", name: "Deductible", tier: 1, order: 1, explain: "You pay this first." },
  { key: "coins", name: "Coinsurance", tier: 1, order: 4, explain: "You split the bill." },
  { key: "mat", name: "Maternity", tier: 2, order: 6, explain: "Pregnancy care." },
];
const fact = (o: Partial<V2Fact>): V2Fact => ({
  id: "x",
  label: "Deductible",
  column: "",
  state: "couldnt_confirm",
  quote: "$250",
  page: 1,
  categoryKey: null,
  value: null,
  plain: "",
  ...o,
});
const doc = (id: string, facts: V2Fact[], search: Record<string, number | null>): V2Document => ({
  documentId: id,
  filename: `${id}-student-plan.pdf`,
  pages: 4,
  facts,
  openItems: [],
  categories: CATS,
  categorySearch: search,
  checksIncomplete: false,
});

const A = doc(
  "a",
  [
    fact({ id: "a1", column: "In-Network", quote: "$500 per Policy Year", page: 2, categoryKey: "ded" }),
    fact({ id: "a2", label: "Coinsurance", quote: "80%", page: 3, categoryKey: "coins" }),
    fact({ id: "a3", label: "Surgeon's benefit", quote: "$1,000", page: 3 }),
    fact({ id: "a4", label: "Maternity", state: "not_mentioned", page: 1, categoryKey: "mat" }),
  ],
  { mat: null },
);
const B = doc(
  "b",
  [
    fact({
      id: "b1",
      quote: "$250 per Policy Year",
      state: "verified",
      categoryKey: "ded",
      value: { kind: "amount", number: "250", currency: "USD", basis: "per_year", year_kind: "policy", text: null, counts_toward_deductible: null },
      plain: "You pay the first $250 yourself each policy year.",
    }),
    // an unverified fact never shows a plain line, even if one were sent
    fact({ id: "b4", label: "Coinsurance", quote: "80%", page: 2, categoryKey: "coins", plain: "You pay 80%." }),
    fact({ id: "b2", column: "Out-of-Network", quote: "$500", page: 2, categoryKey: "ded" }),
    fact({ id: "b3", label: "Maternity", state: "not_covered", quote: "Pregnancy is not covered", page: 4, categoryKey: "mat" }),
  ],
  { coins: 3 },
);

describe("bundleFromEngine (real engine results in the demo's shape)", () => {
  const { CAT, DOCS, FACTS, PLANS } = bundleFromEngine([A, B]);

  it("maps state, printed words, page and look; no value or plain line unless verified", () => {
    expect(FACTS.a?.ded).toEqual({
      s: "u",
      d: "Check page 2",
      n: 0,
      b: "",
      w: "$500 per Policy Year",
      p: 2,
      pl: "",
      look: "Row Deductible · Column In-Network",
      k: "",
    });
    expect(FACTS.b?.ded).toMatchObject({ s: "v", d: "$250 per year", n: 250, b: "year", w: "$250 per Policy Year" });
    // the engine's own checked line (written from the printed label and quote), verbatim
    expect(FACTS.b?.ded).toMatchObject({ pl: "You pay the first $250 yourself each policy year.", k: "amount" });
    expect(FACTS.b?.coins).toMatchObject({ s: "u", pl: "" });
  });

  it("never turns absence into Not covered", () => {
    expect(FACTS.b?.mat).toMatchObject({ s: "x", d: "Not covered", pl: "" }); // the engine's own state
    expect(FACTS.a?.mat).toBeUndefined(); // not_mentioned fact dropped; search found nothing
    expect(FACTS.a?.coins).toMatchObject({ s: "u", d: "Check page 3" }); // a's own printed fact
    const searched = bundleFromEngine([A, doc("c", [], { coins: 3 })]).FACTS.c?.coins;
    expect(searched).toEqual({ s: "u", d: "Check page 3", n: 0, b: "", w: "", p: 3, pl: "", look: "", k: "" });
  });

  it("keeps unmapped and second facts as plan-specific rows in the document's words", () => {
    const own = Object.entries(CAT).filter(([k]) => k.startsWith("p:"));
    expect(own.map(([, c]) => c)).toEqual([
      [3, "Surgeon's benefit", ""],
      [3, "Deductible (Out-of-Network)", ""],
    ]);
    expect(Object.keys(CAT).slice(0, 3)).toEqual(["ded", "coins", "mat"]); // tier, then order
  });

  it("is one plan per document until levels are read", () => {
    expect(PLANS).toEqual({ a: ["a", "Plan"], b: ["b", "Plan"] });
    expect(DOCS[0]).toMatchObject({ family: "A student plan", file: "a-student-plan.pdf", contacts: [] });
  });

  it("lines plans up on the same category rows", () => {
    const M = demoModel({ CAT, DOCS, FACTS, PLANS });
    expect(M.sections(["a", "b"], 3).all).toEqual(["ded", "coins", "mat"].filter((k) => k !== "mat"));
  });

  it("scores verified values only, exactly like the demo's score()", () => {
    const amount = (n: string, basis: string, kind = "amount") => ({
      kind, number: n, currency: "USD", basis, year_kind: null, text: null, counts_toward_deductible: null,
    }) as V2Fact["value"];
    const v = (id: string, categoryKey: string, value: V2Fact["value"]) =>
      fact({ id, categoryKey, state: "verified", value, quote: "printed", plain: "" });
    const cats = [
      ...CATS,
      { key: "oop", name: "Most you pay in a year", tier: 1, order: 2, explain: "" },
      { key: "er", name: "ER visit", tier: 1, order: 3, explain: "" },
      { key: "pre", name: "Pre-existing", tier: 1, order: 6, explain: "" },
    ];
    const d = (id: string, facts: V2Fact[]) => ({ ...doc(id, facts, {}), categories: cats });
    const P = d("p", [
      v("p1", "ded", amount("250", "per_year")), // <= $500: met (not a must-have)
      v("p2", "oop", amount("6000", "per_year")), // > $5,000: a must-have missed
      v("p3", "er", amount("150", "per_visit")), // can't be told from one value: unknown
      fact({ id: "p4", categoryKey: "pre", state: "couldnt_confirm" }), // unconfirmed: not met
    ]);
    const Q = d("q", [
      v("q1", "ded", amount("100", "per_incident")), // another basis: shown, not scored
      v("q2", "oop", amount("80", "per_year", "percent")), // not an amount: not compared
    ]);
    const M = demoModel(bundleFromEngine([P, Q]));
    const needs = initialNeeds();
    const sp = M.score("p", ["p", "q"], needs);
    expect(sp.li.map((l) => l.mark)).toEqual(["missed", "unknown", "unknown", "met"]);
    expect(sp.miss).toEqual(["Yearly max at most"]);
    // weights: must-have 3, nice 1; met only the deductible (1) of 3+3+3+1
    expect(sp.p).toBe(Math.round((1 / 10) * 100));
    const sq = M.score("q", ["p", "q"], needs);
    expect(sq.li.map((l) => l.mark)).toEqual(["unknown", "unknown", "unknown", "basis"]);
    expect(sq.p).toBe(0);
    expect(sq.li[3].text).toMatch(/different basis \(per illness or injury\), not scored/);
  });
});
