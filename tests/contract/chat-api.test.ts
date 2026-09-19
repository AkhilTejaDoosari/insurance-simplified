import { describe, expect, it } from "vitest";
import { validateChatResponse } from "@/app/lib/rag/answer";

describe("chat-api v1 contract", () => {
  it("accepts cited answers", () => {
    const res = validateChatResponse({
      schemaVersion: "v1",
      kind: "answer",
      answerText: "The deductible is $250 in-network.",
      citations: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
    });
    expect(res.kind).toBe("answer");
  });

  it("accepts fixed refusals with no claims", () => {
    const res = validateChatResponse({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: "The uploaded documents contain no supporting evidence for this question.",
    });
    expect(res.kind).toBe("refusal");
  });

  it("rejects answers without citations (FR-012)", () => {
    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "Trust me.",
        citations: [],
      })
    ).toThrow();
  });

  it("rejects wrong schema versions", () => {
    expect(() =>
      validateChatResponse({ schemaVersion: "v2", kind: "refusal", refusalText: "x" })
    ).toThrow();
  });

  it("accepts legacy answers without grounding (additive, old clients unaffected)", () => {
    const res = validateChatResponse({
      schemaVersion: "v1",
      kind: "answer",
      answerText: "The deductible is $250 in-network.",
      citations: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
    });
    expect(res.kind).toBe("answer");
  });

  it("accepts explicit / related / needs-external grounding", () => {
    for (const grounding of ["explicit", "related", "needs-external"] as const) {
      const res = validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "The deductible is $250 in-network.",
        citations: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
        grounding,
      });
      expect(res.kind).toBe("answer");
    }
  });

  it("rejects unknown grounding values", () => {
    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "The deductible is $250 in-network.",
        citations: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
        grounding: "maybe",
      })
    ).toThrow();
  });

  it("deterministic answers carry explicit grounding", async () => {
    const { answerQuestion } = await import("@/app/lib/rag/answer");
    const res = answerQuestion(
      [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["Annual deductible: $250 in-network."] }],
      "What is the deductible?",
    );
    expect(res.kind).toBe("answer");
    if (res.kind === "answer") expect(res.grounding).toBe("explicit");
  });
});
