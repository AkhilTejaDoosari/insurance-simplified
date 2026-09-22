import { describe, expect, it, vi } from "vitest";
import {
  applyPremiumPersonalization,
  personalizePremiumRow,
  VARIES_BY_AGE,
} from "@/app/lib/extraction/premium";
import { extractViaLlm } from "@/app/lib/extraction/extract";
import { completeJson } from "@/app/lib/llm/client";
import type { ComparisonTable, TableRow } from "@/app/lib/extraction/types";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));

const mockedComplete = vi.mocked(completeJson);

const band = (
  documentId: string,
  display: string,
  planTier: string,
  ageMin: number,
  ageMax: number,
  page = 1,
): TableRow["values"][number] => ({
  documentId,
  display,
  qualifiers: { planTier, ageMin, ageMax, amount: Number(display.replace(/[^0-9]/g, "")), frequency: "monthly" },
  evidence: [{ documentId, page, quote: `${planTier} age ${ageMin}-${ageMax}: ${display}/month.` }],
});

const RATE_TABLE: TableRow["values"] = [
  band("doc-1", "$41", "OPTima Basic", 18, 24),
  band("doc-1", "$81", "OPTima Enhanced", 18, 24),
  band("doc-1", "$72", "OPTima Basic", 25, 29),
  band("doc-1", "$112", "OPTima Enhanced", 25, 29),
  band("doc-1", "$123", "OPTima Basic", 30, 64),
  band("doc-1", "$185", "OPTima Enhanced", 30, 64),
];

const row = (values: TableRow["values"]): TableRow => ({
  factName: "premium",
  verdict: "SUPPORTED",
  values,
});

const table = (rows: TableRow[]): ComparisonTable => ({
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "optima.pdf", pageCount: 3 }],
  rows,
});

const displays = (r: TableRow): string[] => r.values.map((v) => v.display);

describe("personalizePremiumRow age matrix", () => {
  const cases: Array<[string, number, string, string]> = [
    ["18", 18, "$41/mo", "$81/mo"],
    ["24", 24, "$41/mo", "$81/mo"],
    ["25", 25, "$72/mo", "$112/mo"],
    ["29", 29, "$72/mo", "$112/mo"],
    ["30", 30, "$123/mo", "$185/mo"],
    ["64", 64, "$123/mo", "$185/mo"],
  ];
  for (const [age, _n, basic, enhanced] of cases) {
    it(`age ${age}: Basic ${basic}, Enhanced ${enhanced}`, () => {
      const out = personalizePremiumRow(row(RATE_TABLE), { age });
      expect(out.verdict).toBe("SUPPORTED");
      const byTier = new Map(out.values.map((v) => [v.qualifiers.planTier, v.display]));
      expect(byTier.get("OPTima Basic")).toBe(basic);
      expect(byTier.get("OPTima Enhanced")).toBe(enhanced);
      expect(displays(out).sort()).toEqual([basic, enhanced].sort());
    });
  }

  it("age 65 past a source ending at 64: no guess, NEEDS VERIFICATION", () => {
    const out = personalizePremiumRow(row(RATE_TABLE), { age: "65" });
    expect(out.verdict).toBe("NEEDS VERIFICATION");
    expect(out.values).toEqual([]);
    expect(out.rationale).toContain("65");
  });

  it("missing age: no price dump, Varies by age", () => {
    const out = personalizePremiumRow(row(RATE_TABLE), {});
    expect(out.verdict).toBe("NEEDS VERIFICATION");
    expect(out.values).toEqual([]);
    expect(out.rationale).toBe(VARIES_BY_AGE);
  });

  it("tier integrity: Basic never receives Enhanced premium", () => {
    const out = personalizePremiumRow(row(RATE_TABLE), { age: "25" });
    for (const v of out.values) {
      if (v.qualifiers.planTier === "OPTima Basic") expect(v.display).toBe("$72/mo");
      if (v.qualifiers.planTier === "OPTima Enhanced") expect(v.display).toBe("$112/mo");
    }
  });

  it("unbanded rows pass through untouched", () => {
    const plain: TableRow = {
      factName: "premium",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$50/month",
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 1, quote: "Premium $50/month." }],
        },
      ],
    };
    expect(personalizePremiumRow(plain, { age: "25" })).toEqual(plain);
  });
});

describe("premium personalization wiring", () => {
  const DOCS = [
    { documentId: "doc-1", filename: "optima.pdf", pageCount: 3, pages: ["rates"] },
  ];

  it("LLM banded output is filtered to the user's age band", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "optima.pdf", pageCount: 3 }],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: RATE_TABLE }],
    });
    const result = await extractViaLlm(DOCS, { age: "25" });
    const premium = result.rows.find((r) => r.factName === "premium")!;
    expect(premium.values.map((v) => v.display).sort()).toEqual(["$112/mo", "$72/mo"]);
  });

  it("applyPremiumPersonalization leaves other facts alone", () => {
    const other: TableRow = {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$250",
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 1, quote: "Deductible $250." }],
        },
      ],
    };
    const out = applyPremiumPersonalization(table([other, row(RATE_TABLE)]), { age: "30" });
    expect(out.rows[0]).toEqual(other);
    expect(out.rows[1].values.map((v) => v.display).sort()).toEqual(["$123/mo", "$185/mo"]);
  });
});
