import { describe, expect, it, vi } from "vitest";
import { interpretCoinsuranceShare } from "@/app/lib/extraction/coinsurance";
import { extractFallback, extractViaLlm } from "@/app/lib/extraction/extract";
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
    pages: ["Coinsurance: placeholder."],
  },
];

const coinRow = (display: string, quote: string) => ({
  factName: "coinsurance",
  verdict: "SUPPORTED",
  values: [
    {
      documentId: "doc-1",
      display,
      qualifiers: {},
      evidence: [{ documentId: "doc-1", page: 1, quote }],
    },
  ],
});

const payload = (rows: unknown[]) => ({
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
  rows,
});

describe("interpretCoinsuranceShare", () => {
  it("prefers the insured share when both sides are stated", () => {
    expect(interpretCoinsuranceShare("Plan pays 90%, insured pays 10%")).toEqual({
      display: "You pay 10%",
      isMemberShare: true,
    });
  });

  it("maps an explicit zero member share", () => {
    expect(interpretCoinsuranceShare("Plan pays 100%, insured pays 0%")).toEqual({
      display: "You pay 0%",
      isMemberShare: true,
    });
  });

  it("keeps network scope when materially different", () => {
    expect(interpretCoinsuranceShare("You pay 10% for in-network care.")).toEqual({
      display: "You pay 10% in-network",
      isMemberShare: true,
    });
    expect(interpretCoinsuranceShare("You pay 20% out-of-network.")).toEqual({
      display: "You pay 20% out-of-network",
      isMemberShare: true,
    });
  });

  it("never maps an ambiguous percentage to your share", () => {
    const reading = interpretCoinsuranceShare("100% up to maximum limit.");
    expect(reading.isMemberShare).toBe(false);
    expect(reading.display).not.toContain("You pay 100%");
  });

  it("labels an explicit plan share as the plan's, not yours", () => {
    expect(interpretCoinsuranceShare("Plan pays 90% of covered charges.")).toEqual({
      display: "Plan pays 90%",
      isMemberShare: false,
    });
  });
});

describe("coinsurance extraction", () => {
  it("fallback displays the member share with evidence", () => {
    const table = extractFallback(
      [
        {
          documentId: "doc-1",
          filename: "a.pdf",
          pageCount: 1,
          pages: ["After deductible, insured pays 10% coinsurance in-network."],
        },
      ],
      {},
    );
    const row = table.rows.find((r) => r.factName === "coinsurance")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].display).toBe("You pay 10% in-network");
  });

  it("fallback marks ambiguous percentages NEEDS VERIFICATION, not your share", () => {
    const table = extractFallback(
      [
        {
          documentId: "doc-1",
          filename: "a.pdf",
          pageCount: 1,
          pages: ["Coinsurance: 100% up to maximum limit."],
        },
      ],
      {},
    );
    const row = table.rows.find((r) => r.factName === "coinsurance")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values[0].display).not.toContain("You pay 100%");
  });

  it("fallback leaves an unlabeled percentage triplet unresolved", () => {
    const table = extractFallback(
      [
        {
          documentId: "doc-1",
          filename: "a.pdf",
          pageCount: 1,
          pages: ["You pay 100% / 90% / 100%."],
        },
      ],
      {},
    );
    const row = table.rows.find((r) => r.factName === "coinsurance")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values[0].evidence[0].quote).toBe("You pay 100% / 90% / 100%.");
  });

  it("fallback keeps a network-labelled percentage pair supported", () => {
    const table = extractFallback(
      [
        {
          documentId: "doc-1",
          filename: "a.pdf",
          pageCount: 1,
          pages: ["Coinsurance: you pay 10% for in-network and 20% for out-of-network care."],
        },
      ],
      {},
    );
    const row = table.rows.find((r) => r.factName === "coinsurance")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].qualifiers.networkTier).toMatch(/in-network/i);
  });

  it("LLM path rewrites displays through the same interpreter", async () => {
    mockedComplete.mockResolvedValue(
      payload([coinRow("90%", "Plan pays 90%, member pays 10% coinsurance.")]),
    );
    const table = await extractViaLlm(DOCS, {});
    const row = table.rows.find((r) => r.factName === "coinsurance")!;
    expect(row.values[0].display).toBe("You pay 10%");
  });

  it("LLM path refuses to present ambiguous shares as supported", async () => {
    mockedComplete.mockResolvedValue(
      payload([coinRow("100%", "Coinsurance: 100% up to maximum limit.")]),
    );
    const table = await extractViaLlm(DOCS, {});
    const row = table.rows.find((r) => r.factName === "coinsurance")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values[0].display).not.toContain("You pay 100%");
  });
});
