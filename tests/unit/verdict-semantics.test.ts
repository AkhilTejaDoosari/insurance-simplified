import { describe, expect, it } from "vitest";
import {
  extractFallback,
  hasSameScopeContradiction,
  type ExtractInputDocument,
} from "@/app/lib/extraction/extract";
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
});
