import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractViaLlm } from "@/app/lib/extraction/extract";
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
    pages: ["Emergency copay $100."],
  },
  {
    documentId: "doc-2",
    filename: "b.pdf",
    pageCount: 1,
    pages: ["Emergency copay $250."],
  },
];

function payload(rows: unknown[]) {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [
      { documentId: "doc-1", filename: "a.pdf", pageCount: 1 },
      { documentId: "doc-2", filename: "b.pdf", pageCount: 1 },
    ],
    rows,
  };
}

function value(documentId: string, display: string, withEvidence: boolean) {
  return {
    documentId,
    display,
    qualifiers: {},
    evidence: withEvidence
      ? [{ documentId, page: 1, quote: `Emergency copay ${display}.` }]
      : [],
  };
}

describe("extractViaLlm evidence boundary (principle IV)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("quarantines an evidence-less candidate without claiming absence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "emergency-copay",
          verdict: "CONFLICTED",
          values: [value("doc-1", "$100", true), value("doc-2", "$250", false)],
        },
      ])
    );

    const table = await extractViaLlm(DOCS, {});
    const row = table.rows.find((r) => r.factName === "emergency-copay");
    expect(row?.values).toHaveLength(1);
    expect(row?.values[0].documentId).toBe("doc-1");
    expect(row?.verdict).toBe("NEEDS VERIFICATION");
    expect(row?.rationale).toContain("MISSING_VALUE_EVIDENCE");
    expect(warn.mock.calls[0][0]).toContain("MISSING_VALUE_EVIDENCE");
    warn.mockRestore();
  });

  it("still rejects rows with invalid verdicts instead of repairing them", async () => {
    mockedComplete.mockResolvedValue(
      payload([{ factName: "x", verdict: "yes", values: [] }])
    );
    await expect(extractViaLlm(DOCS, {})).rejects.toThrow();
  });

  it("keeps a row with only rejected values unresolved rather than NOT STATED", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "out-of-pocket-maximum",
          verdict: "SUPPORTED",
          values: [value("doc-1", "$3,000", false)],
        },
      ])
    );

    const table = await extractViaLlm(DOCS, {});
    const row = table.rows.find((r) => r.factName === "out-of-pocket-maximum");
    expect(row?.verdict).toBe("NEEDS VERIFICATION");
    expect(row?.rationale).toContain("MISSING_VALUE_EVIDENCE");
    expect(row?.values).toEqual([]);
    warn.mockRestore();
  });

  it("quarantines a value whose citation points at a different document", async () => {
    const misCited = {
      ...value("doc-2", "$250", true),
      evidence: [{ documentId: "doc-1", page: 1, quote: "Emergency copay $100." }],
    };
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "emergency-copay",
          verdict: "CONFLICTED",
          values: [value("doc-1", "$100", true), misCited],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values.map((v) => v.documentId)).toEqual(["doc-1"]);
    expect(table.rows[0].verdict).toBe("NEEDS VERIFICATION");
    expect(table.rows[0].rationale).toContain("VALUE_DOCUMENT_ID_MISMATCH");
  });

  it("rejects the whole candidate when its citations mix document identities", async () => {
    const mixed = {
      ...value("doc-2", "$250", true),
      evidence: [
        { documentId: "doc-1", page: 1, quote: "Emergency copay $100." },
        { documentId: "doc-2", page: 1, quote: "Emergency copay $250." },
      ],
    };
    mockedComplete.mockResolvedValue(
      payload([{ factName: "emergency-copay", verdict: "SUPPORTED", values: [mixed] }]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values).toEqual([]);
    expect(table.rows[0].verdict).toBe("NEEDS VERIFICATION");
    expect(table.rows[0].rationale).toContain("VALUE_DOCUMENT_ID_MISMATCH");
  });
});
