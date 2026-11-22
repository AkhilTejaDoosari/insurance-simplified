// P0-02 regression (owner decision 2026-11-20): chat never returns retrieved
// passages as the answer. Without a verified generated answer the outcome is
// an explicit "cannot be confirmed" refusal that carries the relevant cited
// passages (short, page-cited, never a cover or contents page); a question
// with no relevant passage is a plain refusal. A model answer is shown only
// when verifyAnswerClaims passes every sentence and citation. Reproduced on
// the owner's PDFs: answers were up to 12,768 characters of joined passages,
// cited a cover page and a table of contents, and a nonsense question got
// five passages. Synthetic text only.
import { answerCiting } from "../helpers/chat-refs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/rag/embeddings")>();
  return { ...actual, isEmbeddingConfigured: vi.fn(() => false), embedTexts: vi.fn(async () => []) };
});

import {
  answerQuestion,
  answerViaLlm,
  relevantPassages,
  validateChatResponse,
  REFUSAL_TEXT,
  UNCERTAIN_TEXT,
} from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";

const COVER = "Northwind Scholar\nDedicated cover for visiting students\nMeets school requirements";
const CONTENTS = "TABLE OF CONTENTS\nELIGIBILITY .................................. 3\nDEDUCTIBLE ................................... 4\nGEOGRAPHIC AREA .............................. 5";
const BENEFITS = [
  "SCHEDULE OF BENEFITS",
  "Deductible at the student health center $50",
  "Deductible elsewhere $100",
  "Coinsurance in-network 80% of the preferred allowance",
].join("\n");
const AREA = [
  "GEOGRAPHIC AREA OF COVERAGE",
  "Coverage applies worldwide excluding the member's home country.",
  "Treatment received in the home country is not covered.",
].join("\n");
const DOCS = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 4, pages: [COVER, CONTENTS, BENEFITS, AREA] }];

describe("no generated answer: cannot be confirmed, with cited passages (P0-02)", () => {
  it("never returns joined passages as an answer", () => {
    const r = answerQuestion(DOCS, "What is the deductible?");
    expect(r.kind).toBe("refusal");
    if (r.kind !== "refusal") return;
    expect(r.refusalText).toBe(UNCERTAIN_TEXT);
    expect(r.citations?.map((c) => c.page)).toEqual([3]);
    expect(r.citations?.[0].quote).toContain("Deductible at the student health center $50");
  });

  it("does not cite a cover or contents page", () => {
    const r = answerQuestion(DOCS, "What should I verify about geographic restrictions?");
    expect(r.kind).toBe("refusal");
    if (r.kind !== "refusal") return;
    expect(r.refusalText).toBe(UNCERTAIN_TEXT);
    const pages = r.citations?.map((c) => c.page) ?? [];
    expect(pages).not.toContain(1);
    expect(pages).not.toContain(2);
    expect(pages).toContain(4);
  });

  it("a question with no relevant passage is a plain refusal without passages", () => {
    expect(answerQuestion(DOCS, "Does this cover space tourism?")).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });
});

describe("relevantPassages (retrieval hygiene, P0-02)", () => {
  const passage = (page: number, quote: string, documentId = "doc-1") => ({ documentId, page, quote });

  it("drops passages that do not contain a concept of the question", () => {
    const out = relevantPassages([passage(1, COVER), passage(3, BENEFITS)], "What is the deductible?");
    expect(out.map((p) => p.page)).toEqual([3]);
  });

  it("drops navigation (contents) passages even when they name the concept", () => {
    expect(relevantPassages([passage(2, CONTENTS)], "What is the deductible?")).toEqual([]);
  });

  it("narrows a long passage to the verbatim lines around the concept", () => {
    const long = [...Array.from({ length: 30 }, (_, i) => `General provision line ${i} about the plan.`), "Deductible elsewhere $100", "More text."].join("\n");
    const [out] = relevantPassages([passage(3, long)], "What is the deductible?");
    expect(long).toContain(out.quote);
    expect(out.quote).toContain("Deductible elsewhere $100");
    expect(out.quote.length).toBeLessThan(200);
  });

  it("keeps at most three passages, best first, without duplicates", () => {
    const many = [3, 3, 4, 5, 6].map((page) => passage(page, `Deductible amount ${page}`));
    expect(relevantPassages(many, "What is the deductible?").map((p) => p.page)).toEqual([3, 4, 5]);
  });
});

