import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";

const DOCS = [
  {
    documentId: "doc-1",
    filename: "a.pdf",
    pageCount: 1,
    pages: ["Annual deductible: $0 to $2,500."],
  },
  {
    documentId: "doc-2",
    filename: "b.pdf",
    pageCount: 1,
    pages: ["Annual deductible: $0, $100, $250, or $500."],
  },
  {
    documentId: "doc-3",
    filename: "c.pdf",
    pageCount: 1,
    pages: ["Annual deductible: $400."],
  },
];

describe("structural benefit differences", () => {
  it("marks range vs. options vs. fixed amount across different plans as SUPPORTED, not CONFLICTED", () => {
    const table = extractFallback(DOCS, {});
    const row = table.rows.find((r) => r.factName === "annual-deductible");

    expect(row?.values).toHaveLength(3);
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.verdict).not.toBe("CONFLICTED");
    expect(row?.verdict).not.toBe("NEEDS VERIFICATION");
  });
});
