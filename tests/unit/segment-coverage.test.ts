// Owner decision 2026-11-22 (5) rule 1 — closes review B1′/B4. An answer
// sentence covered by one source line may omit only (a) articles, list
// markers and an ALL-CAPS topic heading, and (b) whole sibling label+value
// segments of that line. It never omits a word of its own segment — plan,
// tier, rider or group names, conditions and scope phrases included.
// "Primary care $30" from "Primary care $30 Specialist $300" stays valid.
// Reviewer's cases; synthetic text only.
import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

function check(answer: string, line: string) {
  const page = ["SCHEDULE", line, "End of schedule."].join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  const c = [{ documentId: "doc-1", page: 1, quote: line }];
  return verifyAnswerClaims(answer, c, c, docs).ok;
}

describe("B1′: a sentence never drops words of its own segment", () => {
  it.each([
    ["Maternity is covered.", "Under the Gold plan maternity is covered."],
    ["Maternity is covered.", "Under Plan B, maternity is covered."],
    ["Maternity is covered.", "Plan B - Maternity is covered."],
    ["Maternity is covered.", "Gold: Maternity is covered."],
    ["Maternity is covered.", "Employee: Maternity is covered."],
    ["Wellness exams are covered.", "For members over 65 wellness exams are covered."],
    ["Maternity is covered.", "Maternity is covered for employees."],
    ["Dental is covered.", "Dental is covered after 12 months."],
    ["$300 specialist.", "Copays: $30 primary care, $300 specialist"],
  ])("%s ← %s", (answer, line) => expect(check(answer, line)).toBe(false));
});

describe("B4: a column's value is never dropped from its row", () => {
  it("Ambulance $0 Up to $500 → 'Ambulance Up to $500'", () => {
    expect(check("Ambulance Up to $500", "Ambulance $0 Up to $500")).toBe(false);
  });
});

describe("controls: whole segments verify", () => {
  it.each([
    ["Primary care $30.", "Primary care $30 Specialist $300"],
    ["Specialist $300.", "Primary care $30 Specialist $300"],
    ["Primary care $30 Specialist $300.", "Primary care $30 Specialist $300"],
    ["Specialist $300 per visit.", "Primary care $30 per visit Specialist $300 per visit"],
    ["$300 for specialists.", "$30 for primary care, $300 for specialists"],
    ["Out-of-pocket maximum $2,000 per family.", "Out-of-pocket maximum $1,000 per person $2,000 per family"],
    ["Copays: $300 specialist.", "Copays: $30 primary care, $300 specialist"],
    ["Gold: Maternity is covered.", "Gold: Maternity is covered."],
    ["Covered as any sickness.", "MATERNITY: Covered as any sickness."],
    ["Maximum Limit $5,000,000", "• Maximum Limit $5,000,000"],
    ["Deductible is waived for preventive care.", "The deductible is waived for preventive care."],
    ["Emergency room copay $300.", "Emergency room copay $300. Ambulance $100."],
  ])("%s ← %s", (answer, line) => expect(check(answer, line)).toBe(true));
});
