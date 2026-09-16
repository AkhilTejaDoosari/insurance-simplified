import { describe, expect, it } from "vitest";
import { extractComparison } from "@/app/lib/extraction/extract";

const DOC_A = {
  documentId: "doc-1",
  filename: "plan-a.pdf",
  pageCount: 1,
  pages: ["Annual deductible: $250 in-network / $500 out-of-network."],
};
const DOC_B = {
  documentId: "doc-2",
  filename: "plan-b.pdf",
  pageCount: 1,
  pages: ["Annual deductible: $250 in-network / $500 out-of-network."],
};

describe("qualifier preservation (constitution principle III)", () => {
  it("never collapses in/out-of-network amounts", () => {
    const table = extractComparison([DOC_A, DOC_B], {}, { useLlm: false });
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row).toBeDefined();
    expect(row!.verdict).toBe("SUPPORTED");
    for (const v of row!.values) {
      expect(v.display).toContain("$250");
      expect(v.display).toContain("$500");
      expect(v.display).toContain("in-network");
      expect(v.display).toContain("out-of-network");
      expect(v.display).not.toBe("$250");
    }
  });

  it("records network-tier qualifiers structurally", () => {
    const table = extractComparison([DOC_A, DOC_B], {}, { useLlm: false });
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row!.values[0].qualifiers.networkTier).toMatch(/in-network/i);
  });
});
