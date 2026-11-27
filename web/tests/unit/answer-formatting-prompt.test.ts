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

describe("answer-formatting prompt contract (P2 false-refusal fix)", () => {
  it("sends the verification-required formatting rules with the question", async () => {
    vi.clearAllMocks();
    vi.mocked(completeJson).mockResolvedValue({
      cantAnswer: true,
    } as unknown as Record<string, unknown>);

    await answerViaLlm(DOCS, "What is the annual deductible?");

    expect(completeJson).toHaveBeenCalledTimes(1);
    const messages = vi.mocked(completeJson).mock.calls[0]?.[0] as Array<{
      role: string;
      content: string;
    }>;
    const prompt = messages[0]?.content ?? "";

    expect(prompt).toContain("ANSWER FORMATTING (required for verification)");
    expect(prompt).toContain("composed ONLY of words that appear in the passages");
    expect(prompt).toContain("copied exactly (character-for-character)");
    expect(prompt).toContain("Set cantAnswer ONLY when no DOCUMENT block contains");
    expect(prompt).toContain("short label line");
    expect(prompt).toContain("never combine a plan name with values in one sentence");
    expect(prompt).toContain("MUST include a short label line for each");
    expect(prompt).toContain("Question: What is the annual deductible?");
  });
});
