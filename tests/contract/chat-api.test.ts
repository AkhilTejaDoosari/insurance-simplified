import { describe, expect, it } from "vitest";
import { validateChatResponse } from "@/app/lib/rag/answer";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

describe("chat-api v1 contract", () => {
  it("accepts cited answers", () => {
    const res = validateChatResponse({
      schemaVersion: "v1",
      kind: "answer",
      answerText: "The deductible is $250 in-network.",
      citations: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network.", evidenceId: evidenceIdFor("doc-1", 1, "Annual deductible: $250 in-network.") }],
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

  it("rejects citations without a session-bound evidenceId", () => {
    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "The deductible is $250 in-network.",
        citations: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
      })
    ).toThrow(/evidenceId/);
  });
});
