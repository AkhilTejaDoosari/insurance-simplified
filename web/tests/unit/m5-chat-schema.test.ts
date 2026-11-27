// Chat LLM call is schema-constrained (EC-9 strict structured output); the
// provider is mocked — no network, no paid call.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/lib/rag/embeddings")>();
  return {
    ...actual,
    isEmbeddingConfigured: vi.fn(() => false),
    embedTexts: vi.fn(async () => []),
  };
});

import {
  answerViaLlm,
  CHAT_ANSWER_SCHEMA,
  REFUSAL_TEXT,
} from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import {
  assertSupportedSchema,
  validateJsonSchema,
} from "@/app/lib/llm/json-schema";

const QUOTE = "Annual deductible: $250 in-network / $500 out-of-network.";
const DOCS = [
  { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1, pages: [QUOTE] },
];

describe("M5 chat call uses strict structured output", () => {
  it("the schema compiles under the supported keyword subset", () => {
    expect(() =>
      assertSupportedSchema(CHAT_ANSWER_SCHEMA.schema),
    ).not.toThrow();
  });

  it("accepts both outcome shapes and rejects off-schema output", () => {
    const s = CHAT_ANSWER_SCHEMA.schema;
    expect(
      validateJsonSchema(s, {
        cantAnswer: true,
        answerText: null,
        citations: null,
      }),
    ).toEqual([]);
    expect(
      validateJsonSchema(s, {
        cantAnswer: false,
        answerText: "Annual deductible: $250 in-network",
        citations: [{ documentId: "doc-1", page: 1, quote: QUOTE }],
      }),
    ).toEqual([]);
    expect(validateJsonSchema(s, { cantAnswer: true })).not.toEqual([]);
    expect(
      validateJsonSchema(s, {
        cantAnswer: false,
        answerText: "x",
        citations: [],
        evidenceId: "e1",
      }),
    ).not.toEqual([]);
    expect(
      validateJsonSchema(s, {
        cantAnswer: false,
        answerText: "x",
        citations: [{ documentId: "d", page: 0, quote: "q" }],
      }),
    ).not.toEqual([]);
  });

  it("passes the schema to completeJson and still validates + verifies the answer", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({
      cantAnswer: false,
      answerText: "Annual deductible: $250 in-network / $500 out-of-network.",
      citations: [{ documentId: "doc-1", page: 1, quote: QUOTE }],
    });
    const result = await answerViaLlm(DOCS, "What is the annual deductible?");
    expect(vi.mocked(completeJson).mock.calls[0][2]).toEqual({
      schema: CHAT_ANSWER_SCHEMA,
    });
    expect(result.kind).toBe("answer");
    expect(JSON.stringify(result)).not.toContain("cantAnswer");
  });

  it("cantAnswer with null fields is a refusal", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({
      cantAnswer: true,
      answerText: null,
      citations: null,
    });
    const result = await answerViaLlm(DOCS, "What is the annual deductible?");
    expect(result).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });

  it("an answer with null citations fails validateChatResponse (never repaired)", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({
      cantAnswer: false,
      answerText: "Annual deductible",
      citations: null,
    });
    await expect(
      answerViaLlm(DOCS, "What is the annual deductible?"),
    ).rejects.toThrow(/citation/);
  });
});
