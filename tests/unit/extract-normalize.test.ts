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
    pages: ["Annual deductible: $250."],
  },
];

function valueWith(qualifiers: unknown) {
  const value: Record<string, unknown> = {
    documentId: "doc-1",
    display: "$250",
    evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250." }],
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

  it("still rejects genuinely invalid payloads", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [],
      rows: [{ factName: "x", verdict: "yes", values: [] }],
    });
    await expect(extractViaLlm(DOCS, {})).rejects.toThrow();
  });
});
