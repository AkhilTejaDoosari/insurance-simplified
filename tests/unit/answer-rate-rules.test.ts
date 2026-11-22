// Owner decision 2026-11-22 (third round, 2): the most common causes of
// "cannot be confirmed" on answerable questions, fixed with general rules
// that do not loosen verification; plus the mirror of the misleading-
// fragment rule (a line whose sentence began on the line above). Every
// case was observed in the 40-question benchmark. Synthetic text only.
import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

function check(answer: string, pageLines: string[]) {
  const page = pageLines.join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  const c = [{ documentId: "doc-1", page: 1, quote: page }];
  return verifyAnswerClaims(answer, c, c, docs);
}

describe("A: a line ending in a function word continues onto a capitalised line", () => {
  const PAGE = ["Pre-existing Conditions", "Charges relating to any condition that existed within 36 months prior to the", "Effective Date are excluded until 12 months of continuous coverage.", "Ambulance $100"];
  it("the whole wrapped sentence verifies", () => {
    expect(check("Charges relating to any condition that existed within 36 months prior to the Effective Date are excluded until 12 months of continuous coverage.", PAGE)).toEqual({ ok: true });
  });
  it("a figure line after 'the' continues it", () => {
    const page = ["Coverage excludes regions with a travel advisory issued in the", "60 days prior to your arrival date.", "Other terms"];
    expect(check("Coverage excludes regions with a travel advisory issued in the 60 days prior to your arrival date.", page)).toEqual({ ok: true });
  });
  it("control: rows are not stitched (line ends in a label word, not a function word)", () => {
    expect(check("Emergency Room Deductible $250", ["Emergency Room", "Deductible $250", "Ambulance $100"]).ok).toBe(false);
    expect(check("Primary care $30 Specialist $300", ["Primary care $30", "Specialist $300"]).ok).toBe(false);
  });
});

describe("whole-quote coverage keeps word order (a pre-existing hole found here)", () => {
  it("an inverted sentence built from the quote's words is rejected", () => {
    expect(check("Dental is excluded; vision is excluded", ["Dental is excluded; vision is covered"]).ok).toBe(false);
  });
  it("control: the sentence in the quote's order verifies", () => {
    expect(check("Dental treatment is covered for accidental injury only.", ["Dental treatment is covered", "for accidental injury only."])).toEqual({ ok: true });
  });
});

describe("C: a figure sentence is checked against the line that holds its figures", () => {
  it("the second of two like lines", () => {
    expect(check("Insured pays 20%", ["Plan pays 90%", "Insured pays 10%", "Plan pays 80%", "Insured pays 20%"])).toEqual({ ok: true });
  });
  it("control: a figure on no line is rejected", () => {
    expect(check("Insured pays 30%", ["Insured pays 10%", "Insured pays 20%"]).ok).toBe(false);
    expect(check("Emergency room $200 copay", ["Emergency room $100 copay", "Office visit $200 copay"]).ok).toBe(false);
  });
});

describe("identity: a sentence identical to its source lines is bound", () => {
  it("several values in an ambiguous layout", () => {
    const page = ["Deductible for Eligible Medical Expenses", "Deductible $0, $100, $250 or $500 per Insured Person, as indicated", "on the Declaration", "Coinsurance"];
    expect(check("Deductible $0, $100, $250 or $500 per Insured Person, as indicated on the Declaration", page)).toEqual({ ok: true });
  });
  it("control: the same values in another order are rejected", () => {
    const page = ["Deductible $0, $100, $250 or $500 per Insured Person, as indicated", "on the Declaration", "Coinsurance"];
    expect(check("Deductible $100, $0, $250 or $500 per Insured Person, as indicated on the Declaration", page).ok).toBe(false);
  });
});

describe("E (mirror of the fragment rule): a line whose sentence began on the line above", () => {
  const PAGE = ["If you change plans you may be subject to", "exclusions, including a new waiting period.", "Maternity Covered as any sickness"];
  it("is rejected without the start of its sentence", () => {
    expect(check("exclusions, including a new waiting period.", PAGE).ok).toBe(false);
  });
  it("verifies with the whole sentence", () => {
    expect(check("If you change plans you may be subject to exclusions, including a new waiting period.", PAGE)).toEqual({ ok: true });
  });
  it("control: a line after a completed sentence", () => {
    expect(check("Maternity Covered as any sickness", PAGE)).toEqual({ ok: true });
  });
});
