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
  { name: "premium", label: "Premium / price", patterns: ["premium(?=.*(?:\\$|\\b\\d))", "\\bprice\\b(?=.*(?:\\$|\\b\\d))"] },
  { name: "annual-deductible", label: "Annual deductible", patterns: ["^(?!.*\\brecommend(?:s|ed)?\\b)(?:.*\\bannual deductible\\b|.*\\bdeductible options\\b|.*\\bdeductible\\s*[:$]|.*\\$\\s?[\\d,]+\\s+deductible)"] },
  { name: "out-of-pocket-maximum", label: "Out-of-pocket maximum", patterns: ["out-of-pocket maximum", "out of pocket max"] },
  { name: "emergency-care", label: "Emergency room", patterns: ["emergency (room|department|services?|care|coverage)", "emergency[^.\\n]*copay", "copay[^.\\n]*emergency", "emergency[^.\\n]*deductible"] },
  { name: "prescriptions", label: "Prescription drugs", patterns: ["prescription"] },
  { name: "coinsurance", label: "Coinsurance / your share", patterns: ["coinsurance", "cost sharing", "cost-share", "you pay \\d+\\s*%"] },
  { name: "policy-limit", label: "Maximum coverage / policy limit", patterns: ["policy limit", "maximum coverage", "lifetime maximum", "benefit maximum", "maximum benefit"] },
  { name: "pre-existing-conditions", label: "Pre-existing-condition rule", patterns: ["pre-existing"] },
  { name: "eligibility", label: "Eligibility", patterns: ["\\b(?:eligibility\\s*:\\s*\\w+|eligible to (?:buy|purchase|enroll)|eligibility requirements)\\b", "must be (?:under age|at least|a non-?u\\.?s\\.? resident|residing|enrolled|a full-time student)", "required to be", "\\b\\d+ days? of age or older\\b"] },
  { name: "student-eligibility", label: "Student / visa eligibility", patterns: ["F-1|J-1|student eligibility|student status|full-time student", "must be (?:under age|a full-time student)"], contextField: "visaOrStatus" },
  { name: "network", label: "Provider network", patterns: ["provider network", "(?<!out of )PPO network", "network of (?:U\\.?S\\.? )?providers"] },
  { name: "primary-care-visit", label: "Primary / physician visits", patterns: ["primary care", "office visit", "physician visit"] },
  { name: "specialist-visit", label: "Specialist", patterns: ["specialist"] },
  { name: "hospitalization", label: "Hospitalization / inpatient", patterns: ["hospital|inpatient|in-patient|admitted", "intensive care", "\\bICU\\b", "room and board", "extended care facility", "inpatient facility"] },
  { name: "surgery", label: "Surgery", patterns: ["surgery", "surgical", "surgeon", "anesthesia"] },
  { name: "mental-health", label: "Mental / behavioral health", patterns: ["mental health|behavioral health"] },
  { name: "maternity-coverage", label: "Maternity", patterns: ["maternity|pregnancy|prenatal"] },
  { name: "dental-coverage", label: "Dental", patterns: ["dental"] },
  { name: "vision-coverage", label: "Vision", patterns: ["vision|optical|eyewear"] },
  { name: "preventive-care", label: "Preventive care", patterns: ["preventive|preventative|wellness visit|annual physical"] },
  { name: "urgent-care", label: "Urgent / walk-in care", patterns: ["urgent care", "walk-in", "walk in clinic"] },
  { name: "lab-and-imaging", label: "Labs & imaging", patterns: ["\\blab\\b|laborator|radiolog|x-?ray|imaging|MRI|CT scan|diagnostic imaging"] },
  { name: "ambulance", label: "Ambulance", patterns: ["ambulance"] },
  { name: "international-coverage", label: "International restrictions", patterns: ["outside the (country|U\\.S\\.)|abroad|international|travel coverage"], contextField: "countryOrResidency" },
  { name: "network-rules", label: "Network / out-of-network rules", patterns: ["out-of-network", "out of network", "network use required", "must use (a )?network"] },
  { name: "preauthorization", label: "Preauthorization", patterns: ["pre-?authorization", "prior authorization", "pre-certification", "precertification", "approved in advance"] },
  { name: "material-exclusions", label: "Material exclusions", patterns: ["exclusion", "excluded from coverage", "not covered", "limitations and exclusions"] },
  { name: "waiting-period", label: "Waiting periods", patterns: ["waiting period"] },
  { name: "geographic-restrictions", label: "Geographic restrictions", patterns: ["service area", "home country", "coverage area", "state of residence", "destination country"] },
  { name: "coverage-duration", label: "Coverage-duration limits", patterns: ["maximum trip", "minimum \\d+\\s*(day|week|month|year)", "maximum \\d+\\s*(day|week|month|year)", "renewable", "up to \\d+\\s*months? of coverage"] },
  { name: "age-limits", label: "Age limits", patterns: ["age \\d+|under \\d+|over \\d+"], contextField: "age" },
  { name: "referral-requirement", label: "Referrals", patterns: ["referral"] },
  { name: "coverage-dates", label: "Coverage dates / term", patterns: ["coverage (period|dates|term|begins|ends)|effective date"], contextField: "coverageDates" },
  // Plan Highlights candidates — unusual/plan-specific benefits
  { name: "emergency-evacuation", label: "Emergency medical evacuation", patterns: ["emergency (medical )?evacuation", "medevac"] },
  { name: "repatriation", label: "Repatriation", patterns: ["repatriation", "return of (mortal )?remains"] },
  { name: "political-evacuation", label: "Political evacuation", patterns: ["political evacuation", "security evacuation"] },
  { name: "terrorism-coverage", label: "Terrorism coverage", patterns: ["terrorism", "act of terrorism"] },
  { name: "emergency-reunion", label: "Emergency reunion", patterns: ["emergency reunion", "family reunion"] },
  { name: "bedside-visit", label: "Bedside visit", patterns: ["bedside visit", "compassionate visit"] },
  { name: "ad-and-d", label: "Accidental death & dismemberment", patterns: ["accidental death", "dismemberment", "AD&D", "AD and D"] },
  { name: "incidental-trip", label: "Incidental trip", patterns: ["incidental trip", "side trip"] },
  { name: "telehealth", label: "Telehealth", patterns: ["telehealth", "telemedicine", "virtual (care|visit)", "remote (care|visit)"] },
  { name: "physical-therapy", label: "Physical therapy", patterns: ["physical therapy", "physiotherapy"] },
  { name: "chiropractic", label: "Chiropractic", patterns: ["chiropractic", "chiropractor"] },
  { name: "durable-medical-equipment", label: "Durable medical equipment", patterns: ["durable medical equipment", "DME"] },
  { name: "home-nursing", label: "Home nursing", patterns: ["home nursing", "home health", "private duty nursing"] },
  { name: "student-health-center", label: "Student Health Center", patterns: ["student health center", "university health center", "campus health center"] },
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
  const period = line.match(/\bper (year|month|visit|day)\b|\bannual(?:ly)?\b|\blifetime\b/gi);
  if (period) qualifiers.period = [...new Set(period.map((p) => p.toLowerCase()))].join(", ");
  const age = line.match(/\bage\s*\d+(?:\s*(?:years? old|\+))?(?:\s+and\s+(?:over|under))?|\b(?:under|over)\s+(?:age\s*)?\d+\b|\b\d+\s+(?:days?|years?)\s+of age(?: or older)?\b/i);
  if (age) qualifiers.ageBand = age[0].trim();
  const cond = line.match(/(?:if|when|unless|waived[^.,;]*|after[^.,;]*)/i);
  if (cond) qualifiers.conditions = cond[0].trim();
  return qualifiers;
}
