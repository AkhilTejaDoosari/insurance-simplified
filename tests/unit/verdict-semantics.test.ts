import { describe, expect, it } from "vitest";
import {
  extractFallback,
  hasSameScopeContradiction,
  unresolvedDisagreements,
  type ExtractInputDocument,
} from "@/app/lib/extraction/extract";
import type { ComparisonTable } from "@/app/lib/extraction/types";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";

const doc = (documentId: string, ...lines: string[]): ExtractInputDocument => ({
  documentId,
  filename: `${documentId}.pdf`,
  pageCount: 1,
  pages: [lines.join("\n")],
});

describe("comparison verdict semantics (cross-plan differences are data, not conflict)", () => {
  it("$250 vs $500 across two different plans is SUPPORTED", () => {
    const table = extractFallback(
      [doc("doc-1", "Annual deductible: $250."), doc("doc-2", "Annual deductible: $500.")],
      {}
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.values).toHaveLength(2);
  });

  it("range vs fixed amount across different documents is SUPPORTED", () => {
    const table = extractFallback(
      [
        doc("doc-1", "Annual deductible: $0 to $2,500."),
        doc("doc-2", "Annual deductible: $400."),
      ],
      {}
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.values).toHaveLength(2);
  });

  it("Lite / Plus / Platinum differences across plans are SUPPORTED", () => {
    const table = extractFallback(
      [
        doc("doc-1", "Annual deductible: $250 (Lite)."),
        doc("doc-2", "Annual deductible: $250 (Plus)."),
        doc("doc-3", "Annual deductible: $500 (Platinum)."),
      ],
      {}
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.values).toHaveLength(3);
  });

  it("Basic vs Enhanced tier figures across documents are SUPPORTED", () => {
    const table = extractFallback(
      [
        doc("doc-1", "Annual out-of-pocket maximum: $3,000 (Basic)."),
        doc("doc-2", "Annual out-of-pocket maximum: $6,000 (Enhanced)."),
      ],
      {}
    );
    const row = table.rows.find((r) => r.factName === "out-of-pocket-maximum");
    expect(row?.verdict).toBe("SUPPORTED");
  });

  it("different network tiers across documents are not a conflict", () => {
    const table = extractFallback(
      [
        doc("doc-1", "Annual deductible: $250 in-network."),
        doc("doc-2", "Annual deductible: $500 out-of-network."),
      ],
      {}
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.verdict).not.toBe("CONFLICTED");
  });

  it("vague-only evidence is NEEDS VERIFICATION", () => {
    const table = extractFallback(
      [doc("doc-1", "Prescription coverage: covered at a reasonable cost.")],
      {}
    );
    const row = table.rows.find((r) => r.factName === "prescriptions");
    expect(row?.verdict).toBe("NEEDS VERIFICATION");
  });

  it("no evidence anywhere is NOT STATED with empty values", () => {
    const table = extractFallback(
      [doc("doc-1", "Annual deductible: $250."), doc("doc-2", "Annual deductible: $500.")],
      {}
    );
    const row = table.rows.find((r) => r.factName === "maternity-coverage");
    expect(row?.verdict).toBe("NOT STATED");
    expect(row?.values).toEqual([]);
  });

  it("user context ruling a plan out is DOES NOT APPEAR TO FIT with a rationale naming the field", () => {
    const table = extractFallback(
      [doc("doc-1", "International student eligibility: must hold a valid F-1 visa.")],
      { visaOrStatus: "H-1B" }
    );
    const row = table.rows.find((r) => r.factName === "student-eligibility");
    expect(row?.verdict).toBe("DOES NOT APPEAR TO FIT");
    expect(row?.rationale).toContain("visaOrStatus");
  });

  it("plan differences generate no insurer question for that fact", () => {
    const table = extractFallback(
      [doc("doc-1", "Annual deductible: $250."), doc("doc-2", "Annual deductible: $500.")],
      {}
    );
    const questions = suggestQuestions(table);
    expect(questions.map((q) => q.motivatingFact)).not.toContain("annual-deductible");
  });
});

