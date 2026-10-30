import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractViaLlm, prepareLlmOutput } from "@/app/lib/extraction/extract";
import { completeJson } from "@/app/lib/llm/client";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));

const mockedComplete = vi.mocked(completeJson);

const DOCS = [
  {
    documentId: "doc-1",
    filename: "a.pdf",
    pageCount: 1,
    pages: ["LITE PLUS PLATINUM\nAnnual deductible: $250."],
  },
];

function valueWith(qualifiers: unknown) {
  const network = typeof qualifiers === "object" && qualifiers !== null &&
    "networkTier" in qualifiers && (qualifiers as { networkTier?: string }).networkTier === "in-network";
  const value: Record<string, unknown> = {
    documentId: "doc-1",
    display: "$250",
    evidence: [{ documentId: "doc-1", page: 1, quote: network
      ? "Annual deductible: $250 in-network." : "Annual deductible: $250." }],
  };
  if (qualifiers !== "absent") value.qualifiers = qualifiers;
  return value;
}

function llmPayload(qualifiers: unknown) {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
    rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [valueWith(qualifiers)] }],
  };
}

describe("extractViaLlm qualifiers normalization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("normalizes a missing qualifiers field to {} instead of rejecting", async () => {
    mockedComplete.mockResolvedValue(llmPayload("absent"));
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values[0].qualifiers).toEqual({});
  });

  it("normalizes null qualifiers to {}", async () => {
    mockedComplete.mockResolvedValue(llmPayload(null));
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values[0].qualifiers).toEqual({});
  });

  it("leaves well-formed qualifiers untouched", async () => {
    mockedComplete.mockResolvedValue(llmPayload({ networkTier: "in-network" }));
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values[0].qualifiers).toEqual({ networkTier: "in-network" });
  });

  it("omits an empty-string planTier so tier-agnostic rows stay valid", async () => {
    mockedComplete.mockResolvedValue(
      llmPayload({ planTier: "", networkTier: "in-network" }),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("SUPPORTED");
    expect(table.rows[0].values[0].qualifiers).toEqual({ networkTier: "in-network" });
  });

  it("trims a padded planTier instead of treating it as a different tier", async () => {
    mockedComplete.mockResolvedValue(llmPayload({ planTier: "  Plus  " }));
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values[0].qualifiers).toEqual({ planTier: "Plus" });
  });

  it("never turns a synthetic All tier into a tier column", async () => {
    for (const tier of ["All", "all", "All tiers", "  all  ", ""]) {
      mockedComplete.mockResolvedValue(llmPayload({ planTier: tier }));
      const table = await extractViaLlm(DOCS, {});
      expect(table.rows[0].values[0].qualifiers).toEqual({});
    }
  });

  it("keeps real tiers intact while dropping the synthetic one", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            valueWith({ planTier: "Lite" }),
            valueWith({ planTier: "Plus" }),
            valueWith({ planTier: "All" }),
            valueWith({ planTier: "Platinum" }),
          ],
        },
      ],
    });
    const table = await extractViaLlm(DOCS, {});
    const tiers = table.rows[0].values.map((val) => val.qualifiers.planTier);
    expect(tiers).toEqual(["Lite", "Plus", undefined, "Platinum"]);
  });

  it("strips a model-claimed selection status so only source-attested derivation survives", async () => {
    mockedComplete.mockResolvedValue(
      llmPayload({ planTier: "Lite", selectionStatus: "purchased" }),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values[0].qualifiers).toEqual({ planTier: "Lite" });
  });

  it("still rejects genuinely invalid payloads", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [],
      rows: [{ factName: "x", verdict: "yes", values: [] }],
    });
    await expect(extractViaLlm(DOCS, {})).rejects.toThrow();
  });

  it("rejects only an unsupported annual-period candidate and retains its valid peer", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
      rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [
        {
          documentId: "doc-1", display: "$1,000", qualifiers: { period: "annual" },
          evidence: [{ documentId: "doc-1", page: 1, quote: "Deductible: $1,000; nextAnnual enrollment opens in October." }],
        },
        {
          documentId: "doc-1", display: "$2,000", qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $2,000." }],
        },
      ] }],
    });

    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("NEEDS VERIFICATION");
    expect(table.rows[0].rationale).toMatch(/candidate.*rejected|rejected.*candidate/i);
    expect(table.rows[0].values).toHaveLength(1);
    expect(table.rows[0].values[0].display).toBe("$2,000");
    expect(table.rows[0].values[0].qualifiers).toEqual({});
  });

  it("quarantines a value whose citation identity conflicts with its document", async () => {
    mockedComplete.mockResolvedValue({
      ...llmPayload({}), rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [{
        documentId: "doc-1", display: "$250", qualifiers: { networkTier: "in-network" },
        evidence: [
          { documentId: "doc-1", page: 1, quote: "Annual deductible: $250." },
          { documentId: "doc-2", page: 1, quote: "Annual deductible: $250 in-network." },
        ],
      }] }],
    });
    const result = await extractViaLlm(DOCS, {});
    expect(result.rows[0].verdict).toBe("NEEDS VERIFICATION");
    expect(result.rows[0].values).toEqual([]);
  });

  it("sends an explicit schema-compliant, fail-closed output contract", async () => {
    mockedComplete.mockResolvedValue(llmPayload({}));
    await extractViaLlm(DOCS, {});
    const prompt = mockedComplete.mock.calls.at(-1)?.[0][0]?.content ?? "";

    expect(prompt).toMatch(/Every row MUST contain exactly one verdict/i);
    for (const verdict of ["SUPPORTED", "DOES NOT APPEAR TO FIT", "NOT STATED", "CONFLICTED", "NEEDS VERIFICATION"]) {
      expect(prompt).toContain(verdict);
    }
    expect(prompt).toMatch(/Every value MUST contain its own documentId/i);
    expect(prompt).toMatch(/original PDF page number|original 1-based page/i);
    expect(prompt).toMatch(/plans.*sources.*documentId.*page.*quote/is);
    expect(prompt).toMatch(/planId.*rows?.*NEVER|NEVER.*planId.*rows?/is);
    expect(prompt).toMatch(/only.*recognized.*qualifier keys/is);
    for (const qualifier of ["enrollment", "network", "expenseTypes", "serviceType", "exceptions"]) {
      expect(prompt).toContain(qualifier);
    }
    expect(prompt).toMatch(/NEEDS VERIFICATION.*cannot.*represented|cannot.*represented.*NEEDS VERIFICATION/is);
  });
});

