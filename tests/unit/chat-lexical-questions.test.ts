import { describe, expect, it } from "vitest";
import { answerQuestion } from "@/app/lib/rag/answer";

const documents = [
  {
    documentId: "student",
    filename: "StudentSecure.pdf",
    pageCount: 2,
    pages: [
      "StudentSecure tiers\nStudentSecure overview\nStudentSecure coverage\nELITE SELECT BUDGET SMART\nDeductible $0 $0 $0 $0",
      "F-1 visa (including OPT) or a J-1 visa.",
    ],
  },
  {
    documentId: "travel",
    filename: "TravelMedical.pdf",
    pageCount: 1,
    pages: ["Travel Medical Choice\nDeductible Options (You pay) $0 - $5,000"],
  },
];

describe("lexical chat when embeddings are unavailable", () => {
  it("finds the deductible row when the question uses the plural form", () => {
    const answer = answerQuestion([...documents].reverse(), "What are the deductibles for StudentSecure tiers?");
    expect(answer.kind).toBe("answer");
    if (answer.kind === "answer") {
      expect(answer.citations.some((citation) => citation.documentId === "student" && citation.page === 1 && citation.quote.includes("Deductible $0"))).toBe(true);
      expect(answer.citations.every((citation) => citation.documentId === "student")).toBe(true);
    }
  });

  it("cites the source for an F-1 OPT question", () => {
    const answer = answerQuestion(documents, "Does StudentSecure cover F-1 OPT?");
    expect(answer.kind).toBe("answer");
    if (answer.kind === "answer") {
      expect(answer.citations.some((citation) => citation.documentId === "student" && citation.page === 2 && citation.quote.includes("OPT"))).toBe(true);
    }
  });

  it("keeps both sources for a deductible comparison", () => {
    const answer = answerQuestion(documents, "How do the deductibles compare between StudentSecure and Travel Medical?");
    expect(answer.kind).toBe("answer");
    if (answer.kind === "answer") {
      expect(new Set(answer.citations.filter((citation) => citation.quote.includes("Deductible")).map((citation) => citation.documentId))).toEqual(new Set(["student", "travel"]));
    }
  });

  it("refuses an unsupported topic", () => {
    expect(answerQuestion(documents, "Does it cover Martian telemedicine?").kind).toBe("refusal");
  });
});
