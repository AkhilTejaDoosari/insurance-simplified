// Owner decision 2026-11-22 (third round, 2): every "cannot be confirmed"
// records why — a closed reason code (logged) and the rejected sentence
// (diagnostics callback only; operations.md forbids document text, quotes
// and questions in logs). Synthetic text only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => false),
}));

import { verifyAnswerClaims } from "@/app/lib/evidence-verification";
import { answerViaLlm, type ChatRejection } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import { answerCiting } from "../helpers/chat-refs";

function reason(answer: string, pageLines: string[]) {
  const page = pageLines.join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  return verifyAnswerClaims(answer, [{ documentId: "doc-1", page: 1, quote: page }], [{ documentId: "doc-1", page: 1, quote: page }], docs);
}

describe("verifyAnswerClaims names the failed check", () => {
  it.each([
    ["words-not-in-citations", "Dental is covered in full.", ["Vision: $50 per exam."]],
    ["qualifier-mismatch", "Dental treatment is covered.", ["Dental treatment is not covered."]],
    ["figure-label-binding", "Specialist $30", ["Primary care $30 Specialist $60"]],
    ["wrapped-fragment", "Emergency room: $250 copay", ["Emergency room: $250 copay", "after deductible is met"]],
    ["figure-not-in-covering-line", "Vision exams cost $75.", ["Vision exams cost $50."]],
  ])("%s", (code, answer, page) => {
    const r = reason(answer, page);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(code);
    expect(r.sentence).toBe(answer);
    expect(r.sentenceIndex).toBe(1);
  });
  it("a citation that is not on its page", () => {
    const docs = [{ documentId: "doc-1", pages: ["Vision: $50 per exam."] }];
    const c = [{ documentId: "doc-1", page: 1, quote: "Vision: $60 per exam." }];
    expect(verifyAnswerClaims("Vision: $60 per exam.", c, c, docs).reason).toBe("citation-not-on-page");
  });
});

describe("answerViaLlm: reason logged, sentence only to the callback", () => {
  const PAGE = ["BENEFITS", "Emergency room: $250 copay", "after deductible is met", "Dental treatment is not covered."].join("\n");
  const DOCS = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [PAGE] }];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("a rejected sentence: code and position in the log, text only in the callback", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Emergency room: $250 copay", "Emergency room: $250 copay") as never);
    const seen: ChatRejection[] = [];
    const r = await answerViaLlm(DOCS, "What is the emergency room copay?", { onRejection: (d) => seen.push(d) });
    expect(r.kind).toBe("refusal");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ stage: "verify", reason: "wrapped-fragment", sentence: "Emergency room: $250 copay", sentenceIndex: 1 });
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("reason=wrapped-fragment sentence=1/1");
    expect(logged).not.toContain("$250");
    expect(logged).not.toContain("Emergency room");
  });

  it("a model refusal is reported as its own stage", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ cantAnswer: true, answerText: null, citations: null } as never);
    const seen: ChatRejection[] = [];
    await answerViaLlm(DOCS, "Is dental treatment covered?", { onRejection: (d) => seen.push(d) });
    expect(seen).toEqual([{ stage: "model-cannot-answer" }]);
  });
});
