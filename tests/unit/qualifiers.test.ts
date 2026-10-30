import { describe, expect, it } from "vitest";
import { extractComparison, hasSameScopeContradiction } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";

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

/** V1.1 M2 task 5: a material number must keep the conditions needed to
 *  understand it, or be shown as unresolved — never as an invented label. */
const doc = (text: string) => [
  { documentId: "doc-1", filename: "policy.pdf", pageCount: 1, pages: [text] },
];

const tableWith = (values: Record<string, unknown>[]) => ({
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "policy.pdf", pageCount: 1 }],
  rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values }],
});

describe("material condition bindings", () => {
  it("marks an unlabeled multi-amount figure unresolved instead of inventing labels", () => {
    const table = extractComparison(
      doc("Out-of-pocket maximum: $0 / $500 / $0."),
      {},
      { useLlm: false },
    );
    const row = table.rows.find((r) => r.factName === "out-of-pocket-maximum")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values).toHaveLength(1);
    expect(row.values[0].display).toBe("Out-of-pocket maximum: $0 / $500 / $0.");
    expect(row.values[0].evidence).toHaveLength(1);
    expect(row.values[0].qualifiers.costType).toBe("out-of-pocket maximum");
  });

  it("keeps a network-labelled multi-amount deductible supported", () => {
    const table = extractComparison(
      doc("Annual deductible: $250 in-network / $500 out-of-network."),
      {},
      { useLlm: false },
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].qualifiers.networkTier).toMatch(/in-network/i);
  });

  it("does not reduce an ambiguous emergency copay to one supported amount", () => {
    const source = "Emergency room copay: $100 in-network / $200 / $300 out-of-network.";
    const row = extractComparison(doc(source), {}, { useLlm: false }).rows.find((r) => r.factName === "emergency-care")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values[0].display).toContain("$100");
    expect(row.values[0].display).toContain("$200");
    expect(row.values[0].display).toContain("$300");
    expect(row.values[0].evidence[0].quote).toBe(source);
  });

  it("does not turn unrelated choice language into emergency copay options", () => {
    const source = "Emergency room copay: $100 in-network / $200 / $300 out-of-network. Choose your doctor.";
    const row = extractComparison(doc(source), {}, { useLlm: false }).rows.find((r) => r.factName === "emergency-care")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.values[0].display).toMatch(/\$100.*\$200.*\$300/);
    expect(row.values[0].qualifiers.selectionStatus).not.toBe("selectable");
    expect(row.values[0].evidence[0].quote).toBe(source);
  });

  it("binds each material qualifier to the cited value rather than the presence of any citation", () => {
    const value = (quote: string, qualifiers: Record<string, string | undefined>) => ({
      documentId: "doc-1", display: "$250", qualifiers,
      evidence: [{ documentId: "doc-1", page: 1, quote }],
    });
    for (const qualifier of [
      { networkTier: "Preferred PPO" }, { ageBand: "25-29" },
      { frequency: "monthly" }, { currency: "EUR" },
    ]) {
      expect(() => validateTable(tableWith([value("Annual deductible: $250.", qualifier)])))
        .toThrow(/qualifiers/);
    }
    const supported = "Annual deductible: $250 for Preferred PPO, ages 25-29, billed monthly in EUR.";
    expect(() => validateTable(tableWith([value(supported, {
      networkTier: "Preferred PPO", ageBand: "25-29", frequency: "monthly", currency: "EUR",
    })]))).not.toThrow();
  });

  it("keeps an evidenced amount while removing unsupported model qualifier claims", async () => {
    const { normalizeLlmTable } = await import("@/app/lib/extraction/extract");
    const normalized = normalizeLlmTable(tableWith([{
      documentId: "doc-1", display: "$250",
      qualifiers: { ageBand: "25-29", frequency: "monthly", networkTier: "Preferred PPO", currency: "EUR" },
      evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250." }],
    }])) as ReturnType<typeof validateTable>;
    expect(normalized.rows[0].values[0].display).toBe("$250");
    expect(normalized.rows[0].values[0].qualifiers).toEqual({});
    expect(normalized.rows[0].values[0].evidence[0].quote).toBe("Annual deductible: $250.");
  });

  it("does not bind a network label from another figure in the same cited sentence", () => {
    const quote = "Annual deductible: $100 in-network / $250 out-of-network.";
    const value = (networkTier: string) => ({ documentId: "doc-1", display: "$250",
      qualifiers: { networkTier }, evidence: [{ documentId: "doc-1", page: 1, quote }] });
    expect(() => validateTable(tableWith([value("in-network")]))).toThrow(/networkTier/);
    expect(() => validateTable(tableWith([value("out-of-network")]))).not.toThrow();
  });

  it("preserves explicitly scoped emergency copays as supported", () => {
    const source = "Emergency room copay: $100 in-network / $300 out-of-network.";
    const row = extractComparison(doc(source), {}, { useLlm: false }).rows.find((r) => r.factName === "emergency-care")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].display).toContain("$100");
    expect(row.values[0].display).toContain("$300");
  });

  it("rejects invented currency, network, and period qualifiers while accepting attested ones", () => {
    const value = (quote: string, qualifiers: { currency?: string; networkTier?: string; period?: string }) => ({
      documentId: "doc-1", display: "$250", qualifiers,
      evidence: [{ documentId: "doc-1", page: 1, quote }],
    });
    const plain = "Annual deductible: $250.";
    for (const qualifier of [
      { currency: "EUR" }, { networkTier: "out-of-network" }, { period: "monthly" },
    ]) {
      expect(() => validateTable(tableWith([value(plain, qualifier)]))).toThrow(/qualifiers/);
    }
    expect(() => validateTable(tableWith([value("Annual deductible: EUR 250 out-of-network per month.",
      { currency: "EUR", networkTier: "out-of-network", period: "per month" })]))).not.toThrow();
  });

  it("does not treat one stray network label as proof for three amounts", () => {
    const table = extractComparison(
      doc("Annual deductible: $0 / $500 / $0 in-network."),
      {},
      { useLlm: false },
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible")!;
    expect(row.values[0].display).toContain("$0 / $500 / $0");
    expect(row.verdict).toBe("NEEDS VERIFICATION");
  });

  it("reads an enumerated deductible list as selectable options, never as a purchase", () => {
    const table = extractComparison(
      doc("Annual deductible: $0, $500, or $1,000 per year."),
      {},
      { useLlm: false },
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].qualifiers.selectionStatus).toBe("selectable");
    expect(row.values[0].qualifiers.selectionStatus).not.toBe("purchased");
  });

  it("refuses a purchased claim that no source passage attests", () => {
    expect(() =>
      validateTable(
        tableWith([
          {
            documentId: "doc-1",
            display: "$500",
            qualifiers: { selectionStatus: "purchased" },
            evidence: [
              { documentId: "doc-1", page: 1, quote: "Annual deductible: $0, $500, or $1,000." },
            ],
          },
        ]),
      ),
    ).toThrow(/purchas/i);
  });

  it("accepts a purchased claim the source states", () => {
    const table = validateTable(
      tableWith([
        {
          documentId: "doc-1",
          display: "$500",
          qualifiers: { selectionStatus: "purchased" },
          evidence: [
            { documentId: "doc-1", page: 1, quote: "You selected the $500 annual deductible." },
          ],
        },
      ]),
    );
    expect(table.rows[0].values[0].qualifiers.selectionStatus).toBe("purchased");
  });

  it("does not call a brochure's selected-deductible options purchased", () => {
    const table = extractComparison(doc("Selected deductible options: $0 or $500."), {}, { useLlm: false });
    const value = table.rows.find((r) => r.factName === "annual-deductible")!.values[0];
    expect(value.qualifiers.selectionStatus).toBe("selectable");
    expect(value.qualifiers.selectionStatus).not.toBe("purchased");
  });

  it("does not mark a different amount purchased from a cited choice", () => {
    expect(() => validateTable(tableWith([{
      documentId: "doc-1", display: "$0", qualifiers: { selectionStatus: "purchased" },
      evidence: [{ documentId: "doc-1", page: 1, quote: "You selected the $500 annual deductible." }],
    }]))).toThrow(/purchas/i);
  });

  it("retains a non-default currency stated by the source", () => {
    const table = extractComparison(doc("Premium: EUR 900 per year."), {}, { useLlm: false });
    const row = table.rows.find((r) => r.factName === "premium")!;
    expect(row.values[0].qualifiers.currency).toBe("EUR");
  });

  it("never equates a currency or frequency mismatch, but still spots a real one", () => {
    const base = { documentId: "doc-1", display: "$1,100" };
    expect(
      hasSameScopeContradiction([
        { ...base, qualifiers: { currency: "USD", frequency: "annual" } },
        { ...base, display: "EUR 900", qualifiers: { currency: "EUR", frequency: "annual" } },
      ]),
    ).toBe(false);
    expect(
      hasSameScopeContradiction([
        { ...base, qualifiers: { currency: "USD", frequency: "monthly" } },
        { ...base, display: "$13,200", qualifiers: { currency: "USD", frequency: "annual" } },
      ]),
    ).toBe(false);
    expect(
      hasSameScopeContradiction([
        { ...base, qualifiers: { currency: "USD", frequency: "annual" } },
        { ...base, display: "$1,200", qualifiers: { currency: "USD", frequency: "annual" } },
      ]),
    ).toBe(true);
  });
});
