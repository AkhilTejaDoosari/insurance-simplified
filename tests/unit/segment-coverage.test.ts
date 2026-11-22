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

// Review of 1a9652c/6c0811b: R1-a (span path), R1-b (ALL-CAPS plan names),
// R1-c (bare value borrowing a label), nit (clipped words).
function checkPage(answer: string, pageLines: string[]) {
  const page = pageLines.join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  const c = [{ documentId: "doc-1", page: 1, quote: page }];
  return verifyAnswerClaims(answer, c, c, docs).ok;
}
describe("review: only an allow-listed ALL-CAPS topic heading may be omitted", () => {
  it.each(["Gold", "ELITE", "Basic", "Employee", "Retirees", "Family", "Premier Plus", "Travel Medical Basic"])("span path, label %s", (label) => {
    expect(checkPage("Maternity is covered after a 12 month waiting period.", ["Other: Maternity is not covered.", `${label}: Maternity is covered after a`, "12 month waiting period.", "End."])).toBe(false);
  });
  it.each([
    ["Maternity is covered.", "ELITE: Maternity is covered."],
    ["Wellness exams are covered.", "FAMILY: Wellness exams are covered."],
  ])("one line: %s ← %s", (answer, line) => expect(check(answer, line)).toBe(false));
  it("control: an allow-listed topic heading on the span path", () => {
    expect(checkPage("All charges for prenatal care are excluded from this insurance.", ["(5) MATERNITY AND NEWBORN CARE: All charges for prenatal care are", "excluded from this insurance.", "End."])).toBe(true);
  });
});
describe("review: a bare value never borrows a label", () => {
  it.each([
    ["Deductible $1,000", "Deductible $500 $1,000"],
    ["Deductible In-network $1,000", "Deductible In-network $500 $1,000"],
  ])("%s ← %s", (answer, line) => expect(check(answer, line)).toBe(false));
  it("control: a value with its own unit words inherits", () => {
    expect(check("Out-of-pocket maximum $2,000 per family.", "Out-of-pocket maximum $1,000 per person $2,000 per family")).toBe(true);
  });
});
describe("review nit: word forms are exact or plural", () => {
  it("'cover' is not 'covered'", () => expect(check("Maternity is cover.", "Maternity is covered.")).toBe(false));
  it("control: 'visit' / 'visits'", () => expect(check("Two office visit per year.", "Two office visits per year")).toBe(true));
});
