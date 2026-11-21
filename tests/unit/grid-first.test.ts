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
