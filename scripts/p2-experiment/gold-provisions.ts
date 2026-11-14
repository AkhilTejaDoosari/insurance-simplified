// Gold provisions for targeted verified claims, written by hand from the
// source PDF text (pages cited), NOT from the extractor's output. Each states
// what a complete, correct verified claim must contain.
//
// `restrictions` — every material restriction of the provision (verbatim
//   source wording, whitespace-insensitive) that the claim's display AND its
//   cited evidence must carry;
// `forbidden`   — text that must not appear (a restriction that does not
//   govern this provision);
// `pending`     — restrictions whose applicability is an open owner
//   adjudication question (reported separately, never counted as complete
//   or incomplete);
// `expected: "withheld"` — a provision that must NOT become a verified claim.
//
// Licensed brochure text: short provision quotes only (ground-truth.ts
// precedent). Do not publish.

export interface GoldProvision {
  id: string;
  documentId: string;
  fact: string;
  /** Row label / statement start the claim's first line starts with. */
  label: string;
  scope: Partial<Record<"planTier" | "networkTier" | "conditions", string>>;
  /** Cell value verbatim (the first display line ends with it). */
  value: string;
  restrictions: string[];
  forbidden?: string[];
  pending?: string[];
  pages: number[];
  expected?: "verified" | "withheld";
}

const SC_ASSIST =
  "*Arrangement of the above benefits are not insurance and are handled by Seven Corners Assist. If you do not contact Seven Corners Assist, " +
  "the benefit will be limited to the amount we would have paid if Seven Corners Assist was utilized. This requirement to use Seven Corners " +
  "Assist does not apply to Return of Mortal Remains or Local Burial/Cremation.";
const SC_SCHEDULE = [
  "All medical and dental benefits are subject to deductible and/or copay and coinsurance.",
  "Unless otherwise stated, all benefits are per person, per period of coverage, and they are provided up to the amount shown.",
  "your initial treatment must occur within 30 days of the date of injury or illness.",
];
const SC_URC = "*URC means Usual, Reasonable, and Customary. It is the maximum amount we will pay for covered expenses based on several factors.";
const IMG_NOT_DED = "NOT Subject to Deductible unless otherwise noted";
const IMG_DED = "Subject to Deductible unless otherwise noted";
const IMG_UCR = "Eligible Medical Expenses are limited to Usual, Reasonable and Customary";
const IMG_PRECERT_ALL = "All other Treatments & supplies: 50% reduction of Eligible Medical Expenses if Pre-certification requirements are not met.";
const WT_GENERAL = "Eligible expenses are subject to applicable copayments, coinsurance, overall maximum limit, and are per certificate period unless specifically indicated otherwise.";
const BASIC = "Basic";
const CHOICE = "Choice";

