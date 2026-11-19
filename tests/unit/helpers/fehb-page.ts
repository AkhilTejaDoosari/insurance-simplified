// A synthetic FEHB-style first page (fictional plan "Zenith Care"): FEHB
// context plus a complete enrollment record declaring Self Only, Self Plus One
// and Self and Family. Stands in for a real brochure page 1 in logic tests.
// It must not contain disclaimer words ("example", "sample", …): page 1 is
// governing context for statements on later pages.
export const SYNTHETIC_FEHB_P1 = [
  "Zenith Care",
  "www.zenith-care.test",
  "2027",
  "A Fee-for-Service Plan (Zenith Care) with a Preferred Provider Organization",
  "Who may enroll in this Plan: Federal employees eligible for the Federal Employees Health Benefits Program",
  "Enrollment codes for this Plan:",
  "131 Zenith Care - Self Only",
  "133 Zenith Care - Self Plus One",
  "132 Zenith Care - Self and Family",
].join("\n");
