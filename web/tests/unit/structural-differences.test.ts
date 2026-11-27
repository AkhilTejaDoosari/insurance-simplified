import { describe, expect, it } from "vitest";
import { extractFallback, unresolvedDisagreements } from "@/app/lib/extraction/extract";

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

  it("keeps structural differences SUPPORTED while reporting an unresolved disagreement with traceable citations", () => {
    const table = extractFallback(DOCS, {});
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.verdict).toBe("SUPPORTED");
    expect(row?.values).toHaveLength(3);

    const d = unresolvedDisagreements(table).find(
      (x) => x.factName === "annual-deductible"
    );
    expect(d).toBeDefined();
    // Scope-strict: only documents in the same extracted qualifier scope are
    // grouped; every reported side keeps its own document/page citation.
    expect(d!.sources.length).toBeGreaterThanOrEqual(2);
    expect(new Set(d!.sources.map((s) => s.documentId)).size).toBe(d!.sources.length);
    for (const source of d!.sources) {
      expect(["doc-1", "doc-2", "doc-3"]).toContain(source.documentId);
      expect(source.page).toBeGreaterThanOrEqual(1);
      expect(source.quote.length).toBeGreaterThan(0);
    }
  });
});
