import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  answerQuestionSemantic,
  answerViaLlm,
  REFUSAL_TEXT,
} from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import {
  embedTexts,
  isEmbeddingConfigured,
} from "@/app/lib/rag/embeddings";

const mockedConfigured = vi.mocked(isEmbeddingConfigured);
const mockedEmbed = vi.mocked(embedTexts);
const mockedCompleteJson = vi.mocked(completeJson);

// Zero lexical overlap with "What is the deductible?": tokens {deductible}
// vs {zebra, quantum, nebula, harmonizes, gently} -> empty.
const SEMANTIC_ONLY_DOCS = [
  {
    documentId: "doc-1",
    filename: "plan-a.pdf",
    pageCount: 1,
    pages: ["Zebra quantum nebula harmonizes gently."],
  },
];

const LEXICAL_DOCS = [
  {
    documentId: "doc-1",
    filename: "plan-a.pdf",
    pageCount: 1,
    pages: ["Annual deductible is 250 dollars in network."],
  },
];

const QUESTION = "What is the deductible?";

function mockHealthyEmbeddings() {
  mockedConfigured.mockReturnValue(true);
  mockedEmbed.mockImplementation(async (texts: string[]) =>
    texts.map(() => [1, 0]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("P2 semantic-first correction", () => {
  it("(1) lexical-empty + semantic-useful -> answerQuestionSemantic succeeds via semantic", async () => {
    mockHealthyEmbeddings();
    const result = await answerQuestionSemantic(SEMANTIC_ONLY_DOCS, QUESTION);
    expect(mockedEmbed).toHaveBeenCalled();
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") {
      expect(result.citations.length).toBeGreaterThan(0);
    }
  });

  it("(1b) lexical-empty + semantic-useful -> answerViaLlm succeeds via semantic with one LLM call", async () => {
    mockHealthyEmbeddings();
    const page = SEMANTIC_ONLY_DOCS[0].pages[0];
    mockedCompleteJson.mockResolvedValueOnce({
      answerText: page,
      citations: [{ documentId: "doc-1", page: 1, quote: page }],
    });
    const result = await answerViaLlm(SEMANTIC_ONLY_DOCS, QUESTION);
    expect(result.kind).toBe("answer");
    expect(mockedCompleteJson).toHaveBeenCalledTimes(1);
  });

  it("(2) semantic failure + lexical-useful -> lexical fallback succeeds", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedEmbed.mockRejectedValueOnce(new Error("Ollama down"));
    const result = await answerQuestionSemantic(LEXICAL_DOCS, QUESTION);
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") {
      expect(result.citations.length).toBeGreaterThan(0);
    }
  });

  it("(2b) semantic failure + lexical-useful -> answerViaLlm falls back to lexical evidence", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedEmbed.mockRejectedValue(new Error("Ollama down"));
    const page = LEXICAL_DOCS[0].pages[0];
    mockedCompleteJson.mockResolvedValueOnce({
      answerText: page,
      citations: [{ documentId: "doc-1", page: 1, quote: page }],
    });
    const result = await answerViaLlm(LEXICAL_DOCS, QUESTION);
    expect(result.kind).toBe("answer");
    expect(mockedCompleteJson).toHaveBeenCalledTimes(1);
  });

  it("(3) semantic failure + lexical empty -> fixed refusal", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedEmbed.mockRejectedValue(new Error("Ollama down"));
    mockedCompleteJson.mockClear();
    const result = await answerQuestionSemantic(SEMANTIC_ONLY_DOCS, QUESTION);
    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });

  it("(4) final retrieval empty -> zero completeJson calls", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedEmbed.mockRejectedValue(new Error("Ollama down"));
    const result = await answerViaLlm(SEMANTIC_ONLY_DOCS, QUESTION);
    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
    expect(mockedCompleteJson).not.toHaveBeenCalled();
  });

  it("(4b) unconfigured + lexical empty -> zero completeJson calls", async () => {
    mockedConfigured.mockReturnValue(false);
    const result = await answerViaLlm(SEMANTIC_ONLY_DOCS, QUESTION);
    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
    expect(mockedCompleteJson).not.toHaveBeenCalled();
  });
});
