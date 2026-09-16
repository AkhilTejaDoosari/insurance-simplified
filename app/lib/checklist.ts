// Guided no-documents flow content (spec FR-016, User Story 5).
// Advisory text only: what to look for and which documents to collect.
// MUST NOT recommend plans, rank insurers, or name providers (FR-017).

export interface CollectionChecklist {
  contextUsed: Record<string, string>;
  whatToLookFor: string[];
  documentsToCollect: string[];
  nextStep: string;
}

const CORE_LOOK_FOR = [
  "Annual deductible, including separate in-network and out-of-network amounts",
  "Annual out-of-pocket maximum and what counts toward it",
  "Emergency care terms, including copays and admission exceptions",
  "Prescription drug tiers and exclusions",
  "Pre-existing condition waiting periods",
  "Eligibility rules that apply to you (age, residency, student or visa status)",
  "Provider network scope and out-of-network reimbursement",
];

const CORE_DOCUMENTS = [
  "The plan's Summary of Benefits and Coverage (SBC) or equivalent schedule",
  "The full policy wording or member handbook",
  "The provider network directory for your location",
  "Any visa- or residency-specific coverage letter, if one was issued to you",
];

export function buildChecklist(
  context: Record<string, string>
): CollectionChecklist {
  const whatToLookFor = [...CORE_LOOK_FOR];
  const documentsToCollect = [...CORE_DOCUMENTS];

  const has = (field: string) => (context[field] ?? "").trim().length > 0;
  if (has("visaOrStatus")) {
    whatToLookFor.push(
      `Proof that your status (“${context.visaOrStatus.trim()}”) is an eligible category, and any exclusions tied to it`
    );
  }
  if (has("coverageDates")) {
    whatToLookFor.push(
      `Exact coverage start and end dates matching your stay (“${context.coverageDates.trim()}”), including waiting periods`
    );
  }
  if (has("location")) {
    whatToLookFor.push(
      `Confirmation that providers near “${context.location.trim()}” are in-network`
    );
  }
  if (has("age")) {
    whatToLookFor.push(
      `Any age-based limits or dependent-age cutoffs relevant at age ${context.age.trim()}`
    );
  }

  return {
    contextUsed: { ...context },
    whatToLookFor,
    documentsToCollect,
    nextStep:
      "Once you have 2–4 of these documents, return here and upload them to compare.",
  };
}