describe("model answers are gated by verifyAnswerClaims (P0-02)", () => {
  it("an answer whose figure is not in its cited passage becomes cannot-be-confirmed with passages", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("The deductible elsewhere is $250.", "Deductible elsewhere $100") as never);
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind).toBe("refusal");
    if (r.kind !== "refusal") return;
    expect(r.refusalText).toBe(UNCERTAIN_TEXT);
    expect(r.citations?.[0].page).toBe(3);
  });

  it("a verified answer is returned as an answer with its citations", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Deductible elsewhere $100", "Deductible elsewhere $100") as never);
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind).toBe("answer");
  });

  it("a model that cannot answer while relevant passages exist yields cannot-be-confirmed", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ cantAnswer: true, answerText: null, citations: null });
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r).toMatchObject({ kind: "refusal", refusalText: UNCERTAIN_TEXT });
  });
});

describe("chat-api v1 additive refusal passages", () => {
  it("accepts a refusal with valid citations and rejects malformed ones", () => {
    expect(validateChatResponse({ schemaVersion: "v1", kind: "refusal", refusalText: UNCERTAIN_TEXT, citations: [{ documentId: "d", page: 2, quote: "q" }] }).kind).toBe("refusal");
    expect(() => validateChatResponse({ schemaVersion: "v1", kind: "refusal", refusalText: UNCERTAIN_TEXT, citations: [{ documentId: "d", page: 0, quote: "q" }] })).toThrow();
  });

// Phase 4 review regressions.
describe("review fixes (Phase 4)", () => {
  const passage = (page: number, quote: string) => ({ documentId: "doc-1", page, quote });

  it("R1: a dot-leader fee schedule is evidence, not a contents page", () => {
    const schedule = "SCHEDULE OF BENEFITS\nAnnual Deductible .............. $500\nOut-of-pocket maximum .......... $3,000";
    expect(relevantPassages([passage(3, schedule)], "What is the deductible?").map((p) => p.page)).toEqual([3]);
    const bare = "SCHEDULE OF BENEFITS\nAnnual Deductible .............. 500\nOffice visit copay ............. 25";
    expect(relevantPassages([passage(3, bare)], "What is the deductible?").map((p) => p.page)).toEqual([3]);
    const docs = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [schedule] }];
    const r = answerQuestion(docs, "What is the deductible?");
    expect(r).toMatchObject({ kind: "refusal", refusalText: UNCERTAIN_TEXT });
  });

  it.each([
    ["What is excluded?", "Exclusions: cosmetic surgery."],
    ["Is there a waiting period?", "You must wait 30 days before benefits begin."],
  ])("R3: word forms match (%s)", (question, quote) => {
    expect(relevantPassages([passage(4, quote)], question)).toHaveLength(1);
  });

  it("R4: 'applies' is not a topic word", () => {
    expect(relevantPassages([passage(4, "The rule applies to everyone.")], "What applies?")).toEqual([]);
  });

  it("R5: narrowing keeps an exception line that follows the concept line", () => {
    const long = [
      ...Array.from({ length: 30 }, (_, i) => `General provision line ${i} about the plan.`),
      "Physiotherapy is payable up to 20 visits.",
      "Visits must be prescribed by a physician.",
      "Visits are paid per session",
      "unless the visits are for a work injury.",
      "More text.",
    ].join("\n");
    const [out] = relevantPassages([passage(5, long)], "Is physiotherapy covered?");
    expect(out.quote).toContain("Physiotherapy is payable up to 20 visits.");
    expect(out.quote).toContain("unless the visits are for a work injury.");
    expect(long).toContain(out.quote);
  });
});
});
