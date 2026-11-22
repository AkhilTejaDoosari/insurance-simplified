// Owner decision 2026-11-21 (5): grid-first chat. A fact question answers
// from the session's re-verified facts with their citations and conditions;
// the model may only rephrase, and a rephrase that fails verifyAnswerClaims
// (or the provider) leaves the exact wording. Anything else falls back to
// retrieval + model. Diagnosed on the local benchmark: stated facts failed
// through prompt truncation, an added paraphrase and a misquote — none of
// which can happen when the answer is the verified fact itself.
// Synthetic text only.
import { describe, expect, it, vi } from "vitest";
import { conceptForQuestion, gridFirstAnswer } from "@/app/lib/chat/grid-first";
import { extractFallback } from "@/app/lib/extraction/extract";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { validateTable } from "@/app/lib/extraction/types";

const PAGE = [
  "SUMMARY SCHEDULE OF BENEFITS",
  "Annual maximum $1,000,000",
  "Deductible1 at the student health center $50",
  "Deductible1 elsewhere $100",
  "Coinsurance in-network 80% of preferred allowance",
  "Coinsurance out-of-network 70% of usual & customary",
  "Emergency room copay (waived if admitted) $300",
  "Maternity Covered as any sickness",
  "Repatriation of remains $50,000",
  "1 Per injury or sickness",
].join("\n");
const DOCS = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [PAGE] }];
const table = () => verifyComparisonTable(validateTable(extractFallback(DOCS, {})), DOCS);

describe("question → one concept", () => {
  it.each([
    ["What is the deductible?", "deductible"],
    ["What is the annual maximum?", "overall-limit"],
    ["What is the coinsurance out of network?", "coinsurance"],
    ["What is the emergency room copay?", "emergency-room"],
    ["Is maternity covered?", "maternity"],
    ["Are pre-existing conditions covered?", "pre-existing"],
    ["What is my out-of-pocket maximum?", "out-of-pocket"],
  ])("%s → %s", (q, concept) => expect(conceptForQuestion(q)?.id).toBe(concept));

  it("an unrelated question maps to nothing", () => {
    expect(conceptForQuestion("Does this cover space tourism?")).toBeUndefined();
  });
});

