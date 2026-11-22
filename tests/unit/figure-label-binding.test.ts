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

// Independent review of a376299 (2026-11-22): swaps that still verified.
describe("review: swaps across table separators, figure-first lines, label numbers, short labels", () => {
  it.each([
    ["Primary care $300.", "Primary care | $30 | Specialist | $300"],
    ["Primary care $300.", "Primary care / $30 / Specialist / $300"],
    ["Primary care $300.", "Primary care\t$30\tSpecialist\t$300"],
    ["$300 for primary care.", "$30 for primary care $300 for specialists"],
    ["Tier 1 drugs $40.", "Tier 1 drugs $10 Tier 2 drugs $40"],
    ["Tier 2 drugs $10.", "Tier 1 drugs $10 Tier 2 drugs $40"],
    ["ER visit $30.", "Office visit $30 ER visit $300"],
    ["Primary care\n$300.", "Primary care $30 Specialist $300"],
    ["Emergency room $300.", "Primary care $30 Specialist $300 Emergency room"],
    ["Out-of-pocket maximum $2,000 per person.", "Out-of-pocket maximum $1,000 per person $2,000 per family"],
  ])("rejects case %#", (answer, line) => {
    expect(check(answer, line).ok).toBe(false);
  });

  it.each([
    ["$30 for primary care.", "$30 for primary care $300 for specialists"],
    ["Specialist $300.", "Primary care | $30 | Specialist | $300"],
    ["Tier 2 drugs $40.", "Tier 1 drugs $10 Tier 2 drugs $40"],
    ["ER visit $300.", "Office visit $30 ER visit $300"],
    ["Out-of-pocket maximum $2,000 per family.", "Out-of-pocket maximum $1,000 per person $2,000 per family"],
    ["Primary care $30 Specialist $300 Emergency room.", "Primary care $30 Specialist $300 Emergency room"],
    ["Coinsurance out-of-network2 70% of usual & customary", "Coinsurance out-of-network2 70% of usual & customary"],
  ])("verifies case %#", (answer, line) => {
    expect(check(answer, line)).toEqual({ ok: true });
  });
});

// Follow-up review of 19a03fc (2026-11-22): letter labels, repeated values
// with different units, mixed marked/plain numbers, plain-number-only lines,
// and a both-sides sentence on a header line.
describe("follow-up review: letter labels, repeated values, plain numbers, side order", () => {
  it.each([
    ["Part A deductible $240.", "Part A deductible $1,600 Part B deductible $240"],
    ["Plan A $30.", "Plan A $10 Plan B $30"],
    ["Option A copay $30.", "Option A copay $10 Option B copay $30"],
    ["Inpatient $500 per visit.", "Inpatient $500 per day Outpatient $500 per visit"],
    ["Primary care $30 per day.", "Primary care $30 per visit Specialist $30 per day"],
    ["Copay 500.", "Deductible 500 Copay $30"],
    ["Deductible $30.", "Deductible 500 Copay $30"],
    ["Copay $500.", "Deductible $500 Copay 30"],
    ["Copay 20.", "Coinsurance 20 Copay $30"],
    ["Tier 2 drugs 10.", "Tier 1 drugs 10 Tier 2 drugs 40"],
    ["Primary care $300 specialist.", "Copays: $30 primary care, $300 specialist"],
    ["Specialist primary care $300.", "Copays: $30 primary care, $300 specialist"],
  ])("rejects case %#", (answer, line) => {
    expect(check(answer, line).ok).toBe(false);
  });

  it.each([
    ["Part B deductible $240.", "Part A deductible $1,600 Part B deductible $240"],
    ["Outpatient $500 per visit.", "Inpatient $500 per day Outpatient $500 per visit"],
    ["Copay $30.", "Deductible 500 Copay $30"],
    ["Tier 2 drugs 40.", "Tier 1 drugs 10 Tier 2 drugs 40"],
    ["$300 specialist.", "Copays: $30 primary care, $300 specialist"],
    ["Inpatient $500 per day Outpatient $500 per visit.", "Inpatient $500 per day Outpatient $500 per visit"],
    ["Emergency room copay (waived if admitted) $300 Hospitalization copay $300", "Emergency room copay (waived if admitted) $300 Hospitalization copay $300"],
    ["Emergency room copay (waived if admitted) $300", "Emergency room copay (waived if admitted) $300 Hospitalization copay $300"],
  ])("verifies case %#", (answer, line) => {
    expect(check(answer, line)).toEqual({ ok: true });
  });
});
