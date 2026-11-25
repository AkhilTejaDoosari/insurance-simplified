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
const HEAD = "Common Medical Event Services You May Need\nWhat You Will Pay Limitations, Exceptions, & Other Important\nInformationNetwork Provider\n(You will pay the least)\nOut-of-Network Provider\n(You will pay the most)";
const ROWS = [
  "If you visit a health care", "provider’s office or clinic",
  "Primary care visit to treat an", "injury or illness $35 copay/visit $35 copay and 30%", "coinsurance/visit None",
  "Specialist visit 20% coinsurance 40% coinsurance None",
  "Preventive care/screening/", "immunization No charge Not covered",
  "You may have to pay for services that aren’t", "preventive. Ask your provider if the services", "needed are preventive. Then check what your plan", "will pay for.",
  "If you have a test", "Diagnostic test (x-ray, blood", "work) 10% coinsurance 30% coinsurance None",
  "Imaging (CT/PET scans,", "MRIs) 10% coinsurance 30% coinsurance Preauthorization required",
  "If you need drugs to treat", "your illness or condition", "Generic drugs $10 copay Not covered None",
  "If you have outpatient", "surgery", "Facility fee (e.g.,", "ambulatory surgery center) 10% coinsurance 30% coinsurance None",
  "Physician/surgeon fees 10% coinsurance 30% coinsurance None",
  "If you need immediate", "medical attention",
  "Emergency room care $150 copay/visit $150 copay/visit You must call within 24 hours if admitted.",
  "Emergency medical", "transportation 20% coinsurance *20% coinsurance *Network deductible applies.",
  "Urgent care $50 copay/visit $60 copay/visit",
  "If you have a hospital stay", "Facility fee (e.g., hospital", "room) 10% coinsurance 30% coinsurance None",
  "Physician/surgeon fees 10% coinsurance 30% coinsurance None",
  "If you need mental health,", "behavioral health, or", "substance abuse services", "Outpatient services 10% coinsurance 30% coinsurance None", "Inpatient services 10% coinsurance 30% coinsurance None",
  "If you are pregnant", "Office visits No charge 30% coinsurance Maternity care may include tests.",
  "Childbirth/delivery", "professional services", "No charge 30% coinsurance",
  "Childbirth/delivery facility", "services 10% coinsurance 30% coinsurance None",
  "If you need help recovering", "or have other special health", "needs", "Home health care 10% coinsurance Not covered Preauthorization required",
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

describe("SBC form text", () => {
  it("shows no template sentence as a fact", () => {
    const all = table(doc()).rows.flatMap((r) => r.values.map((v) => v.display));
    for (const text of ["see the Glossary", "may apply. For example", "The Summary of Benefits and Coverage", "Non-emergency care", "needed are preventive. Then check what your plan"]) {
      expect(all.filter((d) => d.includes(text) && !d.startsWith("Preventive care"))).toEqual([]);
    }
  });

  const at = (fact: string, rows = ROWS) => shown(doc(rows), fact).map((v): [string, string] => [v.qualifiers.networkTier ?? "", v.display]);

  it("reads each complete cell under the page's own heading", () => {
    expect(at("primary-care-visit")).toEqual([
      ["Network Provider", `Primary care visit to treat an injury or illness (Network Provider): $35 copay/visit\n${NOTE}`],
      ["Out-of-Network Provider", `Primary care visit to treat an injury or illness (Out-of-Network Provider): $35 copay and 30% coinsurance/visit\n${NOTE}`],
    ]);
    expect(at("emergency-care").map((v) => v[1])).toEqual([
      `Emergency room care (Network Provider): $150 copay/visit\nYou must call within 24 hours if admitted.\n${NOTE}`,
      `Emergency room care (Out-of-Network Provider): $150 copay/visit\nYou must call within 24 hours if admitted.\n${NOTE}`,
    ]);
    expect(at("ambulance")[1][1]).toContain(": *20% coinsurance\n*Network deductible applies.");
    expect(shown(doc(), "emergency-care").every((v) => v.planId)).toBe(true);
  });

  it("never reads the pregnancy office visits as a primary care visit", () => {
    expect(at("primary-care-visit").some((v) => v[1].includes("No charge"))).toBe(false);
    expect(at("maternity-coverage").map((v) => v[1].split(" (")[0])).toEqual(expect.arrayContaining(["Office visits"]));
  });

  it("rows of one fact never read as a contradiction", () => {
    expect(table(doc()).rows.find((r) => r.factName === "mental-health")!.verdict).not.toBe("CONFLICTED");
  });

  it("does not read a row with no limitation of its own, or the last row of a page", () => {
    expect(at("urgent-care")).toEqual([]);
    expect(at("maternity-coverage").some((v) => v[1].startsWith("Childbirth/delivery professional"))).toBe(false);
    expect(at("home-nursing")).toEqual([]);
  });

  const swap = (from: string, to: string[]) => ROWS.flatMap((r) => (r === from ? to : [r]));
  const ER = "Emergency room care $150 copay/visit $150 copay/visit You must call within 24 hours if admitted.";
  const SP = "Specialist visit 20% coinsurance 40% coinsurance None";
  // ---- independent review round 3 (2026-11-25): C1–C7
  it.each([
    ["a limitation wrapped before 'if you'", "emergency-care", swap(ER, ["Emergency room care $300 copay/visit $300 copay/visit Copay waived", "if you are admitted to the hospital."])],
    ["a limitation wrapped before a service word", "emergency-care", swap(ER, ["Emergency room care $300 copay/visit $300 copay/visit Prior approval required for all", "inpatient services or benefits drop."])],
    ["a footer inside the row", "emergency-care", swap(ER, ["Emergency room care $300 copay/visit $300 copay/visit Copay waived only for", "Page 2 of 6", "admissions."])],
    ["another row below it", "specialist-visit", swap(SP, ["Specialist visit $50 copay/visit 40% coinsurance Preauth may apply.", "Chiropractic care $30 copay/visit Not covered 20 visits."])],
    ["another row's costs as its limitation", "specialist-visit", swap(SP, ["Specialist visit $50 copay/visit 40% coinsurance", "Telehealth visit No charge Not covered"])],
    ["cost wording it cannot parse", "specialist-visit", swap(SP, ["Specialist visit $40 copay for first 3 visits, then 20% 40% coinsurance None"])],
    ["a moved cell condition", "specialist-visit", swap(SP, ["Specialist visit $50 copay/visit; 40% coinsurance Preauthorization is required or", "deductible does not apply benefits reduced."])],
    ["an open limitation", "specialist-visit", swap(SP, ["Specialist visit $50 copay/visit 40% coinsurance Limited to visits that"])],
    ["a sub-row under another service", "maternity-coverage", swap("Outpatient services 10% coinsurance 30% coinsurance None", ["Outpatient services", "Office visits", "$25 copay/visit 40% coinsurance Other outpatient services may differ."]).filter((r) => r !== "services 10% coinsurance 30% coinsurance None")],
    ["a stray mention of the label", "emergency-care", [...ROWS, "Emergency room care is explained in your booklet."]],
  ])("does not read a row with %s", (_label, fact, rows) => {
    expect(at(fact as string, rows as string[])).toEqual([]);
  });

  it.each([
    ["a designated first column", "InformationDesignated Network Provider"],
    ["a third cost column", "InformationNetwork Provider\n(You will pay the least)\nStandard Network"],
  ])("reads no row under %s", (_label, heading) => {
    const d = doc();
    const other = { ...d, pages: d.pages.map((p) => p.replace("InformationNetwork Provider", heading)) };
    expect(shown(other, "specialist-visit")).toEqual([]);
  });

  it("reads nothing from the chart when the text does not run cell by cell", () => {
    const rows = ROWS.map((r) => r.replace("preventive. Ask your provider", "$9 preventive. Ask your provider"));
    expect(at("specialist-visit", rows)).toEqual([]);
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