describe("unresolved cross-document disagreement (traceable, never CONFLICTED)", () => {
  it("reports both documents' citations for a same-scope difference instead of a conflict", () => {
    const table = extractFallback(
      [
        doc("doc-1", "Annual deductible: $0 or $250."),
        doc("doc-2", "Annual deductible: $0 or $500."),
      ],
      {}
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.verdict).not.toBe("CONFLICTED");

    const disagreements = unresolvedDisagreements(table);
    const d = disagreements.find((x) => x.factName === "annual-deductible");
    expect(d).toBeDefined();
    expect(d!.sources.map((s) => s.documentId)).toEqual(["doc-1", "doc-2"]);
    for (const source of d!.sources) {
      expect(source.page).toBeGreaterThanOrEqual(1);
      expect(source.quote.length).toBeGreaterThan(0);
      expect(source.display.length).toBeGreaterThan(0);
    }
  });

  it("reports nothing when the values agree across documents", () => {
    const table = extractFallback(
      [doc("doc-1", "Annual deductible: $250."), doc("doc-2", "Annual deductible: $250.")],
      {}
    );
    expect(unresolvedDisagreements(table)).toEqual([]);
  });

  it("reports nothing across different qualifier scopes — tier/network differences are comparison data", () => {
    const scoped: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-1", filename: "a.pdf", pageCount: 1 },
        { documentId: "doc-2", filename: "b.pdf", pageCount: 1 },
      ],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250",
              qualifiers: { planTier: "Lite" },
              evidence: [{ documentId: "doc-1", page: 1, quote: "Deductible $250 (Lite)" }],
            },
            {
              documentId: "doc-2",
              display: "$500",
              qualifiers: { planTier: "Platinum" },
              evidence: [{ documentId: "doc-2", page: 1, quote: "Deductible $500 (Platinum)" }],
            },
          ],
        },
      ],
    };
    expect(unresolvedDisagreements(scoped)).toEqual([]);
  });

  it("does not double-report a genuine same-document contradiction (that row is CONFLICTED)", () => {
    const conflicted: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-1", filename: "a.pdf", pageCount: 1 },
        { documentId: "doc-2", filename: "b.pdf", pageCount: 1 },
      ],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "CONFLICTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Deductible $250" }],
            },
            {
              documentId: "doc-1",
              display: "$500",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 2, quote: "Deductible $500" }],
            },
            {
              documentId: "doc-2",
              display: "$750",
              qualifiers: {},
              evidence: [{ documentId: "doc-2", page: 1, quote: "Deductible $750" }],
            },
          ],
        },
      ],
    };
    expect(unresolvedDisagreements(conflicted)).toEqual([]);
  });

  it("skips differences between two proven plans (ordinary comparison data)", () => {
    const proven: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-1", filename: "a.pdf", pageCount: 1 },
        { documentId: "doc-2", filename: "b.pdf", pageCount: 1 },
      ],
      plans: [
        {
          planId: "plan-a",
          name: "Alpha",
          sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
        },
        {
          planId: "plan-b",
          name: "Beta",
          sources: [{ documentId: "doc-2", page: 1, quote: "Plan name: Beta" }],
        },
      ],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              planId: "plan-a",
              display: "$250",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Alpha deductible $250" }],
            },
            {
              documentId: "doc-2",
              planId: "plan-b",
              display: "$500",
              qualifiers: {},
              evidence: [{ documentId: "doc-2", page: 1, quote: "Beta deductible $500" }],
            },
          ],
        },
      ],
    };
    expect(unresolvedDisagreements(proven)).toEqual([]);
  });

  it("does not hide a same-plan cross-document disagreement when another plan is present", () => {
    const table: ComparisonTable = {
      schemaVersion: "v1", factListVersion: "v1",
      documents: ["a", "b", "c"].map((documentId) => ({ documentId, filename: `${documentId}.pdf`, pageCount: 1 })),
      rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [
        { documentId: "a", planId: "same", display: "$250", qualifiers: {}, evidence: [{ documentId: "a", page: 1, quote: "Deductible $250" }] },
        { documentId: "b", planId: "other", display: "$500", qualifiers: {}, evidence: [{ documentId: "b", page: 1, quote: "Deductible $500" }] },
        { documentId: "c", planId: "same", display: "$750", qualifiers: {}, evidence: [{ documentId: "c", page: 2, quote: "Deductible $750" }] },
      ] }],
    };
    expect(unresolvedDisagreements(table)).toEqual([{
      factName: "annual-deductible", scope: "document-wide", sources: [
        { documentId: "a", page: 1, quote: "Deductible $250", display: "$250" },
        { documentId: "c", page: 2, quote: "Deductible $750", display: "$750" },
      ],
    }]);
  });
});

