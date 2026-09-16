import { describe, expect, it } from "vitest";
import { validateTable } from "@/app/lib/extraction/types";

const docs = [
  { documentId: "doc-1", filename: "a.pdf", pageCount: 2 },
  { documentId: "doc-2", filename: "b.pdf", pageCount: 2 },
];

function base() {
  return {
    schemaVersion: "v1" as const,
    factListVersion: "v1",
    documents: docs,
    rows: [] as never[],
  };
}

describe("comparison-schema v1 contract", () => {
  it("accepts SUPPORTED, CONFLICTED, and NOT STATED rows", () => {
    const table = {
      ...base(),
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250 in-network / $500 out-of-network",
              qualifiers: { networkTier: "in-network / out-of-network" },
              evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
            },
          ],
        },
        {
          factName: "emergency-copay",
          verdict: "CONFLICTED",
          values: [
            {
              documentId: "doc-1",
              display: "$100",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Emergency copay $100." }],
            },
            {
              documentId: "doc-2",
              display: "$250",
              qualifiers: {},
              evidence: [{ documentId: "doc-2", page: 1, quote: "Emergency copay $250." }],
            },
          ],
        },
        { factName: "maternity-coverage", verdict: "NOT STATED", values: [] },
      ],
    };
    expect(validateTable(table).rows).toHaveLength(3);
  });

  it("rejects bare yes/no verdicts", () => {
    expect(() =>
      validateTable({ ...base(), rows: [{ factName: "x", verdict: "yes", values: [] }] })
    ).toThrow();
  });

  it("rejects populated values without evidence (FR-007)", () => {
    expect(() =>
      validateTable({
        ...base(),
        rows: [{ factName: "x", verdict: "SUPPORTED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {}, evidence: [] }] }],
      })
    ).toThrow();
  });

  it("rejects NOT STATED rows carrying values", () => {
    expect(() =>
      validateTable({
        ...base(),
        rows: [{ factName: "x", verdict: "NOT STATED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "q" }] }] }],
      })
    ).toThrow();
  });

  it("requires a rationale on DOES NOT APPEAR TO FIT rows", () => {
    expect(() =>
      validateTable({ ...base(), rows: [{ factName: "x", verdict: "DOES NOT APPEAR TO FIT", values: [] }] })
    ).toThrow();
  });
});
