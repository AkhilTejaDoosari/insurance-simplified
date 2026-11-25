// Generalization fix 4 (2026-11-25): what is reported as "not found" depends
// on the document's form; and a fact the SBC states but that was not read is
// withheld, never absent. Synthetic text.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { absenceNotices } from "@/app/lib/presentation/adaptive";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";

const sbc = (id: string, name = "Northwind: Harbor PPO") => ({
  documentId: id, filename: `${id}.pdf`, pageCount: 2, pages: [
    `Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services Coverage Period: 01/01/2031 – 12/31/2031\n${name} Coverage for: Family | Plan Type: PPO\nThe Summary of Benefits and Coverage (SBC) document will help you choose a health plan.\nImportant Questions Answers Why This Matters:\nWhat is the overall deductible?\n$900\nSome other explanation.`,
    "Common Medical Event Services You May Need\nNetwork Provider (You will pay the least)\nOut-of-Network Provider (You will pay the most)\nEmergency room care 10% coinsurance 10% coinsurance\nYou must call.",
  ],
});
const brochure = { documentId: "b", filename: "b.pdf", pageCount: 1, pages: ["Plan name: Alpha\nUrgent care $50 copay/visit. This brochure describes the benefits of the plan in words that fill the page so that it counts as read."] };
const table = (docs: (ReturnType<typeof sbc>)[]) => verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
const missing = (docs: (ReturnType<typeof sbc>)[], ids?: string[]) => absenceNotices(table(docs) as never, ids).map((n) => n.concept);
const TRAVEL = ["emergency-evacuation", "repatriation", "terrorism-coverage", "bedside-visit", "incidental-trip", "student-eligibility"];

describe("absence notices follow the document's form", () => {
  it("does not report travel fields missing from an employer SBC", () => {
    const seen = missing([sbc("a")]);
    for (const f of TRAVEL) expect(seen).not.toContain(f);
    expect(seen).toContain("policy-limit");
    const asked = suggestQuestions(table([sbc("a")])).map((q) => q.motivatingFact);
    for (const f of TRAVEL) expect(asked).not.toContain(f);
  });
  it("keeps student and evacuation fields for a student SBC", () => {
    const seen = missing([sbc("a", "Northwind: Harbor Student PPO")]);
    expect(seen).toContain("repatriation");
    expect(seen).not.toContain("terrorism-coverage");
  });
  it("keeps every field for other documents, and for a mixed upload", () => {
    expect(missing([brochure])).toEqual(expect.arrayContaining(TRAVEL));
    expect(missing([sbc("a"), brochure])).toEqual(expect.arrayContaining(TRAVEL));
    expect(missing([sbc("a"), brochure], ["a"])).not.toContain("terrorism-coverage");
  });
  it("keeps the absence record itself", () => {
    expect(table([sbc("a")]).coverage!.absences.map((a) => a.factName)).toContain("terrorism-coverage");
  });
  it("withholds what the form states but was not read", () => {
    const rows = table([sbc("a")]).rows;
    for (const [fact, quote] of [["annual-deductible", "What is the overall deductible?"], ["emergency-care", "Emergency room care 10% coinsurance 10% coinsurance"]]) {
      const row = rows.find((r) => r.factName === fact)!;
      expect([row.verdict, row.values]).toEqual(["NEEDS VERIFICATION", []]);
      expect(row.withheld!.map((w) => w.quote)).toContain(quote);
    }
  });
});
