import { describe, expect, it } from "vitest";
import { validateTable } from "@/app/lib/extraction/types";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

const docs = [
  { documentId: "doc-1", filename: "a.pdf", pageCount: 2 },
  { documentId: "doc-2", filename: "b.pdf", pageCount: 2 },
];

function ev(documentId: string, page: number, quote: string) {
  return { documentId, page, quote, evidenceId: evidenceIdFor(documentId, page, quote) };
}

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
              evidence: [ev("doc-1", 1, "Annual deductible: $250 in-network.")],
            },
          ],
        },
        {
          factName: "emergency-copay",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$100",
              qualifiers: {},
              evidence: [ev("doc-1", 1, "Emergency copay $100.")],
            },
            {
              documentId: "doc-2",
              display: "$250",
              qualifiers: {},
              evidence: [ev("doc-2", 1, "Emergency copay $250.")],
            },
          ],
        },
        {
          factName: "urgent-care",
          verdict: "CONFLICTED",
          values: [
            {
              documentId: "doc-1",
              display: "$25 copay",
              qualifiers: {},
              evidence: [ev("doc-1", 2, "Urgent care copay is $25.")],
            },
            {
              documentId: "doc-1",
              display: "$50 copay",
              qualifiers: {},
              evidence: [ev("doc-1", 9, "Urgent care copay is $50.")],
            },
          ],
        },
        { factName: "maternity-coverage", verdict: "NOT STATED", values: [] },
      ],
    };
    expect(validateTable(table).rows).toHaveLength(4);
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
        rows: [{ factName: "x", verdict: "NOT STATED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {}, evidence: [ev("doc-1", 1, "q")] }] }],
      })
    ).toThrow();
  });

  it("rejects 'Not stated' values carrying backfilled evidence (principle IV)", () => {
    expect(() =>
      validateTable({
        ...base(),
        rows: [
          {
            factName: "out-of-pocket-maximum",
            verdict: "SUPPORTED",
            values: [
              {
                documentId: "doc-1",
                display: "Not stated",
                qualifiers: {},
                evidence: [
                  {
                    documentId: "doc-1",
                    page: 3,
                    quote: "This plan is not designed to cover US residents and citizens.",
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toThrow(/absence must not carry evidence/);
  });

  it("requires a rationale on DOES NOT APPEAR TO FIT rows", () => {
    expect(() =>
      validateTable({ ...base(), rows: [{ factName: "x", verdict: "DOES NOT APPEAR TO FIT", values: [] }] })
    ).toThrow();
  });

  it("rejects evidence without a session-bound evidenceId", () => {
    expect(() =>
      validateTable({
        ...base(),
        rows: [{ factName: "x", verdict: "SUPPORTED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "q" }] }] }],
      })
    ).toThrow(/evidenceId/);
  });
});
