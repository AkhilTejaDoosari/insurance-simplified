// Owner directive 2026-11-22 (BLOCKING): a figure attached to the wrong label
// on the same line must be rejected. Reviewer finding: coveringQuote accepted
// "Primary care visits cost $300" against "Primary care $30 Specialist $300"
// because every word and the figure appear somewhere on the line. Synthetic
// text only.
import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

function check(answer: string, line: string) {
  const page = ["SCHEDULE OF BENEFITS", line, "See the policy for details."].join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  const chunk = [{ documentId: "doc-1", page: 1, quote: page }];
  return verifyAnswerClaims(answer, [{ documentId: "doc-1", page: 1, quote: line }], chunk, docs);
}

const LABEL_FIRST = "Primary care $30 Specialist $300";
const COMMA = "Primary care $30, Specialist $300";
const FIGURE_FIRST = "$30 for primary care, $300 for specialists";
const PERCENT = "Hospital 80% Physician 60%";
const UNITS = "Pre-existing conditions covered after 12 months maximum $500";
const PER = "Primary care $30 per visit Specialist $300 per visit";

describe("a figure bound to another label on the same line is rejected", () => {
  it.each([
    ["Primary care visit $300.", "Primary care $30 per visit Specialist $300"],
    ["Primary care $300.", LABEL_FIRST],
    ["$300 Primary care.", LABEL_FIRST],
    ["Specialist $30.", LABEL_FIRST],
    ["Primary care $300 Specialist $30.", LABEL_FIRST],
    ["Specialist $30.", COMMA],
    ["Primary care, $300.", COMMA],
    ["$300 for primary care.", FIGURE_FIRST],
    ["Physician 80%.", PERCENT],
    ["Pre-existing conditions maximum after 12 months.", UNITS],
    ["Specialist $30 per visit.", PER],
  ])("rejects case %#", (answer, line) => {
    expect(check(answer, line).ok).toBe(false);
  });
});

describe("controls: a figure stated with its own label still verifies", () => {
  it.each([
    ["Primary care $30.", LABEL_FIRST],
    ["Specialist $300.", LABEL_FIRST],
    ["$30 Primary care.", LABEL_FIRST],
    ["Primary care $30 Specialist $300.", LABEL_FIRST],
    ["Specialist $300.", COMMA],
    ["$300 for specialists.", FIGURE_FIRST],
    ["Physician 60%.", PERCENT],
    ["Pre-existing conditions covered after 12 months.", UNITS],
    ["Pre-existing conditions covered after 12 months maximum $500.", UNITS],
    ["Primary care $30 per visit.", PER],
    ["Specialist $300 per visit.", PER],
    ["Deductible $500 per year.", "Deductible $500 per year"],
  ])("verifies case %#", (answer, line) => {
    expect(check(answer, line)).toEqual({ ok: true });
  });
});
