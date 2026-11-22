// Owner decision 2026-11-22: chat citations by reference. The model returns
// the ids of retrieved passages and line ranges; it never types a quote. The
// server fills each quote verbatim from the passage (an exact page slice) and
// verifyAnswerClaims checks every claim against it, unchanged. Plan-name
// header lines are stripped server-side. Synthetic text only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => false),
  embedTexts: vi.fn(async () => []),
}));

import { answerViaLlm, buildRetrievalPrompt, UNCERTAIN_TEXT } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";

const PAGE = [
  "SCHEDULE OF BENEFITS",
  "Maternity: covered medical expenses include charges made by a physician",
  "for pregnancy and childbirth 80% in-network, 70% out-of-network",
  "Deductible per policy period $500",
].join("\n");
const DOCS = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [PAGE] }];

const model = (out: Record<string, unknown>) => vi.mocked(completeJson).mockResolvedValueOnce(out as never);
const promptSent = () => (vi.mocked(completeJson).mock.calls[0]?.[0] as Array<{ content: string }>)[0].content;

beforeEach(() => vi.clearAllMocks());

describe("prompt: passages carry ids and numbered lines", () => {
  it("numbers each passage and each of its lines, page tag kept", () => {
    const prompt = buildRetrievalPrompt(DOCS, [{ documentId: "doc-1", page: 1, chunkId: "c1", quote: PAGE, score: 1 }], "Is maternity covered?");
    expect(prompt).toContain("[Page 1] passage P1\n1| SCHEDULE OF BENEFITS\n2| Maternity: covered");
    expect(prompt).toContain('"passageId"');
    expect(prompt).not.toContain("Each quote MUST be copied exactly");
  });
});

describe("the server fills each quote from the referenced lines", () => {
  it("a line range becomes the verbatim page lines and the answer verifies", async () => {
    model({ cantAnswer: false, answerText: "Deductible per policy period $500", citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind).toBe("answer");
    expect(r.kind === "answer" && r.citations).toEqual([{ documentId: "doc-1", page: 1, quote: "Deductible per policy period $500" }]);
  });

  it("a multi-line range is joined with the page's own line breaks", async () => {
    model({
      cantAnswer: false,
      answerText: "Maternity: covered medical expenses include charges made by a physician for pregnancy and childbirth 80% in-network, 70% out-of-network",
      citations: [{ passageId: "P1", fromLine: 2, toLine: 3 }],
    });
    const r = await answerViaLlm(DOCS, "Is maternity covered?");
    expect(r.kind).toBe("answer");
    expect(r.kind === "answer" && r.citations[0].quote).toBe(PAGE.split("\n").slice(1, 3).join("\n"));
  });

  it("a typed quote from the model is ignored; only the referenced lines count", async () => {
    model({ cantAnswer: false, answerText: "Deductible per policy period $500", citations: [{ passageId: "P1", fromLine: 4, toLine: 4, quote: "Deductible $50" }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind === "answer" && r.citations[0].quote).toBe("Deductible per policy period $500");
  });

  it.each([
    ["unknown passage id", { passageId: "P9", fromLine: 1, toLine: 1 }],
    ["line out of range", { passageId: "P1", fromLine: 4, toLine: 9 }],
    ["reversed range", { passageId: "P1", fromLine: 3, toLine: 2 }],
  ])("%s → cannot be confirmed with passages, never an answer", async (_l, citation) => {
    model({ cantAnswer: false, answerText: "Deductible per policy period $500", citations: [citation] });
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind).toBe("refusal");
    expect(r.kind === "refusal" && r.refusalText).toBe(UNCERTAIN_TEXT);
  });

  it("verification is unchanged: a figure the referenced lines do not state is rejected", async () => {
    model({ cantAnswer: false, answerText: "Deductible per policy period $5,000", citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind).toBe("refusal");
  });
});

describe("plan-name header lines are stripped server-side", () => {
  it("a line naming the plan alone is removed before verification", async () => {
    model({ cantAnswer: false, answerText: "Acme Student Plus\nDeductible per policy period $500", citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?", { planNames: ["Acme Student Plus"] });
    expect(r.kind === "answer" && r.answerText).toBe("Deductible per policy period $500");
  });

  it("a plan-name line with codes in parentheses is also a header", async () => {
    model({ cantAnswer: false, answerText: "Acme Student Plus (ASP) (ASP2)\nDeductible per policy period $500", citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?", { planNames: ["Acme Student Plus"] });
    expect(r.kind === "answer" && r.answerText).toBe("Deductible per policy period $500");
  });

  it("a line with a figure or coverage wording is never stripped", async () => {
    model({ cantAnswer: false, answerText: "Acme Student Plus is not covered\nDeductible per policy period $500", citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?", { planNames: ["Acme Student Plus"] });
    expect(r.kind).toBe("refusal");
  });
});

// Review of 3c51c19 (2026-11-22): B3 header stripping removed condition lines.
describe("review: only a line that is exactly a plan name is stripped", () => {
  it.each([
    "Acme Student Plus members if pre-authorised",
    "Acme Student Plus: never",
    "Acme Student Plus without waiting period",
    "The Acme Student Plus applies outside the home country",
  ])("keeps %s (so the unverifiable line rejects the answer)", async (line) => {
    model({ cantAnswer: false, answerText: `Deductible per policy period $500\n${line}`, citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?", { planNames: ["Acme Student Plus"] });
    expect(r.kind).toBe("refusal");
  });
  it("strips 'The Acme Student Plus:' (exact name, article, colon)", async () => {
    model({ cantAnswer: false, answerText: "The Acme Student Plus:\nDeductible per policy period $500", citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?", { planNames: ["Acme Student Plus"] });
    expect(r.kind === "answer" && r.answerText).toBe("Deductible per policy period $500");
  });
  it("line numbers must be numbers (true/'1' rejected)", async () => {
    model({ cantAnswer: false, answerText: "Deductible per policy period $500", citations: [{ passageId: "P1", fromLine: true, toLine: "4" }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?");
    expect(r.kind).toBe("refusal");
  });
});

// Review (2026-11-22): a passage cut for the prompt budget is cut on a line
// boundary, so a cited line is never half a line.
describe("review: budget truncation keeps whole lines", () => {
  it("never cuts inside a line", async () => {
    const { MAX_CONTEXT_CHARS } = await import("@/app/lib/rag/answer");
    const line = "Benefit line with an exception except when hospitalised; " + "x".repeat(200);
    const quote = Array.from({ length: 400 }, () => line).join("\n");
    const prompt = buildRetrievalPrompt([{ documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: [quote] }], [{ documentId: "doc-1", page: 1, chunkId: "c", quote, score: 1 }], "q");
    expect(prompt.length).toBeLessThan(MAX_CONTEXT_CHARS + 6000);
    const numbered = prompt.split("\n").filter((l) => /^\d+\| /.test(l));
    for (const l of numbered) expect(l.replace(/^\d+\| /, "")).toBe(line);
  });
});

// Third review (2026-11-22): N2 a bracketed condition on a plan-name line was
// dropped with the line. Only code-like brackets are decoration.
describe("third review: bracketed conditions keep the line", () => {
  it.each(["Acme Student Plus (not available in New York)", "Acme Student Plus (excluding dependants)"])("keeps %s", async (line) => {
    model({ cantAnswer: false, answerText: `${line}\nDeductible per policy period $500`, citations: [{ passageId: "P1", fromLine: 4, toLine: 4 }] });
    const r = await answerViaLlm(DOCS, "What is the deductible?", { planNames: ["Acme Student Plus"] });
    expect(r.kind).toBe("refusal");
  });
});
