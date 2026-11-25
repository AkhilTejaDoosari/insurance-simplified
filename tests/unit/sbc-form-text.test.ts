// Generalization fix 3 (2026-11-25): an SBC's template sentences are not
// facts; its cost-chart rows are read whole. Synthetic text, federal wording.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";

const P1 = [
  "Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services Coverage Period: 01/01/2031 – 12/31/2031",
  "Northwind Mutual: Harbor Choice PPO Coverage for: Individual + Family | Plan Type: PPO",
  "The Summary of Benefits and Coverage (SBC) document will help you choose a health plan. This is only a summary.",
  "northwind.test. For general definitions of common terms, such as allowed amount, coinsurance, see the Glossary.",
  "Important Questions Answers Why This Matters:", "What is the overall", "deductible? $900 Individual / $1,800 Family",
  "Generally, you must pay all of the costs from providers up to the deductible amount before", "this plan begins to pay.",
  "But a copayment or coinsurance may apply. For example, this plan covers certain preventive services.",
].join("\n");
const NOTE = "All copayment and coinsurance costs shown in this chart are after your deductible has been met, if a deductible applies.";
const HEAD = "Common Medical Event Services You May Need\nWhat You Will Pay\nNetwork Provider\n(You will pay the least)\nOut-of-Network Provider\n(You will pay the most)";
const ROWS = [
  "If you visit a health care", "provider’s office or clinic",
  "Primary care visit to treat an", "injury or illness $35 copay/visit $35 copay and 30%", "coinsurance/visit None",
  "Specialist visit 20% coinsurance 40% coinsurance None",
  "Preventive care/screening/", "immunization No charge Not covered",
  "You may have to pay for services that aren’t", "preventive. Ask your provider if the services", "needed are preventive. Then check what your plan", "will pay for.",
  "Emergency room care $150 copay/visit $150 copay/visit Copay waived if admitted; however, will be subject", "to the inpatient copay listed below.",
  "Urgent care $50 copay/visit $60 copay/visit",
  "If you are pregnant", "Office visits No charge 30% coinsurance Cost sharing does not apply for preventive", "services.",
  "Childbirth/delivery", "professional services", "No charge 30% coinsurance",
  "Home health care 10% coinsurance Not covered Preauthorization required",
];
const EXCL = [
  "Excluded Services & Other Covered Services:",
  "Services Your Plan Generally Does NOT Cover (Check your policy or plan document for more information and a list of any other excluded services.)",
  "• Dental care (Adult)", "• Non-emergency care when traveling outside the U.S.",
  "Other Covered Services (Limitations may apply to these services. This isn’t a complete list. Please see your plan document.)",
  "• Chiropractic care (24 visit limit / year)", "• Non-emergency care when traveling outside the U.S.",
  "Your Rights to Continue Coverage: There are agencies that can help if you want to continue your coverage after it ends.",
];
const doc = (rows = ROWS, p1 = P1) => ({
  documentId: "doc-1", filename: "x.pdf", pageCount: 3,
  pages: [p1, [NOTE, HEAD, ...rows].join("\n"), [HEAD, "Hospice services 10% coinsurance Not covered None", ...EXCL].join("\n")],
});
const table = (d: ReturnType<typeof doc>) => verifyComparisonTable(validateTable(extractFallback([d], {})), [d]);
const shown = (d: ReturnType<typeof doc>, fact: string) => table(d).rows.find((r) => r.factName === fact)!.values;
const LEAD = " — you pay, in the form's column order (network provider, then out-of-network provider), then limitations: ";

describe("SBC form text", () => {
  it("shows no template sentence as a fact", () => {
    const all = table(doc()).rows.flatMap((r) => r.values.map((v) => v.display));
    for (const text of ["see the Glossary", "may apply. For example", "The Summary of Benefits and Coverage", "Non-emergency care", "needed are preventive. Then check what your plan"]) {
      expect(all.filter((d) => d.includes(text) && !d.startsWith("Preventive care"))).toEqual([]);
    }
  });

  it("reads a whole row: wrapped label, wrapped cost and limitation", () => {
    expect(shown(doc(), "primary-care-visit").map((v) => v.display)).toEqual([
      `Primary care visit to treat an injury or illness${LEAD}$35 copay/visit $35 copay and 30% coinsurance/visit None\n${NOTE}`,
    ]);
    expect(shown(doc(), "emergency-care").map((v) => v.display)).toEqual([
      `Emergency room care${LEAD}$150 copay/visit $150 copay/visit Copay waived if admitted; however, will be subject to the inpatient copay listed below.\n${NOTE}`,
    ]);
    expect(shown(doc(), "emergency-care")[0].planId).toBeTruthy();
  });

  it("never reads the pregnancy office visits as a primary care visit", () => {
    expect(shown(doc(), "primary-care-visit").some((v) => v.display.includes("No charge"))).toBe(false);
    expect(shown(doc(), "maternity-coverage").map((v) => v.display.split(" — ")[0])).toEqual(["Office visits"]);
  });

  it("does not read a row whose limitation may be a merged cell", () => {
    expect(shown(doc(), "urgent-care")).toEqual([]);
    expect(shown(doc(), "maternity-coverage").some((v) => v.display.startsWith("Childbirth"))).toBe(false);
  });

  it("does not read the last row of a page, which may continue", () => {
    expect(shown(doc(), "home-nursing")).toEqual([]);
  });

  it("reads nothing from the chart when the text does not run cell by cell", () => {
    const rows = ROWS.map((r) => r.replace("preventive. Ask your provider", "$9 preventive. Ask your provider"));
    expect(shown(doc(rows), "specialist-visit")).toEqual([]);
  });

  it("reads no row when there are more than two cost columns", () => {
    const d = doc();
    const tiers = { ...d, pages: d.pages.map((p) => p.replace("(You will pay the least)\n", "(You will pay the least)\nTier 2 Provider\n")) };
    expect(shown(tiers, "specialist-visit")).toEqual([]);
  });

  it("shows only the period of the title line as coverage dates", () => {
    expect(shown(doc(), "coverage-dates").map((v) => v.display)).toEqual(["Coverage Period: 01/01/2031 – 12/31/2031"]);
    expect(shown(doc(), "eligibility-for-you").map((v) => v.display)).toEqual(["Coverage Period: 01/01/2031 – 12/31/2031"]);
  });

  it("still reads the other covered services list", () => {
    expect(shown(doc(), "chiropractic").map((v) => v.display)).toEqual(["• Chiropractic care (24 visit limit / year)"]);
  });

  it("leaves an ordinary document's lines alone", () => {
    const d = { documentId: "doc-1", filename: "x.pdf", pageCount: 1, pages: ["Plan name: Alpha\nUrgent care $50 copay/visit"] };
    expect(shown(d as never, "urgent-care").map((v) => v.display)).toEqual(["Urgent care $50 copay/visit"]);
  });
});
