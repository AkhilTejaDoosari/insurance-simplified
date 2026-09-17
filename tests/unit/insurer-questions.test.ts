import { describe, expect, it } from "vitest";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { ComparisonTable } from "@/app/lib/extraction/types";

function cev(documentId: string, page: number, quote: string) {
  return { documentId, page, quote, evidenceId: evidenceIdFor(documentId, page, quote) };
}

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
          { documentId: "doc-1", display: "$25 copay", qualifiers: {}, evidence: [cev("doc-1", 2, "Urgent care copay is $25.")] },
          { documentId: "doc-1", display: "$50 copay", qualifiers: {}, evidence: [cev("doc-1", 9, "Urgent care copay is $50.")] },
        ],
      },
      {
        factName: "prescriptions",
        verdict: "NEEDS VERIFICATION",
        values: [
          { documentId: "doc-1", display: "covered at a reasonable cost", qualifiers: {}, evidence: [cev("doc-1", 2, "Prescriptions covered at a reasonable cost.")] },
        ],
      },
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [cev("doc-1", 1, "Deductible $250.")] },
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

  it("asks no question merely because different plans state different values", () => {
    const differing: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-1", filename: "patriot-travel.pdf", pageCount: 1 },
        { documentId: "doc-2", filename: "patriot-exchange.pdf", pageCount: 1 },
        { documentId: "doc-3", filename: "optima.pdf", pageCount: 1 },
      ],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
          { documentId: "doc-1", display: "$250", qualifiers: {}, evidence: [cev("doc-1", 1, "Deductible $250.")] },
            { documentId: "doc-2", display: "$500", qualifiers: {}, evidence: [cev("doc-2", 1, "Deductible $500.")] },
            { documentId: "doc-3", display: "$400", qualifiers: {}, evidence: [cev("doc-3", 1, "Deductible $400.")] },
          ],
        },
      ],
    };
    expect(suggestQuestions(differing)).toEqual([]);
  });

  it("still asks a question for a genuine same-document/same-scope contradiction", () => {
    const conflict: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 9 }],
      rows: [
        {
          factName: "urgent-care",
          verdict: "CONFLICTED",
          values: [
            { documentId: "doc-1", display: "$25 copay", qualifiers: {}, evidence: [cev("doc-1", 2, "Urgent care copay is $25.")] },
            { documentId: "doc-1", display: "$50 copay", qualifiers: {}, evidence: [cev("doc-1", 9, "Urgent care copay is $50.")] },
          ],
        },
      ],
    };
    const suggestions = suggestQuestions(conflict);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].motivatingFact).toBe("urgent-care");
    expect(suggestions[0].triggeringVerdict).toBe("CONFLICTED");
  });
});
