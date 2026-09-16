import { describe, expect, it } from "vitest";
import { answerQuestion } from "@/app/lib/rag/answer";

const DOCS = [
  {
    documentId: "doc-1",
    filename: "plan-a.pdf",
    pageCount: 1,
    pages: ["Annual deductible: $250 in-network / $500 out-of-network."],
  },
];

describe("retrieval-gated refusal (constitution principle IV)", () => {
  it("answers when passages support the question", () => {
    const res = answerQuestion(DOCS, "What is the deductible?");
    expect(res.kind).toBe("answer");
    if (res.kind === "answer") {
      expect(res.citations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses with the fixed shape when nothing is relevant", () => {
    const res = answerQuestion(DOCS, "Does this cover space tourism?");
    expect(res).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText:
        "The uploaded documents contain no supporting evidence for this question.",
    });
  });

  it("never guesses from an empty document set", () => {
    const res = answerQuestion([], "What is the deductible?");
    expect(res.kind).toBe("refusal");
  });
});
