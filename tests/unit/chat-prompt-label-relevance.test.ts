// Owner directive 2026-11-22 (item 3): diagnose why maternity / geographic
// are not answered. Doc 02 benchmark (semantic retrieval on, Nemotron):
//  - maternity, coinsurance, ER copay: the model quoted the right lines
//    verbatim but prefixed a plan-name label line taken from no cited
//    passage; verifyAnswerClaims (correctly) rejected the uncovered line.
//    The prompt asked for label lines in a single-document chat and offered
//    "filename words", which can never be covered by a citation.
//  - geographic restrictions: the home-country lines were in the prompt
//    (3 of 3 runs) and the model answered cantAnswer each time.
// Fix: prompt rules only; the verifier is unchanged. Synthetic text only.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => false),
  embedTexts: vi.fn(async () => []),
}));

import { answerViaLlm } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";

const DOC = (id: string, name: string) => ({
  documentId: id,
  filename: name,
  pageCount: 1,
  pages: ["Maternity Covered as any sickness. Expenses incurred while in your home country are excluded."],
});

async function promptFor(docs: ReturnType<typeof DOC>[], question: string): Promise<string> {
  vi.clearAllMocks();
  vi.mocked(completeJson).mockResolvedValue({ cantAnswer: true } as unknown as Record<string, unknown>);
  await answerViaLlm(docs, question);
  const messages = vi.mocked(completeJson).mock.calls[0]?.[0] as Array<{ content: string }>;
  return messages[0]?.content ?? "";
}

describe("chat prompt: plan label lines", () => {
  it("one document in the prompt → the model is told to write no name line", async () => {
    const prompt = await promptFor([DOC("doc-1", "plan-a.pdf")], "Is maternity covered?");
    expect(prompt).toContain("With one DOCUMENT block, write no plan or document name line.");
  });

  it("label wording must come from a cited passage; filename words are never offered", async () => {
    const prompt = await promptFor([DOC("doc-1", "plan-a.pdf"), DOC("doc-2", "plan-b.pdf")], "Is maternity covered?");
    expect(prompt).toContain("copy name wording from a passage you cite");
    expect(prompt).not.toContain("filename words");
  });
});

describe("chat prompt: a subject stated in other words is relevant", () => {
  it("tells the model to quote passages that state the subject in different words", async () => {
    const prompt = await promptFor([DOC("doc-1", "plan-a.pdf")], "Is treatment in the home country covered?");
    expect(prompt).toContain("A passage is relevant when it states the subject of the question in different words");
  });
});
