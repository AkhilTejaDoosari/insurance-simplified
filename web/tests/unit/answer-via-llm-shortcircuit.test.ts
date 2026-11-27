import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
}));

vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/rag/embeddings")>();
  return {
    ...actual,
    isEmbeddingConfigured: vi.fn(() => false),
    embedTexts: vi.fn(async () => []),
  };
});

import { answerViaLlm, REFUSAL_TEXT } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";

const DOCS = [
  {
    documentId: "doc-1",
    filename: "plan-a.pdf",
    pageCount: 1,
    pages: ["Annual deductible: $250 in-network / $500 out-of-network."],
  },
];

describe("R5 empty-retrieval short-circuit (answerViaLlm)", () => {
  it("returns refusal WITHOUT calling completeJson when retrieval is empty", async () => {
    vi.clearAllMocks();
    const result = await answerViaLlm(DOCS, "What is the meaning of life?");
    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("lexical-empty gate refuses nonsense even when embeddings are healthy", async () => {
    const { answerQuestionSemantic } = await import("@/app/lib/rag/answer");
    vi.clearAllMocks();
    const result = await answerQuestionSemantic(DOCS, "Does this cover space tourism?");
    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });
});
