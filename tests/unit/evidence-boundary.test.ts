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

  it("drops the evidence-less value and validates the row on the surviving value", async () => {
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
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("emergency-copay");
    expect(warn.mock.calls[0][0]).toContain("doc-2");
    warn.mockRestore();
  });

  it("still rejects rows with invalid verdicts instead of repairing them", async () => {
    mockedComplete.mockResolvedValue(
      payload([{ factName: "x", verdict: "yes", values: [] }])
    );
    await expect(extractViaLlm(DOCS, {})).rejects.toThrow();
  });

  it("flips a row with no surviving values to NOT STATED instead of failing", async () => {
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
    expect(row?.verdict).toBe("NOT STATED");
    expect(row?.values).toEqual([]);
    warn.mockRestore();
  });
});
