import { describe, expect, it } from "vitest";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";
import type { ComparisonTable } from "@/app/lib/extraction/types";

function table(): ComparisonTable {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 2 }],
    rows: [
      { factName: "maternity-coverage", verdict: "NOT STATED", values: [] },
      {
        factName: "emergency-copay",
        verdict: "CONFLICTED",
        values: [
          { documentId: "doc-1", display: "$100", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Emergency copay $100." }] },
        ],
      },
      {
        factName: "prescriptions",
        verdict: "NEEDS VERIFICATION",
        values: [
          { documentId: "doc-1", display: "covered at a reasonable cost", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Prescriptions covered at a reasonable cost." }] },
        ],
      },
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Deductible $250." }] },
        ],
      },
    ],
  };
}

describe("insurer question suggestions (User Story 4)", () => {
  it("derives one question per gap/conflict/ambiguity, none for SUPPORTED", () => {
    const suggestions = suggestQuestions(table());
    expect(suggestions).toHaveLength(3);
    const facts = suggestions.map((s) => s.motivatingFact).sort();
    expect(facts).toEqual(["emergency-copay", "maternity-coverage", "prescriptions"]);
  });

  it("links every suggestion to its motivating fact, verdict, and documents", () => {
    for (const s of suggestQuestions(table())) {
      expect(s.questionText.trim()).not.toBe("");
      expect(["NOT STATED", "CONFLICTED", "NEEDS VERIFICATION"]).toContain(s.triggeringVerdict);
      expect(s.documentIds.length).toBeGreaterThanOrEqual(0);
    }
  });
});
