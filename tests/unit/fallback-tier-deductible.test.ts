import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";

describe("fallback tiered deductible", () => {
  it("shows each tier's amount while citing the original shared line", () => {
    const line = "Deductible $0 $100 $250 $500";
    const table = extractFallback([{
      documentId: "doc-1",
      filename: "tiers.pdf",
      pageCount: 1,
      pages: [`ELITE SELECT BUDGET SMART\n${line}`],
    }], {});

    const values = table.rows.find((row) => row.factName === "annual-deductible")?.values;
    expect(values?.map((value) => [value.qualifiers.planTier, value.display])).toEqual([
      ["ELITE", "$0"],
      ["SELECT", "$100"],
      ["BUDGET", "$250"],
      ["SMART", "$500"],
    ]);
    expect(values?.map((value) => value.evidence[0]?.quote)).toEqual([
      line, line, line, line,
    ]);
  });
});
