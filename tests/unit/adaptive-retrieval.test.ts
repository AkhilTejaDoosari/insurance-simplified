import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/lib/rag/embeddings", () => ({
  isEmbeddingConfigured: () => true,
  embedTexts: vi.fn(),
}));
vi.mock("@/app/lib/rag/persist-session", () => ({
  retrievePersistentSemantic: vi.fn(async () => [
    {
      documentId: "other",
      page: 1,
      chunkId: "foreign",
      quote: "Other plan secret deductible 999",
      score: 1,
    },
    {
      documentId: "a",
      page: 1,
      chunkId: "mixed",
      quote: "Unselected tier secret deductible 777",
      score: 0.99,
    },
    {
      documentId: "a",
      page: 1,
      chunkId: "own",
      quote: "Selected deductible 250",
      score: 0.9,
    },
  ]),
}));
import {
  answerQuestionSemantic,
  buildRetrievalPrompt,
} from "@/app/lib/rag/answer";
const docs = [
  {
    documentId: "a",
    filename: "a.pdf",
    pageCount: 1,
    pages: ["Selected deductible 250"],
  },
];
describe("active-view persistent retrieval boundary", () => {
  it("excludes foreign documents and masked plan spans before answering", async () => {
    const result = await answerQuestionSemantic(docs, "deductible", {
      sessionId: "session",
    });
    expect(result.kind).toBe("answer");
    expect(JSON.stringify(result)).toContain("Selected deductible 250");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("never puts an absent document into a generation prompt", () => {
    const prompt = buildRetrievalPrompt(
      docs,
      [
        {
          documentId: "other",
          page: 1,
          chunkId: "x",
          quote: "PRIVATE FOREIGN TEXT",
          score: 1,
        },
      ],
      "deductible",
    );
    expect(prompt).not.toContain("PRIVATE FOREIGN TEXT");
  });
});
