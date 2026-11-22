// Owner decision 2026-11-22 (third round, 1 — blocking): a verified source
// line that continues onto the next line without ending its sentence is not
// an answer on its own. The answer must also include the continuation
// (observed on a real document: a wrapped table cell whose next line carries
// the word that gives the first line its meaning). Synthetic text only.
import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

function check(answer: string, pageLines: string[], citedLines: number[] = pageLines.map((_, i) => i)) {
  const page = pageLines.join("\n");
  const quote = citedLines.map((i) => pageLines[i]).join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  return verifyAnswerClaims(answer, [{ documentId: "doc-1", page: 1, quote }], [{ documentId: "doc-1", page: 1, quote: page }], docs);
}

const ER = ["Emergency room: $250 copay", "after deductible is met", "Ambulance: $100 per trip"];
const DENTAL = ["Dental treatment is covered for accidental injury", "only, not for routine care.", "Vision: not covered."];

describe("a line whose sentence continues on the next line is not an answer by itself", () => {
  it("rejects the first line of a wrapped cell (continuation carries a qualifier)", () => {
    expect(check("Emergency room: $250 copay", ER).ok).toBe(false);
  });
  it("rejects it when only the first line was cited (the page decides)", () => {
    expect(check("Emergency room: $250 copay", ER, [0]).ok).toBe(false);
  });
  it("rejects a no-figure sentence whose continuation narrows it", () => {
    expect(check("Dental treatment is covered for accidental injury.", DENTAL).ok).toBe(false);
  });
  it("rejects a fragment at the end of a line after an earlier sentence on the same line", () => {
    const page = ["Deductible is waived for preventive care. Emergency room $250 copay", "after deductible is met", "Ambulance: $100"];
    expect(check("Emergency room $250 copay", page).ok).toBe(false);
  });
  it("rejects when the answer has only part of the continuation", () => {
    expect(check("Emergency room: $250 copay\nafter deductible", ER).ok).toBe(false);
  });
});

describe("controls: complete sentences and included continuations still verify", () => {
  it("the answer includes the continuation verbatim across the line break", () => {
    expect(check("Emergency room: $250 copay after deductible is met", ER)).toEqual({ ok: true });
  });
  it("the answer includes the continuation on its own line", () => {
    expect(check("Emergency room: $250 copay\nafter deductible is met", ER)).toEqual({ ok: true });
  });
  it("a line that ends its sentence", () => {
    expect(check("Vision: not covered.", DENTAL)).toEqual({ ok: true });
  });
  it("a table row followed by another row (capitalised label)", () => {
    expect(check("Ambulance: $100 per trip", ER)).toEqual({ ok: true });
    expect(check("Primary care $30", ["Primary care $30", "Specialist $60"])).toEqual({ ok: true });
  });
  it("a sentence that ends inside the line before the wrapped fragment", () => {
    const page = ["Deductible is waived for preventive care. Emergency room $250 copay", "after deductible is met", "Ambulance: $100"];
    expect(check("Deductible is waived for preventive care.", page)).toEqual({ ok: true });
  });
  it("a next line that is a list item is not a continuation", () => {
    const page = ["Covered expenses include hospital room and board", "(a) surgery;", "(b) anaesthesia."];
    expect(check("Covered expenses include hospital room and board", page)).toEqual({ ok: true });
  });
  it("the last line of the page", () => {
    expect(check("Specialist $60", ["Primary care $30", "Specialist $60"])).toEqual({ ok: true });
  });
});

// Owner decision 2026-11-22 (6): the fragment rule looked at every page line
// that merely ENDS with the cited line's text ("states a $0 Deductible" for a
// cited heading line "Deductible"). A whole cited line matches only an equal
// page line; only the quote's first line (which may start mid-line) matches
// a line ending, at a word boundary. Every such occurrence must still pass.
describe("the fragment rule checks occurrences of the cited line itself", () => {
  const PAGE = ["Deductible for Eligible Medical Expenses", "Deductible", "• Per Illness or Injury Refer to the Declaration", "Copayment is not applicable if the Declaration states a $0 Deductible", "$5", "End."];
  it("a cited heading line is not judged by another line ending in the same word", () => {
    const quote = PAGE.slice(0, 3).join("\n");
    expect(verifyAnswerClaims("Deductible\n• Per Illness or Injury Refer to the Declaration", [{ documentId: "doc-1", page: 1, quote }], [{ documentId: "doc-1", page: 1, quote: PAGE.join("\n") }], [{ documentId: "doc-1", pages: [PAGE.join("\n")] }])).toEqual({ ok: true });
  });
  it("control: the same line that is a real fragment is still rejected", () => {
    const page = ["Header", "Emergency room: $250 copay", "after deductible is met", "Ambulance: $100"];
    expect(check("Emergency room: $250 copay", page, [0, 1, 2]).ok).toBe(false);
  });
});
