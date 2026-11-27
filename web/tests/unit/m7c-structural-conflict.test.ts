// Follow-up to finding #3: when two proven structural claims of one plan,
// scope and row label state different values, the ROW verdict is CONFLICTED
// (verify-items and insurer-questions read only the row verdict). Different
// plans or different labels are distinct provisions (evidence-core §3).
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { tableDocument, type TablePageSpec, type TestDocument } from "./helpers/table-doc";

const page = (deductible: [string, string], extra: Partial<TablePageSpec> = {}): TablePageSpec => ({
  caption: "BENEFIT",
  headings: ["ELITE", "BASIC"],
  rows: [["Deductible", ...deductible], ["Local Ambulance", "Up to $750", "Up to $500"], ["Urgent Care", "$50 copay", "$75 copay"]],
  ...extra,
});
const run = (docs: TestDocument[]): ComparisonTable => verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
const row = (t: ComparisonTable, fact: string) => t.rows.find((r) => r.factName === fact)!;

describe("row verdict for a plan's own structural contradiction", () => {
  it("same plan, same tier, same label, different values → CONFLICTED", () => {
    const t = run([tableDocument("d1", [page(["$0", "$250"], { preamble: ["Policy name: Alpha"] }), page(["$100", "$250"])])]);
    const r = row(t, "annual-deductible");
    expect(r.values.filter((v) => v.planId && v.qualifiers.planTier === "ELITE").map((v) => v.display))
      .toEqual(["Deductible (ELITE): $0", "Deductible (ELITE): $100"]);
    expect(r.verdict).toBe("CONFLICTED");
  });

  it("the same figures restated are not a conflict", () => {
    const t = run([tableDocument("d1", [page(["$0", "$250"], { preamble: ["Policy name: Alpha"] }), page(["$0", "$250"])])]);
    expect(row(t, "annual-deductible").verdict).toBe("SUPPORTED");
  });

  it("different plans stating different values are comparison data", () => {
    const t = run([
      tableDocument("d1", [page(["$0", "$250"], { preamble: ["Policy name: Alpha"] })]),
      tableDocument("d2", [page(["$100", "$250"], { preamble: ["Policy name: Beta Plan"] })]),
    ]);
    expect(row(t, "annual-deductible").verdict).toBe("SUPPORTED");
  });

  it("different row labels are different provisions", () => {
    const t = run([tableDocument("d1", [
      page(["$0", "$250"], { preamble: ["Policy name: Alpha"] }),
      page(["$0", "$250"], { rows: [["Deductible Options", "$100", "$500"], ["Local Ambulance", "Up to $750", "Up to $500"], ["Urgent Care", "$50 copay", "$75 copay"]] }),
    ])]);
    expect(row(t, "annual-deductible").verdict).toBe("SUPPORTED");
  });
});
