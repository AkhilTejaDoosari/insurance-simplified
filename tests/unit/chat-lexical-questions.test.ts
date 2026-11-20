import { describe, expect, it } from "vitest";
import { answerQuestion, UNCERTAIN_TEXT } from "@/app/lib/rag/answer";

// P0-02 (owner-authorized Phase 4): without a generated answer, lexical chat
// returns "cannot be confirmed" with the cited passages; the retrieval checks
// below are unchanged and now apply to those passages.
const passagesOf = (r: ReturnType<typeof answerQuestion>) => {
  expect(r.kind).toBe("refusal");
  if (r.kind !== "refusal") return [];
  expect(r.refusalText).toBe(UNCERTAIN_TEXT);
  return r.citations ?? [];
};

const documents = [
  {
    documentId: "student",
    filename: "ScholarShield.pdf",
    pageCount: 2,
    pages: [
      "ScholarShield tiers\nScholarShield overview\nScholarShield coverage\nELITE SELECT BUDGET SMART\nDeductible $0 $0 $0 $0",
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
    const citations = passagesOf(answerQuestion([...documents].reverse(), "What are the deductibles for ScholarShield tiers?"));
    expect(citations.some((citation) => citation.documentId === "student" && citation.page === 1 && citation.quote.includes("Deductible $0"))).toBe(true);
    expect(citations.every((citation) => citation.documentId === "student")).toBe(true);
  });

  it("cites the source for an F-1 OPT question", () => {
    const citations = passagesOf(answerQuestion(documents, "Does ScholarShield cover F-1 OPT?"));
    expect(citations.some((citation) => citation.documentId === "student" && citation.page === 2 && citation.quote.includes("OPT"))).toBe(true);
  });

  it("keeps both sources for a deductible comparison", () => {
    const citations = passagesOf(answerQuestion(documents, "How do the deductibles compare between ScholarShield and Travel Medical?"));
    expect(new Set(citations.filter((citation) => citation.quote.includes("Deductible")).map((citation) => citation.documentId))).toEqual(new Set(["student", "travel"]));
  });

  it("refuses an unsupported topic", () => {
    expect(answerQuestion(documents, "Does it cover Martian telemedicine?").kind).toBe("refusal");
  });
});
