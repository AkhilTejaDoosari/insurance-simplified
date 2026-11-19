// Structural scope survives every consumer: extraction → verification →
// presentation (indexFacts) → PDF report conditions. Lexical clause checks
// must not erase evidence-backed scope of a structural claim, and must still
// strip unsupported scope of unstructured values. The real-page case lives
// in qualifier-preservation-real.test.ts (REAL_FIXTURES_DIR).
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type CellValue, type RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { scopedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
import { indexFacts, type ActiveView } from "@/app/lib/presentation/adaptive";
import { tableDocument } from "./helpers/table-doc";

const register = (t: ReturnType<typeof verifyComparisonTable>): RegisteredComparisonTable => ({
  ...t,
  rows: t.rows.map((r) => ({ ...r, values: r.values.map((v) => ({ ...v, evidence: v.evidence.map((e, i) => ({ ...e, evidenceId: `ev-${i}` })) })) })),
});

describe("Network-column tables keep network and applicability scope", () => {
  const doc = tableDocument("d1", [{
    preamble: ["Policy name: Alpha"], caption: "BENEFIT", headings: ["US In-Network", "International"],
    rows: [["Out of Pocket Maximum", "$1,000", "$0"], ["Copay", "$10", "$20"], ["Lab", "$1", "$2"]],
  }]);
  const table = register(verifyComparisonTable(validateTable(extractFallback([doc], {})), [doc]));
  const view: ActiveView = { mode: "understand", documentId: "d1", planIds: [table.plans![0].planId], tiers: {} };
  it("presentation qualifiers equal the verified structural scope", () => {
    const oop = indexFacts(table, view).filter((f) => f.concept === "out-of-pocket-maximum" && f.value.anchor);
    expect(oop.map((f) => [f.qualifiers.networkTier ?? null, f.qualifiers.conditions ?? null])).toEqual([
      ["In-Network", "US"],
      [null, "International"],
    ]);
  });
});

describe("scopedQualifiers contract", () => {
  const base: CellValue = {
    documentId: "d", display: "For Self Plus One, and Self and Family contracts, the\ndeductible is now $2,000",
    qualifiers: { conditions: "Self Plus One, and Self and Family" },
    evidence: [{ documentId: "d", page: 1, quote: "For Self Plus One, and Self and Family contracts, the\ndeductible is now $2,000" }],
  };
  it("unstructured value: wrapped clause cannot prove the scope → stripped (unchanged lexical rule)", () => {
    expect(scopedQualifiers(base).conditions).toBeUndefined();
  });
  it("structural value: scope stated in its own claim text is kept", () => {
    expect(scopedQualifiers({ ...base, anchor: { kind: "statement", page: 1, start: 0, end: 10 } }).conditions)
      .toBe("Self Plus One, and Self and Family");
  });
  it("structural value: scope NOT stated in the claim text is never kept (no guessing)", () => {
    const v = { ...base, qualifiers: { conditions: "Self Only" }, anchor: { kind: "statement" as const, page: 1, start: 0, end: 10 } };
    expect(scopedQualifiers(v).conditions).toBeUndefined();
  });
  it("structural value: a derived qualifier still needs lexical evidence", () => {
    const v = { ...base, qualifiers: { ...base.qualifiers, ageBand: "under 65" }, anchor: { kind: "statement" as const, page: 1, start: 0, end: 10 } };
    expect(scopedQualifiers(v).ageBand).toBeUndefined();
  });
});
