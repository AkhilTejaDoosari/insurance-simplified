// EC-4: a network scope literally stated in a value's own cited clause
// travels with the claim as qualifiers.networkTier — never guessed from a
// neighbouring line, never from an ambiguous clause.
import { describe, expect, it } from "vitest";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { validateTable, type ComparisonTable } from "@/app/lib/extraction/types";
import { statedNetworkTier } from "@/app/lib/extraction/qualifier-evidence";

const verify = (page: string, display: string, quote = page) => {
  const docs = [{ documentId: "d1", filename: "d1.pdf", pageCount: 1, pages: [page] }];
  const table: ComparisonTable = {
    schemaVersion: "v1", factListVersion: "v1",
    documents: [{ documentId: "d1", filename: "d1.pdf", pageCount: 1 }],
    rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [{
      documentId: "d1", display, qualifiers: {}, evidence: [{ documentId: "d1", page: 1, quote }],
    }] }],
  };
  return verifyComparisonTable(validateTable(table), docs).rows[0];
};

describe("network scope stated in the value's own clause", () => {
  it("'$250' cited from '$250 in-network.' carries networkTier and stays SUPPORTED", () => {
    const row = verify("Annual deductible: $250 in-network.", "$250");
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].qualifiers.networkTier).toBe("in-network");
  });

  it("the slice of a multi-figure clause that holds the figure decides", () => {
    const quote = "Deductible: $250 in-network / $500 out-of-network.";
    expect(verify(quote, "$500").values[0].qualifiers.networkTier).toBe("out-of-network");
  });

  it("a scope on a neighbouring line or sentence is never borrowed", () => {
    expect(verify("Deductible: $250.\nOut-of-network services cost more.", "$250", "Deductible: $250.\nOut-of-network services cost more.").values[0].qualifiers.networkTier).toBeUndefined();
    expect(verify("Deductible: $250. In-network providers only.", "$250").values[0].qualifiers.networkTier).toBeUndefined();
  });

  it("an ambiguous clause (two scopes for one figure) sets nothing", () => {
    expect(statedNetworkTier({ display: "$250", evidence: [{ documentId: "d1", page: 1, quote: "$250 in-network or out-of-network" }] })).toBeUndefined();
  });

  it("a display without a figure is not scoped by its clause", () => {
    expect(statedNetworkTier({ display: "Covered", evidence: [{ documentId: "d1", page: 1, quote: "Covered in-network" }] })).toBeUndefined();
  });
});
