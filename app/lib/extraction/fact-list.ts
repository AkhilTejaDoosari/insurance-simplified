// Versioned comparable-fact list v1 (spec FR-004).
// Each fact carries match patterns run (line-by-line) against extracted page
// text by the deterministic fallback engine. The LLM path receives the same
// fact names so both paths emit one row per fact.

export interface FactDefinition {
  name: string;
  label: string;
  /** Regex sources matched case-insensitively against a single line. */
  patterns: string[];
  /** User-context field that can rule this fact out (FR-003). */
  contextField?: "age" | "countryOrResidency" | "visaOrStatus" | "location" | "coverageDates";
}

export const FACT_LIST_VERSION = "v1";

export const FACTS: FactDefinition[] = [
  { name: "annual-deductible", label: "Annual deductible", patterns: ["deductible"] },
  { name: "out-of-pocket-maximum", label: "Out-of-pocket maximum", patterns: ["out-of-pocket maximum", "out of pocket max"] },
  { name: "emergency-care", label: "Emergency care coverage", patterns: ["emergency (care|copay|coverage|services?)"] },
  { name: "emergency-copay", label: "Emergency copay", patterns: ["emergency[^.\\n]*copay", "copay[^.\\n]*emergency"] },
  { name: "prescriptions", label: "Prescription coverage", patterns: ["prescription"] },
  { name: "pre-existing-conditions", label: "Pre-existing conditions", patterns: ["pre-existing"] },
  { name: "eligibility", label: "Eligibility", patterns: ["eligib"] },
  { name: "student-eligibility", label: "Student / visa eligibility", patterns: ["F-1|J-1|student|visa"], contextField: "visaOrStatus" },
  { name: "network", label: "Provider network", patterns: ["network|provider"] },
  { name: "primary-care-visit", label: "Primary care visit", patterns: ["primary care"] },
  { name: "specialist-visit", label: "Specialist visit", patterns: ["specialist"] },
  { name: "hospitalization", label: "Hospitalization", patterns: ["hospital|inpatient|admitted"] },
  { name: "mental-health", label: "Mental health coverage", patterns: ["mental health|behavioral health"] },
  { name: "maternity-coverage", label: "Maternity coverage", patterns: ["maternity|pregnancy|prenatal"] },
  { name: "dental-coverage", label: "Dental coverage", patterns: ["dental"] },
  { name: "vision-coverage", label: "Vision coverage", patterns: ["vision|optical|eyewear"] },
  { name: "preventive-care", label: "Preventive care", patterns: ["preventive|preventative|wellness visit|annual physical"] },
  { name: "urgent-care", label: "Urgent care", patterns: ["urgent care"] },
  { name: "lab-and-imaging", label: "Lab work and imaging", patterns: ["lab |laboratory|x-ray|xray|imaging|MRI|CT scan"] },
  { name: "ambulance", label: "Ambulance", patterns: ["ambulance"] },
  { name: "international-coverage", label: "International / travel coverage", patterns: ["outside the (country|U\\.S\\.)|abroad|international|travel coverage"], contextField: "countryOrResidency" },
  { name: "waiting-period", label: "Waiting period", patterns: ["waiting period"] },
  { name: "age-limits", label: "Age limits", patterns: ["age \\d+|under \\d+|over \\d+"], contextField: "age" },
  { name: "referral-requirement", label: "Referral requirement", patterns: ["referral"] },
  { name: "coverage-dates", label: "Coverage dates / term", patterns: ["coverage (period|dates|term|begins|ends)|effective date"], contextField: "coverageDates" },
];

/** Lines matching these read as vague/partial → NEEDS VERIFICATION. */
export const VAGUE_PATTERNS = [
  "reasonable cost",
  "may vary",
  "contact us",
  "subject to",
  "determined by",
  "as applicable",
];

/** Pull qualifier phrases out of a matched line (FR-006). */
export function extractQualifiers(line: string) {
  const qualifiers: Record<string, string> = {};
  const net = line.match(/in-network[^.,;]*|out-of-network[^.,;]*/gi);
  if (net) qualifiers.networkTier = net.join(" / ").trim();
  const period = line.match(/per (year|month|visit|day)|annual(?:ly)?|lifetime/gi);
  if (period) qualifiers.period = [...new Set(period.map((p) => p.toLowerCase()))].join(", ");
  const age = line.match(/(?:age\s*)?\d+\s*(?:years? old|\+)?\s*(?:and (?:over|under))?|under \d+|over \d+/i);
  if (age) qualifiers.ageBand = age[0].trim();
  const cond = line.match(/(?:if|when|unless|waived[^.,;]*|after[^.,;]*)/i);
  if (cond) qualifiers.conditions = cond[0].trim();
  return qualifiers;
}