describe("saved-response contract preparation", () => {
  const inputDocs = [
    { documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["Annual deductible: $250."] },
    { documentId: "doc-2", filename: "b.pdf", pageCount: 1, pages: ["Annual deductible: $500."] },
  ];

  function table(rows: unknown[], plans?: unknown[]) {
    return {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: inputDocs.map(({ documentId, filename, pageCount }) => ({ documentId, filename, pageCount })),
      ...(plans ? { plans } : {}),
      rows,
    };
  }

  function candidate(documentId: unknown, quoteDocumentId: string, quote = "Annual deductible: $250.", qualifiers: unknown = {}) {
    return {
      ...(documentId === "missing" ? {} : { documentId }),
      display: "$250",
      qualifiers,
      evidence: [{ documentId: quoteDocumentId, page: 1, quote }],
    };
  }

  it("derives a missing value documentId only from one supplied citation identity", () => {
    const prepared = prepareLlmOutput(table([
      { factName: "annual-deductible", verdict: "SUPPORTED", values: [candidate("missing", "doc-1")] },
    ]), inputDocs);
    const value = (prepared.payload as any).rows[0].values[0];
    expect(value.documentId).toBe("doc-1");
    expect(value.evidence[0].documentId).toBe("doc-1");
    expect(prepared.rejectionCodes).toEqual([]);
  });

  it("quarantines ambiguous or unknown citation identities instead of emitting NOT STATED", () => {
    const prepared = prepareLlmOutput(table([
      { factName: "annual-deductible", verdict: "SUPPORTED", values: [{
        display: "$250", qualifiers: {}, evidence: [
          { documentId: "doc-1", page: 1, quote: "Annual deductible: $250." },
          { documentId: "doc-2", page: 1, quote: "Annual deductible: $250." },
        ],
      }] },
      { factName: "premium", verdict: "SUPPORTED", values: [{
        display: "$250", qualifiers: {}, evidence: [{ documentId: "not-in-input", page: 1, quote: "Annual deductible: $250." }],
      }] },
    ]), inputDocs);
    const result = prepared.payload as any;
    expect(result.rows.map((row: any) => row.verdict)).toEqual(["NEEDS VERIFICATION", "NEEDS VERIFICATION"]);
    expect(result.rows.every((row: any) => row.values.length === 0)).toBe(true);
    expect(result.rows.some((row: any) => row.verdict === "NOT STATED")).toBe(false);
    expect(prepared.rejectionCodes).toContain("AMBIGUOUS_VALUE_DOCUMENT_ID");
    expect(prepared.rejectionCodes).toContain("UNKNOWN_EVIDENCE_DOCUMENT_ID");
  });

  it("rejects explicit document/evidence mismatches rather than overwriting the claim", () => {
    const prepared = prepareLlmOutput(table([
      { factName: "annual-deductible", verdict: "SUPPORTED", values: [candidate("doc-2", "doc-1")] },
    ]), inputDocs);
    expect((prepared.payload as any).rows[0].verdict).toBe("NEEDS VERIFICATION");
    expect((prepared.payload as any).rows[0].values).toEqual([]);
    expect(prepared.rejectionCodes).toContain("VALUE_DOCUMENT_ID_MISMATCH");
  });

  it("rejects rows with missing verdict without inventing a verdict or NOT STATED", () => {
    const prepared = prepareLlmOutput(table([
      { factName: "annual-deductible", values: [candidate("doc-1", "doc-1")] },
      { factName: "premium", verdict: "SUPPORTED", values: [candidate("doc-1", "doc-1")] },
    ]), inputDocs);
    const rows = (prepared.payload as any).rows;
    expect(rows.map((row: any) => row.factName)).toEqual(["premium"]);
    expect(rows[0].verdict).toBe("SUPPORTED");
    expect(prepared.rejectionCodes).toContain("MISSING_ROW_VERDICT");
  });

  it("quarantines every unknown qualifier key and preserves a valid peer with an explicit reason", () => {
    const unknownCases = [
      ["enrollment", "Self Only"],
      ["network", "Preferred providers"],
      ["expenseTypes", "deductible and copayments"],
      ["serviceType", "Inpatient facility care"],
      ["exceptions", "See Section 3"],
    ];
    const rows = unknownCases.map(([key, value]) => ({
      factName: "annual-deductible", verdict: "SUPPORTED", values: [candidate("doc-1", "doc-1", "Annual deductible: $250.", { [key]: value })],
    }));
    rows.push({ factName: "premium", verdict: "SUPPORTED", values: [candidate("doc-1", "doc-1")] });
    const prepared = prepareLlmOutput(table(rows), inputDocs);
    const result = prepared.payload as any;
    expect(prepared.rejectionCodes.filter((code) => code === "UNKNOWN_QUALIFIER_KEY")).toHaveLength(5);
    expect(result.rows.slice(0, 5).every((row: any) => row.verdict === "NEEDS VERIFICATION" && row.values.length === 0)).toBe(true);
    expect(result.rows.slice(0, 5).every((row: any) => row.rationale.includes("UNKNOWN_QUALIFIER_KEY"))).toBe(true);
    expect(result.rows[5].verdict).toBe("SUPPORTED");
    expect(result.rows[5].values).toHaveLength(1);
  });

  it("quarantines unsupported known conditions instead of normalizing them away", () => {
    const prepared = prepareLlmOutput(table([
      { factName: "emergency-care", verdict: "SUPPORTED", values: [candidate("doc-1", "doc-1", "Annual deductible: $250.", { conditions: "waived if admitted" })] },
      { factName: "emergency-care", verdict: "SUPPORTED", values: [candidate("doc-1", "doc-1", "Annual deductible: $250, waived if admitted.", { conditions: "waived if admitted" })] },
    ]), inputDocs);
    const rows = (prepared.payload as any).rows;
    expect(rows[0].values).toEqual([]);
    expect(rows[0].rationale).toContain("UNSUPPORTED_QUALIFIER_EVIDENCE");
    expect(rows[1].values[0].qualifiers.conditions).toBe("waived if admitted");
    expect(prepared.rejectionCodes).toContain("UNSUPPORTED_QUALIFIER_EVIDENCE");
  });

  it("rejects malformed plan evidence and row-level planId without affecting valid unassigned facts", () => {
    const prepared = prepareLlmOutput(table([
      { factName: "annual-deductible", verdict: "SUPPORTED", planId: "model-plan", values: [candidate("doc-1", "doc-1")] },
    ], [{ planId: "model-plan", name: "Alpha", evidence: [{ documentId: "doc-1", page: 1, quote: "Alpha" }] }]), inputDocs);
    const result = prepared.payload as any;
    expect(result.plans).toBeUndefined();
    expect(result.rows[0].planId).toBeUndefined();
    expect(result.rows[0].values).toHaveLength(1);
    expect(result.rows[0].values[0].planId).toBeUndefined();
    expect(prepared.rejectionCodes).toContain("MALFORMED_PLAN_SOURCES");
    expect(prepared.rejectionCodes).toContain("ROW_LEVEL_PLAN_ID_UNSUPPORTED");
  });
});