describe("grid-first answers", () => {
  it("answers a deductible question with the verified lines and the footnote that sets their basis", async () => {
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(r?.kind).toBe("answer");
    if (r?.kind !== "answer") return;
    expect(r.answerText).toContain("Deductible1 at the student health center $50");
    expect(r.answerText).toContain("Deductible1 elsewhere $100");
    expect(r.answerText).toContain("1 Per injury or sickness");
    expect(r.citations.map((c) => c.quote)).toEqual(expect.arrayContaining(["1 Per injury or sickness"]));
    expect(r.grounding).toBe("explicit");
  });

  it("answers the annual maximum and the ER copay verbatim", async () => {
    const max = await gridFirstAnswer({ question: "What is the annual maximum?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(max?.kind === "answer" && max.answerText).toBe("Annual maximum $1,000,000");
    const er = await gridFirstAnswer({ question: "What is the emergency room copay?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(er?.kind === "answer" && er.answerText).toContain("Emergency room copay (waived if admitted) $300");
  });

  it("falls back when the matched facts are not stated", async () => {
    const r = await gridFirstAnswer({ question: "What is my out-of-pocket maximum?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(r).toBeUndefined();
  });

  it("falls back for a question that names no fact", async () => {
    expect(await gridFirstAnswer({ question: "Does this cover space tourism?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS })).toBeUndefined();
  });

  it("falls back when a matched row needs verification (uncertainty is never hidden)", async () => {
    const t = table();
    const row = t.rows.find((r) => r.factName === "policy-limit")!;
    row.verdict = "NEEDS VERIFICATION";
    expect(await gridFirstAnswer({ question: "What is the annual maximum?", table: t, scopedDocuments: DOCS, sessionDocuments: DOCS })).toBeUndefined();
  });

  it("uses only values whose citations verify in the chat scope", async () => {
    const outOfScope = [{ ...DOCS[0], pages: ["(not in the selected scope)"] }];
    expect(await gridFirstAnswer({ question: "What is the annual maximum?", table: table(), scopedDocuments: outOfScope, sessionDocuments: DOCS })).toBeUndefined();
  });
});

describe("the model may only rephrase", () => {
  const ask = (rephrase: Parameters<typeof gridFirstAnswer>[0]["rephrase"]) =>
    gridFirstAnswer({ question: "What is the annual maximum?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS, rephrase });

  it("a rephrase that passes verifyAnswerClaims on the grid citations is used", async () => {
    const r = await ask(async (facts) => ({ answerText: "Annual maximum $1,000,000", citations: facts.citations }));
    expect(r?.kind === "answer" && r.answerText).toBe("Annual maximum $1,000,000");
  });

  it.each([
    ["adds an unsupported claim", async (f: { citations: { documentId: string; page: number; quote: string }[] }) => ({ answerText: "The annual maximum is $1,000,000 and there is no deductible at all for any service.", citations: f.citations })],
    ["changes the figure", async (f: { citations: { documentId: string; page: number; quote: string }[] }) => ({ answerText: "Annual maximum $2,000,000", citations: f.citations })],
    ["cites outside the verified facts", async () => ({ answerText: "Annual maximum $1,000,000", citations: [{ documentId: "doc-1", page: 1, quote: "Maternity Covered as any sickness" }] })],
    ["throws (provider failure)", async () => { throw new Error("LLM request failed with status 503"); }],
  ])("a rephrase that %s is discarded; the exact wording is shown", async (_c, rephrase) => {
    const r = await ask(rephrase as never);
    expect(r?.kind === "answer" && r.answerText).toBe("Annual maximum $1,000,000");
  });

  it("the rephrase call receives only the verified facts", async () => {
    const spy = vi.fn(async (f: { lines: string[]; citations: { quote: string }[] }) => ({ answerText: f.lines.join("\n"), citations: f.citations as never }));
    await ask(spy as never);
    expect(spy.mock.calls[0][0].lines).toEqual(["Annual maximum $1,000,000"]);
  });
});

// Review (2026-11-21, grid-first range): B1–B4, S5–S7.
describe("grid-first review fixes", () => {
  const two = [
    { documentId: "doc-a", filename: "a.pdf", pageCount: 1, pages: ["Plan name: Alpha\nAnnual deductible: $250"] },
    { documentId: "doc-b", filename: "b.pdf", pageCount: 1, pages: ["Plan name: Beta\nAnnual deductible: $900"] },
  ];
  const twoTable = () => verifyComparisonTable(validateTable(extractFallback(two, {})), two);

  it("B3: values from more than one plan/document fall back (never unlabelled)", async () => {
    expect(await gridFirstAnswer({ question: "What is the deductible?", table: twoTable(), scopedDocuments: two, sessionDocuments: two })).toBeUndefined();
  });

  it("B2: a selection keeps only the selected plan's values", async () => {
    const t = twoTable();
    const alpha = t.plans?.find((p) => p.name === "Alpha");
    expect(alpha).toBeDefined();
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: t, scopedDocuments: two, sessionDocuments: two, selection: { planIds: [alpha!.planId], tiers: {} } });
    expect(r?.kind === "answer" && r.answerText).toBe("Annual deductible: $250");
  });

  it("B2: with a selection, a value attributed to no selected plan is not used", async () => {
    const r = await gridFirstAnswer({ question: "What is the annual maximum?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS, selection: { planIds: ["plan-elsewhere"], tiers: {} } });
    expect(r).toBeUndefined();
  });

  it.each(["What is the dental deductible?", "Does the deductible apply to emergency room visits?", "Is Dr Smith in network?"])(
    "B4: an ambiguous or off-concept question falls back: %s",
    async (q) => expect(await gridFirstAnswer({ question: q, table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS })).toBeUndefined(),
  );

  it("S5: a matched row with withheld source lines falls back", async () => {
    const t = table();
    t.rows.find((r) => r.factName === "policy-limit")!.withheld = [{ documentId: "doc-1", page: 1, quote: "Annual maximum $1,000,000", reason: "label-without-value" }];
    expect(await gridFirstAnswer({ question: "What is the annual maximum?", table: t, scopedDocuments: DOCS, sessionDocuments: DOCS })).toBeUndefined();
  });

  it("S7: values that differ by age band fall back (missing context → ask)", async () => {
    const t = table();
    const row = t.rows.find((r) => r.factName === "policy-limit")!;
    row.values = [
      { ...row.values[0], qualifiers: { ...row.values[0].qualifiers, ageBand: "0-49" } },
      { ...row.values[0], qualifiers: { ...row.values[0].qualifiers, ageBand: "50-64" } },
    ];
    expect(await gridFirstAnswer({ question: "What is the annual maximum?", table: t, scopedDocuments: DOCS, sessionDocuments: DOCS })).toBeUndefined();
  });

  it("B1: a rephrase that reverses or drops a condition is discarded", async () => {
    const ask = (text: string) =>
      gridFirstAnswer({ question: "What is the emergency room copay?", table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS, rephrase: async (f) => ({ answerText: text, citations: f.citations }) });
    const dropped = await ask("Emergency room copay $300");
    expect(dropped?.kind === "answer" && dropped.answerText).toBe("Emergency room copay (waived if admitted) $300");
    // Review (third round, B2): coverage keeps the source's word order, so
    // the kept-condition rephrase is in source order (a reordered one now
    // falls back to the exact wording — also safe).
    const kept = await ask("Emergency room copay (waived if admitted): $300");
    expect(kept?.kind === "answer" && kept.answerText).toBe("Emergency room copay (waived if admitted): $300");
    const reordered = await ask("Emergency room copay $300 (waived if admitted)");
    expect(reordered?.kind === "answer" && reordered.answerText).toBe("Emergency room copay (waived if admitted) $300");
  });
});

describe("follow-up review: concept scope and two-plan documents", () => {
  it.each(["What is the deductible for hearing aids?", "What is the coinsurance on orthodontics?"])("%s falls back", (q) => {
    expect(conceptForQuestion(q)).toBeUndefined();
  });

  it("an unattributed value in a document holding two plans is dropped under a selection", async () => {
    const docs = [{ documentId: "doc-m", filename: "m.pdf", pageCount: 1, pages: ["Annual maximum $1,000,000"] }];
    const t = {
      rows: table().rows,
      plans: [
        { planId: "p-1", name: "One", sources: [{ documentId: "doc-m", page: 1, quote: "x" }] },
        { planId: "p-2", name: "Two", sources: [{ documentId: "doc-m", page: 1, quote: "y" }] },
      ],
    };
    t.rows.forEach((r) => r.values.forEach((v) => { v.documentId = "doc-m"; v.evidence.forEach((e) => { e.documentId = "doc-m"; }); delete v.planId; }));
    expect(await gridFirstAnswer({ question: "What is the annual maximum?", table: t, scopedDocuments: docs, sessionDocuments: docs, selection: { planIds: ["p-1"], tiers: {} } })).toBeUndefined();
  });
});

// Owner decision 2026-11-22 (third round, 2): grid-first did not answer
// single-plan documents where some values carry the plan id and others do
// not (observed on two real documents). An unattributed value of a document
// that is the source of exactly one plan belongs to that plan — the same
// ownership rule inSelection already applies.
describe("an unattributed value of a single-plan document belongs to its plan", () => {
  const withPlans = (plans: { planId: string; sources: { documentId: string }[] }[]) => {
    const t = table();
    const row = t.rows.find((r) => r.factName === "per-illness-deductible")!;
    row.values[0] = { ...row.values[0], planId: plans[0].planId };
    return { rows: t.rows, plans };
  };
  it("one plan from the document → one group → answered", async () => {
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: withPlans([{ planId: "plan-1", sources: [{ documentId: "doc-1" }] }]), scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(r?.kind).toBe("answer");
    expect(r?.kind === "answer" && r.answerText).toContain("Deductible1 elsewhere $100");
  });
  it("two plans from the same document → the owner is unknown → falls back", async () => {
    const plans = [{ planId: "plan-1", sources: [{ documentId: "doc-1" }] }, { planId: "plan-2", sources: [{ documentId: "doc-1" }] }];
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: withPlans(plans), scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(r).toBeUndefined();
  });
});

// Review (third round, S3): in a document that is the source of two plans,
// unattributed values have no known owner; shown together they would read as
// one plan's answer. Falls back.
describe("unattributed values of a multi-plan document fall back", () => {
  it("two plans from one document, no plan ids on the values", async () => {
    const t = table();
    const plans = [{ planId: "plan-1", sources: [{ documentId: "doc-1" }] }, { planId: "plan-2", sources: [{ documentId: "doc-1" }] }];
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: { rows: t.rows, plans }, scopedDocuments: DOCS, sessionDocuments: DOCS });
    expect(r).toBeUndefined();
  });
});
