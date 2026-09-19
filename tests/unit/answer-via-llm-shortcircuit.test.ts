// R5 Todo 33: empty-retrieval short-circuit — zero LLM call when retrieval empty

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { answerViaLlm } from "@/app/lib/rag/answer";
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
  beforeEach(() => {
    vi.mock("@/app/lib/llm/client", () => ({
      completeJson: vi.fn(),
    }));
    vi.mock("@/app/lib/rag/embeddings", () => ({
      isEmbeddingConfigured: () => true,
      embedTexts: vi.fn(),
    }));
    vi.mock("@/app/lib/rag/chunks", () => ({
      chunkDocument: () => [],
    }));
    vi.mock("@/app/lib/rag/cosine-index", () => ({
      InMemoryCosineIndex: vi.fn().mockImplementation(() => ({
        add: vi.fn(),
        search: () => [],
      })),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns refusal WITHOUT calling completeJson when semantic retrieval returns empty", async () => {
    // Force semantic retrieval to return empty by making embedTexts return empty
    const { embedTexts } = await import("@/app/lib/rag/embeddings");
    vi.mocked(embedTexts).mockResolvedValueOnce([]);

    await answerViaLlm(DOCS, "What is the meaning of life?");

    // completeJson should NOT have been called
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("returns exact refusal text when retrieval empty", async () => {
    const { embedTexts } = await import("@/app/lib/rag/embeddings");
    vi.mocked(embedTexts).mockResolvedValueOnce([]);

    const result = await answerViaLlm(DOCS, "What is the meaning of life?");

    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: "The uploaded documents contain no supporting evidence for this question.",
    });
  });
});