export const GOLD: GoldProvision[] = [
  // Seven Corners p3 — EMERGENCY SERVICES AND ASSISTANCE* section.
  ...(["emergency-evacuation", "repatriation"] as const).flatMap((fact) => [
    { id: `sc-evac-${fact}-basic`, documentId: "doc-3", fact, label: "Emergency Medical Evacuation & Repatriation", scope: { planTier: BASIC }, value: "$250,000 (separate from medical maximum)", restrictions: [SC_ASSIST, ...SC_SCHEDULE], pages: [3] },
    { id: `sc-evac-${fact}-choice`, documentId: "doc-3", fact, label: "Emergency Medical Evacuation & Repatriation", scope: { planTier: CHOICE }, value: "$500,000 (separate from medical maximum)", restrictions: [SC_ASSIST, ...SC_SCHEDULE], pages: [3] },
  ]),
  // The exception: the note is shown WITH its exemption of this row.
  { id: "sc-remains-basic", documentId: "doc-3", fact: "repatriation", label: "Return of Mortal Remains or Local Burial/Cremation", scope: { planTier: BASIC }, value: "$25,000", restrictions: [SC_ASSIST, ...SC_SCHEDULE], pages: [3] },
  { id: "sc-remains-choice", documentId: "doc-3", fact: "repatriation", label: "Return of Mortal Remains or Local Burial/Cremation", scope: { planTier: CHOICE }, value: "$50,000", restrictions: [SC_ASSIST, ...SC_SCHEDULE], pages: [3] },
  { id: "sc-disaster-basic", documentId: "doc-3", fact: "repatriation", label: "Natural Disaster Evacuation & Repatriation", scope: { planTier: BASIC }, value: "$25,000", restrictions: [SC_ASSIST, ...SC_SCHEDULE], pages: [3] },
  // Unmarked rows: the Assist restriction must not be applied.
  { id: "sc-ambulance-basic", documentId: "doc-3", fact: "ambulance", label: "Local Ambulance", scope: { planTier: BASIC }, value: "Inside the United States: $5,000 Outside the United States: Up to medical maximum", restrictions: SC_SCHEDULE, forbidden: ["Seven Corners Assist"], pages: [2] },
  { id: "sc-hospital-basic", documentId: "doc-3", fact: "hospitalization", label: "Hospital Room and Board, Inpatient & Outpatient Medical Expenses, Prescription Drugs", scope: { planTier: BASIC }, value: "URC* to medical maximum", restrictions: [SC_URC, ...SC_SCHEDULE], forbidden: ["Seven Corners Assist"], pages: [2] },
  { id: "sc-hospital-choice", documentId: "doc-3", fact: "hospitalization", label: "Hospital Room and Board, Inpatient & Outpatient Medical Expenses, Prescription Drugs", scope: { planTier: CHOICE }, value: "URC to medical maximum", restrictions: SC_SCHEDULE, forbidden: ["URC means", "Seven Corners Assist"], pages: [2] },

  // IMG Patriot Exchange — p6 Emergency Services, p4 urgent care; p3 Pre-certification.
  { id: "img-interfacility-in", documentId: "doc-1", fact: "ambulance", label: "Interfacility Ambulance Transfer", scope: { networkTier: "In-Network", conditions: "Plan Pays" }, value: "100%", restrictions: ["Up to the per Injury or Illness limit", "Services rendered in the United States", "Transfer must be a result of an Inpatient Hospital admission", IMG_NOT_DED, IMG_UCR, "Interfacility Ambulance Transfer: No coverage if Pre-certification requirements are not met."], forbidden: [`\n${IMG_DED}`], pages: [6, 3] },
  { id: "img-evacuation-in", documentId: "doc-1", fact: "emergency-evacuation", label: "Emergency Medical Evacuation", scope: { networkTier: "In-Network", conditions: "Plan Pays" }, value: "100%", restrictions: ["Maximum Limit: $50,000", "Must be approved in advance and coordinated by the Company", IMG_NOT_DED, "Emergency Medical Evacuation: No coverage if not approved by the Company."], pages: [6, 3] },
  { id: "img-urgent-in", documentId: "doc-1", fact: "urgent-care", label: "Urgent Care", scope: { networkTier: "In-Network", conditions: "Plan Pays" }, value: "90%", restrictions: ["Not subject to Deductible", "Copayment: $50", "Copayment is not applicable if the Declaration states a $0 Deductible", IMG_DED, IMG_UCR], pending: [IMG_PRECERT_ALL], pages: [4] },
  { id: "img-oop-in", documentId: "doc-1", fact: "out-of-pocket-maximum", label: "Out of Pocket Maximum", scope: { networkTier: "In-Network", conditions: "United States" }, value: "$1,000", restrictions: [], pages: [3] },

  // WorldTrips StudentSecure p3 — the page's general note.
  { id: "wt-deductible-elite", documentId: "doc-2", fact: "annual-deductible", label: "Deductible", scope: { planTier: "ELITE" }, value: "$0", restrictions: [WT_GENERAL], pages: [3] },
  { id: "wt-er-elite", documentId: "doc-2", fact: "emergency-care", label: "Emergency Room Copayment (Claims Incurred in the U.S. Only)", scope: { planTier: "ELITE" }, value: "$100 for the emergency room facility fee for treatment received in an emergency room", restrictions: [WT_GENERAL], pages: [3] },

  // FEP Blue Focus p17 statements.
  { id: "fep-ded-self", documentId: "fep", fact: "annual-deductible", label: "For Self Only contracts, the calendar year deductible is now", scope: { conditions: "Self Only" }, value: "$1,000.", restrictions: [], pages: [17] },
  { id: "fep-ded-family", documentId: "fep", fact: "annual-deductible", label: "For Self Plus One, and Self and Family contracts, the deductible is now", scope: { conditions: "Self Plus One, and Self and Family" }, value: "$2,000 (see page 27).", restrictions: [], pages: [17] },
  { id: "fep-oop-self", documentId: "fep", fact: "out-of-pocket-maximum", label: "For Self Only contracts, your Preferred Provider catastrophic out-of-pocket maximum is now", scope: { networkTier: "Preferred Provider", conditions: "Self Only" }, value: "$11,000.", restrictions: [], pages: [17] },
  { id: "fep-oop-family", documentId: "fep", fact: "out-of-pocket-maximum", label: "For Self Plus One and Self and Family contracts, your Preferred Provider catastrophic out-of-pocket maximum is now", scope: { networkTier: "Preferred Provider", conditions: "Self Plus One and Self and Family" }, value: "$22,000 (see page 29).", restrictions: [], pages: [17] },
  // Known missing gold facts.
  { id: "fep-maternity-facility", documentId: "fep", fact: "maternity-coverage", label: "Your copayment for maternity services billed by a Preferred facility is now", scope: { networkTier: "Preferred" }, value: "$3,000 per pregnancy (see page 63).", restrictions: [], pages: [17] },
  { id: "img-precert-penalty", documentId: "doc-1", fact: "preauthorization", label: "Pre-certification", scope: {}, value: "Maximum Penalty: $1,000", restrictions: [IMG_PRECERT_ALL], pages: [3] },
];

/** Documents with no plan of their own: nothing in them may be verified. */
export const WITHHELD_DOCUMENTS = ["health", "fema"] as const;
