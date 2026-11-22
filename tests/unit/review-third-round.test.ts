// Independent review of 613d17b..fa2958d (2026-11-22): every case below
// verified a wrong or misleading answer, or wrongly rejected a right one.
// Synthetic text only.
import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

function check(answer: string, pageLines: string[]) {
  const page = pageLines.join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  const c = [{ documentId: "doc-1", page: 1, quote: page }];
  return verifyAnswerClaims(answer, c, c, docs).ok;
}

describe("B1: the continuation must follow the line directly in the answer, every word", () => {
  it.each([
    ["Emergency room: $250 copay\nDeductible is met after 3 visits.", ["Emergency room: $250 copay", "after deductible is met", "Deductible is met after 3 visits."]],
    ["Emergency room visits are covered. Room and board is paid when admitted.", ["Emergency room visits are covered", "if admitted.", "Room and board is paid when admitted."]],
    ["exclusions apply. If you change plans you may be subject to review.", ["If you change plans you may be subject to", "exclusions apply.", "If you change plans you may be subject to review."]],
    ["Dental care is covered.", ["Dental care is covered", "if no.", "Vision: none."]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
  it("control: the continuation directly after the line verifies", () => {
    expect(check("Emergency room: $250 copay\nafter deductible is met", ["Emergency room: $250 copay", "after deductible is met", "Ambulance $100"])).toBe(true);
  });
});

describe("B2: one-line coverage keeps word order", () => {
  it.each([
    ["Vision is covered but dental is excluded", ["Dental is covered but vision is excluded"]],
    ["Vision is covered, dental is excluded.", ["Dental is covered, vision is excluded."]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
});

describe("B3: '$' and '%' are part of a figure", () => {
  it.each([
    ["Coinsurance 20%", ["Coinsurance $20"]],
    ["Copay 20% Coinsurance $20", ["Copay $20 Coinsurance 20%"]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
  it("control: the same unit verifies", () => expect(check("Coinsurance 20%", ["Coinsurance 20%"])).toBe(true));
});

describe("S1: only lower-case function words continue a line", () => {
  it("a line after 'Schedule A' is not a fragment", () => {
    expect(check("Ambulance $100 per trip.", ["Schedule A", "Ambulance $100 per trip."])).toBe(true);
  });
  it.each([
    ["Network: OR Copay $20", ["Network: OR", "Copay $20"]],
    ["Plan A Plan B Deductible $500", ["Plan A", "Plan B Deductible $500", "Plan A Deductible $250"]],
  ])("%s → rejected (rows not stitched)", (answer, page) => expect(check(answer, page)).toBe(false));
});

// Follow-up review of f299ff6: continuation lines that open with a figure or
// a capitalised qualifier word were not treated as continuations.
describe("follow-up: a figure or qualifier line continues an unfinished line", () => {
  it.each([
    ["Pre-existing conditions are covered.", ["Pre-existing conditions are covered", "50% of eligible expenses after 12 months.", "Ambulance $100"]],
    ["Physiotherapy is covered", ["Physiotherapy is covered", "$500 maximum per year.", "Ambulance $100"]],
    ["Dental is covered", ["Dental is covered", "Only for accidental injury.", "Ambulance $100"]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
  // The span path (which ACCEPTS answers) still joins a figure-led line only
  // after an open phrase (fourth review, second round); the whole sentence
  // above is therefore "cannot be confirmed" — fail-closed, not asserted here.
  it("control: a figure row after a finished line is separate", () => {
    expect(check("Ambulance $100 per trip.", ["Ambulance $100 per trip.", "$50 copay for each visit.", "Other"])).toBe(true);
  });
});

// Second follow-up review of 02e8fd5.
describe("second follow-up: no unordered multi-line coverage; more continuation openings", () => {
  it.each([
    ["Dental care is covered", ["Dental is covered", "for accidental injury", "Preventive care is covered."]],
    ["Maternity is covered", ["Maternity is covered", "12 Months waiting period applies.", "Other"]],
    ["Physiotherapy is covered", ["Physiotherapy is covered", "10", "visits per year.", "Other"]],
    ["Physiotherapy maximum", ["Physiotherapy maximum", "10 Visits per year.", "Other"]],
    ["Maternity is covered", ["Maternity is covered", "Twelve-month waiting period applies.", "Other"]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
  it("controls: a verbatim wrapped sentence still verifies; a footnote line is not a continuation", () => {
    expect(check("Dental treatment is covered for accidental injury only.", ["Dental treatment is covered", "for accidental injury only.", "Other"])).toBe(true);
    expect(check("Deductible $100", ["Deductible $100", "1 Per injury or sickness"])).toBe(true);
  });
});

// Third follow-up review of 5341f2f: the multi-line span path used the old,
// narrower continuation test; a qualifier line above was not a run-on.
describe("third follow-up: the span path uses the same continuation rules", () => {
  it.each([
    ["Dental treatment is covered for accidental injury", ["Dental treatment is covered for", "accidental injury", "Only in hospital."]],
    ["Maternity care is covered in full", ["Maternity care is covered in", "full", "Twelve-month waiting period applies."]],
    ["Dental treatment is covered for accidental injury.", ["Except as stated below", "Dental treatment is covered for", "accidental injury."]],
    ["Dental treatment is covered.", ["Except as stated below", "Dental treatment is covered.", "Vision: none."]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
  it("control: the span with nothing running on verifies", () => {
    expect(check("Dental treatment is covered for accidental injury.", ["BENEFITS", "Dental treatment is covered for", "accidental injury.", "Vision: none."])).toBe(true);
  });
});

// Fourth follow-up review of 9b80539: a lower-case scope line opening the
// passage; more scope openings.
describe("fourth follow-up: a qualifier line above runs on unless it ends the row above", () => {
  it.each([
    ["Dental treatment is covered.", ["except as stated below", "Dental treatment is covered.", "Vision: none."]],
    ["Dental treatment is covered.", ["unless otherwise stated", "Dental treatment is covered.", "Vision: none."]],
    ["Dental treatment is covered for accidental injury.", ["except as stated below", "Dental treatment is covered for", "accidental injury.", "Vision: none."]],
    ["Dental treatment is covered.", ["Notwithstanding the above", "Dental treatment is covered.", "Vision: none."]],
  ])("%s → rejected", (answer, page) => expect(check(answer, page)).toBe(false));
  it("control: a qualifier line that continues the row above ends it", () => {
    expect(check("Ambulance: $100 per trip", ["Emergency room: $250 copay", "after deductible is met", "Ambulance: $100 per trip"])).toBe(true);
  });
});