describe("hasSameScopeContradiction", () => {
  const v = (documentId: string, display: string, qualifiers: Record<string, string> = {}) => ({
    documentId,
    display,
    qualifiers,
  });

  it("is false for values from different documents", () => {
    expect(
      hasSameScopeContradiction([v("doc-1", "$250"), v("doc-2", "$500")])
    ).toBe(false);
  });

  it("is true for incompatible claims in the same document and scope", () => {
    expect(
      hasSameScopeContradiction([v("doc-1", "$250"), v("doc-1", "$500")])
    ).toBe(true);
  });

  it("is true for the same tier contradicting itself", () => {
    expect(
      hasSameScopeContradiction([
        v("doc-1", "$250", { planTier: "Lite" }),
        v("doc-1", "$500", { planTier: "Lite" }),
      ])
    ).toBe(true);
  });

  it("is false when only the tier differs (Lite vs Platinum)", () => {
    expect(
      hasSameScopeContradiction([
        v("doc-1", "$250", { planTier: "Lite" }),
        v("doc-1", "$500", { planTier: "Platinum" }),
      ])
    ).toBe(false);
  });

  it("is false for distinct proven plans in one source document", () => {
    expect(hasSameScopeContradiction([
      { ...v("doc-1", "$250"), planId: "plan-a" },
      { ...v("doc-1", "$500"), planId: "plan-b" },
    ])).toBe(false);
  });

  it("does not infer same-plan scope from a missing plan ID on a document-level value", () => {
    expect(hasSameScopeContradiction([
      { ...v("doc-1", "$250"), planId: "plan-a" },
      v("doc-1", "$500"),
    ])).toBe(false);
    expect(hasSameScopeContradiction([
      { ...v("doc-1", "$250"), planId: "plan-a" },
      { ...v("doc-1", "$500"), planId: "plan-a" },
    ])).toBe(true);
  });

  it("is false for in-network vs out-of-network in one document", () => {
    expect(
      hasSameScopeContradiction([
        v("doc-1", "$250", { networkTier: "in-network" }),
        v("doc-1", "$500", { networkTier: "out-of-network" }),
      ])
    ).toBe(false);
  });

  it("is false when the readings agree", () => {
    expect(
      hasSameScopeContradiction([v("doc-1", "$250"), v("doc-1", "  $250. ")])
    ).toBe(false);
  });

  it("compares scope qualifiers case-insensitively", () => {
    expect(
      hasSameScopeContradiction([
        v("doc-1", "$250", { planTier: "Lite" }),
        v("doc-1", "$500", { planTier: "lite" }),
      ])
    ).toBe(true);
  });

  it("is false for a single value", () => {
    expect(hasSameScopeContradiction([v("doc-1", "$250")])).toBe(false);
  });

  it("is false for different documentIds even with identical scope and differing values (V1 has no document-to-plan identity)", () => {
    expect(
      hasSameScopeContradiction([
        v("doc-1", "$250", { planTier: "Lite", networkTier: "in-network" }),
        v("doc-2", "$500", { planTier: "Lite", networkTier: "in-network" }),
      ])
    ).toBe(false);
  });

  it("is false for emergency dental vs routine dental in the same document and plan", () => {
    expect(
      hasSameScopeContradiction([
        {
          ...v("doc-1", "covered"),
          evidence: [{ documentId: "doc-1", page: 1, quote: "Emergency dental treatment: covered" }],
        },
        {
          ...v("doc-1", "not covered"),
          evidence: [{ documentId: "doc-1", page: 2, quote: "Dental: not covered" }],
        },
      ])
    ).toBe(false);
  });

  it("detects differing dental scope from evidence when the display is ambiguous", () => {
    expect(
      hasSameScopeContradiction([
        {
          ...v("doc-1", "covered"),
          evidence: [{ documentId: "doc-1", page: 1, quote: "Emergency dental: covered" }],
        },
        {
          ...v("doc-1", "not covered"),
          evidence: [{ documentId: "doc-1", page: 2, quote: "Routine dental: not covered" }],
        },
      ])
    ).toBe(false);
  });

  it("still flags a genuine same-scope dental contradiction", () => {
    expect(
      hasSameScopeContradiction([
        {
          ...v("doc-1", "covered"),
          evidence: [{ documentId: "doc-1", page: 1, quote: "Dental: covered" }],
        },
        {
          ...v("doc-1", "not covered"),
          evidence: [{ documentId: "doc-1", page: 2, quote: "Dental: not covered" }],
        },
      ])
    ).toBe(true);
  });
});
