// M7 task 4: field grammars beyond digits. A display may not drop or flip
// negation, exceptions or network scope stated by its verified citations.
import { describe, expect, it } from "vitest";
import { checkDisplayGrounding, displayGrammarViolations } from "@/app/lib/evidence-verification";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { validateTable, type ComparisonTable } from "@/app/lib/extraction/types";

const ok = (display: string, quote: string) => checkDisplayGrounding(display, "x", [quote]).supported;

describe("negation", () => {
  it("'covered' flipped from 'not covered' is unsupported", () => {
    expect(ok("Maternity care: covered", "Maternity care: not covered.")).toBe(false);
    expect(ok("Maternity care is covered", "Maternity care is covered.")).toBe(true);
  });
  it("'not covered' invented over 'covered' is unsupported", () => {
    expect(ok("Dental: not covered", "Dental cleanings are covered.")).toBe(false);
  });
  it("a figure shown without the clause's 'not covered' is unsupported", () => {
    expect(ok("$500", "Cosmetic surgery up to $500 is not covered.")).toBe(false);
    expect(ok("$500, not covered", "Cosmetic surgery up to $500 is not covered.")).toBe(true);
  });
  it("'does not apply' cannot be dropped or flipped to 'applies'", () => {
    expect(ok("$250 deductible", "The $250 deductible does not apply to preventive care.")).toBe(false);
    expect(ok("Deductible applies to preventive care", "The deductible does not apply to preventive care.")).toBe(false);
    expect(ok("$250 deductible does not apply to preventive care", "The $250 deductible does not apply to preventive care.")).toBe(true);
  });
  it("'eligible' flipped from 'not eligible' is unsupported", () => {
    expect(ok("Dependents are eligible", "Dependents are not eligible.")).toBe(false);
  });
  it("'excluded' cannot be invented", () => {
    expect(ok("Vision exams excluded", "Vision exams: $20 copay.")).toBe(false);
  });
});

describe("exceptions", () => {
  it("'except' cannot be dropped from the figure's clause", () => {
    expect(ok("$30 copay", "$30 copay per visit except for specialist visits.")).toBe(false);
    expect(ok("$30 copay except for specialist visits", "$30 copay per visit except for specialist visits.")).toBe(true);
  });
  it("'unless' cannot be dropped, and cannot be invented", () => {
    expect(ok("$100 copay", "Emergency room $100 copay unless admitted.")).toBe(false);
    expect(ok("$100 copay unless admitted", "Emergency room $100 copay.")).toBe(false);
  });
  it("a marker in another clause of the citation does not govern the figure", () => {
    expect(ok("$30 copay", "Office visit $30 copay. Cosmetic procedures are not covered.")).toBe(true);
  });
  it("a marker carried by the value's qualifiers is not dropped", () => {
    expect(checkDisplayGrounding("$30 copay", "x", ["$30 copay except for specialist visits."], {
      qualifiers: { conditions: "except for specialist visits" },
    }).supported).toBe(true);
  });
});

describe("network scope", () => {
  it("'in-network' flipped from 'out-of-network' is unsupported", () => {
    expect(ok("In-network: 40% coinsurance", "Out-of-network: 40% coinsurance.")).toBe(false);
  });
  it("'out-of-network' flipped from 'in-network' is unsupported", () => {
    expect(ok("$250 out-of-network", "Deductible $250 in-network.")).toBe(false);
  });
  it("'preferred' is not satisfied by 'non-preferred'", () => {
    expect(displayGrammarViolations("Preferred pharmacy $10", ["Non-preferred pharmacy $10."])).toContain('marker "preferred" not in citations');
  });
  it("hyphenation and case differences are the same marker", () => {
    expect(ok("$250 In Network", "Deductible: $250 in-network.")).toBe(true);
  });
});

describe("structural claims", () => {
  it("only the flip/invent rules apply to a re-derived verbatim display", () => {
    expect(checkDisplayGrounding("Cosmetic (BASIC): $500", "x", ["Cosmetic Not covered $500"], { structural: true }).supported).toBe(true);
    expect(checkDisplayGrounding("Cosmetic (BASIC): covered", "x", ["Cosmetic Not covered"], { structural: true }).supported).toBe(false);
  });
});

describe("through the verification boundary", () => {
  it("a flipped negation makes the row NEEDS VERIFICATION, never SUPPORTED", () => {
    const docs = [{ documentId: "d1", filename: "d1.pdf", pageCount: 1, pages: ["Maternity care: not covered under this plan."] }];
    const table: ComparisonTable = {
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "d1", filename: "d1.pdf", pageCount: 1 }],
      rows: [{ factName: "maternity-coverage", verdict: "SUPPORTED", values: [{
        documentId: "d1", display: "Maternity care: covered", qualifiers: {},
        evidence: [{ documentId: "d1", page: 1, quote: "Maternity care: not covered under this plan." }],
      }] }],
    };
    const row = verifyComparisonTable(validateTable(table), docs).rows[0];
    expect(row.verdict).toBe("NEEDS VERIFICATION");
    expect(row.rationale).toMatch(/negation|covered/);
  });
});
