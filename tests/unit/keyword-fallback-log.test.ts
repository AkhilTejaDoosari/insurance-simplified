// Owner decision 2026-11-21 (2): keep the keyword-search fallback when
// embeddings fail (its outcomes still pass verification) and LOG it —
// error class only, never the question or document text.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/rag/embeddings")>();
  return { ...actual, isEmbeddingConfigured: vi.fn(() => true), embedTexts: vi.fn(async () => { throw new TypeError("fetch failed"); }) };
});

import { answerQuestionSemantic } from "@/app/lib/rag/answer";

describe("keyword fallback on an embedding failure is logged", () => {
  it("logs the fallback with the error class only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const docs = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: ["SCHEDULE OF BENEFITS\nDeductible elsewhere $100"] }];
    const r = await answerQuestionSemantic(docs, "What is the deductible elsewhere?");
    expect(r.kind).toBe("refusal");
    const lines = warn.mock.calls.map((c) => c.join(" ")).filter((l) => l.includes("fallback=lexical"));
    expect(lines).toEqual(["[chat-retrieval] fallback=lexical reason=semantic-error class=TypeError"]);
    warn.mockRestore();
  });
});
