// Owner decision 2026-11-22 (1): a sentence quoting wording that wraps over
// several source lines verifies when it differs from the page ONLY in
// whitespace and line breaks. Every word, figure and punctuation mark must
// still match exactly. Reproduced on doc 02 (maternity, three wrapped lines
// ending "80% in-network, 70% URC out-of-network"). Synthetic text only.
import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

const WRAPPED = [
  "Maternity: covered medical expenses include charges made by a physician",
  "for pregnancy and childbirth services and supplies, including prenatal visits",
  "(non-preventive care), delivery and postnatal visits 80% in-network, 70% URC out-of-network",
].join("\n");
const TABLE = ["Primary care $30", "Specialist $300"].join("\n");

function check(answer: string, quote: string) {
  const page = ["BENEFITS", quote, "See the policy for details."].join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  return verifyAnswerClaims(answer, [{ documentId: "doc-1", page: 1, quote }], [{ documentId: "doc-1", page: 1, quote: page }], docs);
}

const JOINED = WRAPPED.replace(/\n/g, " ");

describe("verbatim quote across line breaks (whitespace only)", () => {
  it("verifies the wrapped sentence joined into one line", () => {
    expect(check(JOINED, WRAPPED)).toEqual({ ok: true });
  });
  it("verifies with different spacing at the line breaks", () => {
    expect(check(WRAPPED.replace(/\n/g, "   "), WRAPPED)).toEqual({ ok: true });
  });
});

describe("anything but whitespace still differs → rejected", () => {
  it.each([
    ["a punctuation mark changed", JOINED.replace("in-network, 70%", "in-network; 70%")],
    ["a punctuation mark dropped", JOINED.replace("(non-preventive care),", "(non-preventive care)")],
    ["a figure changed", JOINED.replace("80%", "90%")],
    ["a word changed", JOINED.replace("postnatal", "prenatal")],
    ["a word dropped", JOINED.replace("delivery and ", "")],
    ["letter case changed", JOINED.replace("URC", "urc")],
    ["a figure moved to another label across lines", "$30 Specialist $300"],
  ])("%s", (_label, answer) => {
    expect(check(answer, answer.startsWith("$30") ? TABLE : WRAPPED).ok).toBe(false);
  });
});

describe("a span cannot drop a negation from the lines it spans", () => {
  it("rejects a span that starts after 'not payable' on the same line", () => {
    const quote = ["Benefits are not payable for dental", "implants $500 per year"].join("\n");
    expect(check("dental implants $500 per year", quote).ok).toBe(false);
  });
  it("the whole wording including the negation verifies", () => {
    const quote = ["Benefits are not payable for dental", "implants $500 per year"].join("\n");
    expect(check("Benefits are not payable for dental implants $500 per year", quote)).toEqual({ ok: true });
  });
});

// Review of af2aa82 (2026-11-22): B1 a span stitched one table row's tail to
// the next row's head; B2 a number cut at a thousands comma matched.
describe("review: a span joins only wrapped continuation lines, never rows or partial numbers", () => {
  it("rejects the tail of one row joined to the head of the next", () => {
    expect(check("$30 copay Emergency room.", "Specialist visit\n$30 copay\nEmergency room\n$300 copay").ok).toBe(false);
    expect(check("$30 copay Emergency room.", "$30 copay\nEmergency room").ok).toBe(false);
  });
  it("rejects a number cut at a thousands separator", () => {
    expect(check("Annual maximum $1,000.", "Annual\nmaximum $1,000,000 per year and $1,000 per visit").ok).toBe(false);
  });
  it("a sentence wrapped onto lower-case continuation lines still verifies", () => {
    expect(check(JOINED, WRAPPED)).toEqual({ ok: true });
  });
});
