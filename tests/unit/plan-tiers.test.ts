import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractViaLlm } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { completeJson } from "@/app/lib/llm/client";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));

const mockedComplete = vi.mocked(completeJson);

// A brochure that describes three plan tiers for one benefit in sequence —
// the shape that used to come back as "$0 to $2,500 $0 to $2,500 $0 to $25,000".
const BROCHURE = {
  documentId: "doc-1",
  filename: "patriot-travel-brochure.pdf",
  pageCount: 1,
  pages: [
    [
      "Patriot America Lite / Plus / Platinum",
      "Deductible",
      "Lite: $0 to $2,500",
      "Plus: $0 to $2,500",
      "Platinum: $0 to $25,000",
    ].join("\n"),
  ],
};

function tierValue(tier: string, display: string) {
  return {
    documentId: "doc-1",
    display,
    qualifiers: { planTier: tier },
    evidence: [{ documentId: "doc-1", page: 1, quote: `${tier}: ${display}` }],
  };
}

const TIERED_RESPONSE = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: BROCHURE.filename, pageCount: 1 }],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        tierValue("Lite", "$0 to $2,500"),
        tierValue("Plus", "$0 to $2,500"),
        tierValue("Platinum", "$0 to $25,000"),
      ],
    },
  ],
};

describe("multi-tier documents (planTier qualifier)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("instructs the model to split tiers into separate planTier-tagged values", async () => {
    mockedComplete.mockResolvedValue(TIERED_RESPONSE);
    await extractViaLlm([BROCHURE], {});
    const prompt = String(mockedComplete.mock.calls[0][0][0].content);
    expect(prompt).toContain("planTier");
    expect(prompt).toMatch(/separate/i);
  });

  it("keeps one value per tier instead of one concatenated string", async () => {
    mockedComplete.mockResolvedValue(TIERED_RESPONSE);
    const table = await extractViaLlm([BROCHURE], {});
    const values = table.rows[0].values;
    expect(values).toHaveLength(3);
    expect(values.map((v) => v.qualifiers.planTier)).toEqual(["Lite", "Plus", "Platinum"]);
    expect(values.map((v) => v.display)).toEqual(["$0 to $2,500", "$0 to $2,500", "$0 to $25,000"]);
    for (const v of values) expect(v.display).not.toMatch(/\$[\d,]+\s+\$[\d,]+/);
  });

  it("schema accepts several values from one document when each names a tier", () => {
    expect(() => validateTable(TIERED_RESPONSE)).not.toThrow();
  });

  it("schema rejects a non-string planTier", () => {
    const bad = structuredClone(TIERED_RESPONSE) as { rows: { values: { qualifiers: unknown }[] }[] };
    bad.rows[0].values[0].qualifiers = { planTier: 3 };
    expect(() => validateTable(bad)).toThrow(/planTier/);
  });
});
