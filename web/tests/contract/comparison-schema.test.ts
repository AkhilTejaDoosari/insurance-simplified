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
  const proof = (documentId: string, name: string) => ({ documentId, page: 1, quote: `Policy name: ${name}` });

  it("accepts the exact value identity, verdict, evidence, and plan sources shape", () => {
    const table = {
      ...base(),
      plans: [{ planId: "alpha", name: "Alpha", sources: [proof("doc-1", "Alpha")] }],
      rows: [{
        factName: "emergency-copay",
        verdict: "SUPPORTED",
        values: [{
          documentId: "doc-1",
          display: "$100 copay, Self Only enrollment",
          qualifiers: { conditions: "Self Only enrollment" },
          evidence: [{ documentId: "doc-1", page: 1, quote: "Emergency copay $100 for Self Only enrollment." }],
        }],
      }],
    };
    expect(validateTable(table).plans?.[0].sources[0]).toEqual(proof("doc-1", "Alpha"));
    expect(validateTable(table).rows[0].values[0].documentId).toBe("doc-1");
  });

  it("rejects outputs missing required verdict, value identity, or plan sources", () => {
    const value = {
      documentId: "doc-1", display: "$5", qualifiers: {},
      evidence: [{ documentId: "doc-1", page: 1, quote: "Copay $5." }],
    };
    expect(() => validateTable({
      ...base(), rows: [{ factName: "copay", values: [value] }],
    })).toThrow(/verdict/i);
    const missingValueId = { ...value } as Record<string, unknown>;
    delete missingValueId.documentId;
    expect(() => validateTable({
      ...base(), rows: [{ factName: "copay", verdict: "SUPPORTED", values: [missingValueId] }],
    })).toThrow(/unknown document/i);
    expect(() => validateTable({
      ...base(), plans: [{ planId: "alpha", name: "Alpha", evidence: [proof("doc-1", "Alpha")] }],
    })).toThrow(/sources/i);
  });

  it("accepts two independently evidenced plans in one PDF and one plan evidenced by two PDFs", () => {
    const twoPlans = { ...base(), plans: [
      { planId: "plan-a", name: "Alpha", sources: [proof("doc-1", "Alpha")] },
      { planId: "plan-b", name: "Beta", sources: [proof("doc-1", "Beta")] },
    ] };
    expect(validateTable(twoPlans).plans).toHaveLength(2);
    const sharedProof = (documentId: string) => ({ documentId, page: 1, quote: "Policy name: Alpha; Policy ID: ABC-123; Issuer: Acme" });
    const onePlan = { ...base(), plans: [{ planId: "shared", name: "Alpha", policyIdentifier: "ABC-123", issuer: "Acme", sources: [sharedProof("doc-1"), sharedProof("doc-2")] }] };
    expect(validateTable(onePlan).plans?.[0].sources).toHaveLength(2);
  });

  it("leaves a legacy v1 result without plan identity unresolved", () => {
    expect(validateTable(base()).plans).toBeUndefined();
  });

  it("rejects unsupported, duplicate or cross-document plan attribution", () => {
    const plan = { planId: "shared", name: "Alpha", sources: [proof("doc-1", "Alpha")] };
    expect(() => validateTable({ ...base(), plans: [{ ...plan, sources: [] }] })).toThrow(/sources/);
    expect(() => validateTable({ ...base(), plans: [plan, plan] })).toThrow(/duplicate/);
    expect(() => validateTable({ ...base(), plans: [{ ...plan, sources: [proof("doc-3", "Alpha")] }] })).toThrow(/unknown document/);
    expect(() => validateTable({ ...base(), plans: [{ ...plan, sources: [proof("doc-1", "Different")] }] })).toThrow(/name/);
    expect(() => validateTable({ ...base(), plans: [plan], rows: [{ factName: "x", verdict: "SUPPORTED", values: [{ documentId: "doc-2", planId: "shared", display: "$5", qualifiers: {}, evidence: [proof("doc-2", "Alpha")] }] }] })).toThrow(/plan source/);
    expect(() => validateTable({ ...base(), plans: [{ ...plan, sources: [proof("doc-1", "Alpha"), proof("doc-2", "Alpha")] }] })).toThrow(/policy identifier/);
    expect(() => validateTable({ ...base(), plans: [plan], rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", planId: "shared", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote: "Beta premium is $5" }] }] }] })).toThrow(/plan relationship/);
    for (const quote of ["Alpha does not offer the $5 premium", "Alpha and Beta premium: $5", "Alpha premium compared to others is $5"]) {
      expect(() => validateTable({ ...base(), plans: [plan], rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", planId: "shared", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote }] }] }] })).toThrow(/plan relationship/);
    }
    expect(validateTable({ ...base(), plans: [plan], rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", planId: "shared", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha; premium: $5" }] }] }] }).rows[0].values[0].planId).toBe("shared");
    expect(() => validateTable({ ...base(), plans: [{ ...plan, policyIdentifier: "ABC-123", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha; Policy ID: ABC-123" }, { documentId: "doc-2", page: 1, quote: "Policy name: Alpha; Policy ID: ABC-123" }] }] })).toThrow(/issuer/);
  });
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
               evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network / $500 out-of-network." }],
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
        {
          factName: "urgent-care",
          verdict: "CONFLICTED",
          values: [
            {
              documentId: "doc-1",
              display: "$25 copay",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 2, quote: "Urgent care copay is $25." }],
            },
            {
              documentId: "doc-1",
              display: "$50 copay",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 9, quote: "Urgent care copay is $50." }],
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
        rows: [{ factName: "x", verdict: "NOT STATED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "q" }] }] }],
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
});
