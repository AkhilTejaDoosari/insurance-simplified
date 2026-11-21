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
  /** P0-03 semantic guards. A line (or table label) that matches any of
   *  these states a different concept and is never this fact. */
  excludePatterns?: string[];
  /** P0-03: the line must ALSO match one of these (e.g. a geographic
   *  mention is a restriction only with a restriction marker). */
  requiredPatterns?: string[];
  /** P0-03: a bullet value line is this fact only when its governing
   *  heading — the nearest non-bullet line above, skipping at most
   *  GOVERNED_MAX_BULLETS sibling bullets — matches `heading`. The evidence
   *  quote spans heading → line so the governing context is cited. */
  governedPatterns?: { heading: string; line: string }[];
  /** P0-03: match table labels against the full label (sub-notes and
   *  parentheticals included), because the fact's basis lives there. */
  matchFullLabel?: boolean;
  /** Table labels: the label's concept head must match this (so a benefit
   *  row that merely has its own deductible is not this fact). A label head
   *  that names the fact also satisfies `requiredPatterns`, since the
   *  restriction itself is stated in the value cell, not the label. */
  labelHeadPattern?: string;
}

/** v2 (P0-03): claims-filing-deadline and per-illness-deductible added;
 *  eligibility, annual deductible, age limits, policy limit, geographic and
 *  international facts gained semantic guards. */
export const FACT_LIST_VERSION = "v2";

/** Deductible basis other than the plan period: per illness, injury, … */
const INCIDENT_BASIS = "(?:covered\\s+)?(?:illness|illnesses|sickness|sicknesses|injury|injuries|condition|accident|admission|incident|occurrence|disability|damage)";
/** Per-event bases (per visit, for each admission, …), up to 3 words in. */
const EVENT_BASIS = "(?:[\\w-]+\\s+){0,3}(?:visits?|admissions?|trips?|occurrences?|confinements?|stays?)";
/** The basis must sit next to "deductible" (review R3): "Deductible: $250 per
 *  illness", "Deductible for each …", "per injury deductible". An incidental
 *  per-event mention elsewhere in the line ("…, waived for each ER visit")
 *  does not change what the deductible is. */
const basisAdjacent = (basis: string) =>
  "\\bdeductibles?\\b\\s*(?:[:\\-–•·(]\\s*)?(?:\\$\\s?[\\d,.]+\\s*)?(?:applies\\s+)?(?:per|for each|each)\\s+" + basis + "\\b" +
  "|\\b(?:per|for each)\\s+" + basis + "\\s+deductibles?\\b";
const PER_INCIDENT = basisAdjacent(INCIDENT_BASIS);
const PER_EVENT = basisAdjacent(EVENT_BASIS);
/** A line that states the annual/calendar-year deductible is about it. */
const NAMES_ANNUAL = "\\b(?:annual|calendar[- ]year)\\s+deductibles?\\b";
/** Claim-procedure language (notice/proof of claim, filing, legal action). */
const CLAIM_PROCEDURE =
  "\\b(?:proof|notice) of (?:claim|loss)\\b|\\bclaims? (?:must|shall|should) be (?:filed|submitted|received|presented)\\b|\\b(?:action|proceeding|suit)s?\\b.*\\bbrought\\b";
/** A stated geographic restriction, not a mention or an extension.
 *  "outside" alone locates a benefit; it does not restrict one. */
const GEO_RESTRICTION =
  "\\bexclud(?:ing|es|ed)\\b|\\bonly\\b|\\blimited to\\b|\\bnot covered\\b|\\bno (?:coverage|benefits?)\\b|\\bnot (?:be )?(?:payable|eligible|available|provided)\\b|\\bdoes not apply\\b|\\bexcept\\b|\\brestricted\\b|\\bmust (?:reside|remain)\\b";
/** Definitions name a term; they do not restrict anything. */
const DEFINITION =
  "\\bmeans\\b|\\brefers to\\b|\\bis defined as\\b|^\\s*[A-Z][A-Za-z’' ]{2,40}:\\s+(?:All|Any|Each)\\b";
/** Contact lines ("Customer service (USA only): 1-800-…") restrict nothing. */
const CONTACT_LINE = "\\b(?:call|phone|telephone|customer service|toll[- ]free|fax)\\b|\\+?\\d[\\d .()-]{8,}\\d";

/** A footnote marker glued to a label word ("Deductible1", "in-network2",
 *  "maximum³"): one or two digits or superscripts right after a word of at
 *  least three letters, before a space, punctuation or the line end. Removed
 *  for MATCHING only — quotes and displays keep the verbatim line. Codes
 *  with fewer letters ("F1", "J1") and amounts are untouched. */
const FOOTNOTE_MARKER = /(?<=[A-Za-z]{3})(?:\d{1,2}|[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,2})(?=[\s:;,.)]|$)/g;
export function withoutFootnoteMarkers(line: string): string {
  return line.replace(FOOTNOTE_MARKER, "");
}

const SUPERSCRIPT_DIGITS: Record<string, string> = { "\u2070": "0", "\u00B9": "1", "\u00B2": "2", "\u00B3": "3", "\u2074": "4", "\u2075": "5", "\u2076": "6", "\u2077": "7", "\u2078": "8", "\u2079": "9" };
const markerKey = (marker: string) => [...marker].map((c) => SUPERSCRIPT_DIGITS[c] ?? c).join("").replace(/^0+(?=\d)/, "");
/** A footnote line: the marker, a space, then text that starts with a letter. */
const FOOTNOTE_LINE = /^(\d{1,2}|[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,2})\s+([A-Za-z].{1,200})$/;

export interface FootnotedLine {
  /** The line as matchers read it: each glued marker replaced by its
   *  footnote text when resolved ("Deductible (Per injury or sickness) …"),
   *  otherwise removed. */
  matchText: string;
  /** Indexes of the footnote lines it resolved to (cited with the value). */
  footnotes: number[];
}

/** Resolve glued footnote markers on a page's lines. A marker resolves only
 *  to a LATER note-block line on the same page with the same marker ("1 Per
 *  injury or sickness"), and only when exactly one such line exists; the
 *  footnote then belongs to the label's meaning. */
export function resolveFootnotes(lines: readonly string[]): FootnotedLine[] {
  // A footnote is a line of a NOTE BLOCK (review S6): consecutive note-shaped
  // lines numbered 1, 2, 3 … from 1, none stating an amount or percentage.
  // A numbered list or table row ("2 Office visits $20") is not a note.
  const shaped = lines.map((l) => {
    const m = FOOTNOTE_LINE.exec(l);
    return m && !/[$%]/.test(m[2]) ? m : null;
  });
  const notes: (RegExpExecArray | null)[] = lines.map(() => null);
  for (let i = 0; i < lines.length; i++) {
    if (!shaped[i] || markerKey(shaped[i]![1]) !== "1" || (i > 0 && shaped[i - 1])) continue;
    for (let j = i, n = 1; j < lines.length && shaped[j] && markerKey(shaped[j]![1]) === String(n); j++, n++) notes[j] = shaped[j];
  }
  return lines.map((line, idx) => {
    const footnotes: number[] = [];
    const matchText = line.replace(FOOTNOTE_MARKER, (marker) => {
      const key = markerKey(marker);
      const hits = notes.flatMap((m, j) => (m && j > idx && markerKey(m[1]) === key ? [j] : []));
      if (hits.length !== 1) return "";
      footnotes.push(hits[0]);
      return ` (${notes[hits[0]]![2]})`;
    });
    return { matchText, footnotes };
  });
}

/** A schedule line that opens with the deductible label and states its
 *  amount, with at most a plan-level scope in between ("Deductible
 *  elsewhere $100", "Deductible (individual) $500", "Deductible in-network
 *  $250"). A service, place or incident between them ("for emergency room",
 *  "at the …", "per sickness") is not the plan's annual deductible (review B1). */
const SCHEDULE_DEDUCTIBLE = "^\\s*deductibles?\\b\\s*(?:[:(\\-–]\\s*)?(?:(?:in|out[- ]of)[- ]network|non[- ]network|elsewhere|individual|family|per (?:person|member|individual|insured|family)|annual|(?:per )?(?:policy|calendar|plan|certificate) (?:year|period))?\\s*\\)?\\s*:?\\s*\\$\\s?[\\d,]+";
/** A schedule line naming the plan's overall maximum with its amount
 *  ("Annual maximum $1,000,000", "Overall maximum: $250,000"); nothing may
 *  sit between "maximum" and the amount (out-of-pocket, visits, …). */
const OVERALL_MAXIMUM = "^\\s*(?:annual|overall|aggregate|policy|plan|certificate)\\s+maximum\\b\\s*:?\\s*\\$\\s?\\d";

/** A reference to exclusions as contract terms or elsewhere in the document
 *  ("terms, conditions, limits and exclusions", "subject to a separate
 *  exclusion", a line continuing "… and exclusions."): not an exclusion. */
const EXCLUSION_REFERENCE =
  "\\b(?:terms|conditions|provisions|limitations|limits)\\b[^.]*\\b(?:and|&)\\s+exclusions\\b|\\b(?:subject to|pursuant to|see|refer to|described in)\\b[^.]*\\bexclusions?\\b|\\bseparate exclusion\\b|^\\s*(?:and|or)\\s+(?:limitations\\s+and\\s+)?exclusions\\b";
/** A legal or consular assistance referral is not a medical referral. */
const LEGAL_REFERRAL = "\\b(?:legal|attorneys?|lawyers?|consul(?:ar|ate)?|embass(?:y|ies))\\b";
/** A benefit's cost share by network ("80% in-network, 70% out-of-network")
 *  or a coinsurance line is a cost-share value, not a network rule. */
const PER_NETWORK_SHARE =
  "\\bcoinsurance\\b|\\d{1,3}\\s*%[^%\\n]{0,40}\\bin[- ]network\\b[^%\\n]{0,40}\\d{1,3}\\s*%[^%\\n]{0,40}\\bout[- ]of[- ]network\\b|\\bin[- ]network\\b[^%\\n]{0,20}\\d{1,3}\\s*%[^%\\n]{0,40}\\bout[- ]of[- ]network\\b[^%\\n]{0,20}\\d{1,3}\\s*%";

export const FACTS: FactDefinition[] = [
  { name: "premium", label: "Premium / price", patterns: ["premium(?=.*(?:\\$|\\b\\d))", "\\bprice\\b(?=.*(?:\\$|\\b\\d))"] },
  { name: "annual-deductible", label: "Annual deductible", excludePatterns: ["^(?!.*" + NAMES_ANNUAL + ")(?:.*(?:" + PER_INCIDENT + "|" + PER_EVENT + "))"], patterns: ["^(?!.*\\brecommend(?:s|ed)?\\b)(?:.*\\bannual deductible\\b|.*\\bdeductible options\\b|.*\\bdeductible\\s*[:$]|.*\\$\\s?[\\d,]+\\s+deductible|" + SCHEDULE_DEDUCTIBLE.slice(1) + "|.*\\bcalendar[- ]year deductibles?(?:\\s+is)?(?:\\s+now)?\\s*:?\\s*\\$\\s?[\\d,]+)"] },
  { name: "per-illness-deductible", label: "Deductible per illness, injury or condition", matchFullLabel: true, labelHeadPattern: "^\\s*deductibles?\\b", excludePatterns: ["\\bper damage\\b|\\bdamage deductible\\b", NAMES_ANNUAL], patterns: [PER_INCIDENT] },
  { name: "out-of-pocket-maximum", label: "Out-of-pocket maximum", patterns: ["out-of-pocket maximum", "out of pocket max"] },
  { name: "emergency-care", label: "Emergency room", patterns: ["emergency (room|department|services?|care|coverage)", "emergency[^.\\n]*copay", "copay[^.\\n]*emergency", "emergency[^.\\n]*deductible"] },
  { name: "prescriptions", label: "Prescription drugs", patterns: ["prescription"] },
  { name: "coinsurance", label: "Coinsurance / your share", patterns: ["coinsurance", "cost sharing", "cost-share", "you pay \\d+\\s*%"] },
  { name: "policy-limit", label: "Maximum coverage / policy limit", patterns: ["policy limit", "maximum coverage", "coverage maximum(?=.*\\$\\s?\\d)", "lifetime maximum", "benefit maximum", "maximum benefit", "^\\s*(?:(?:certificate|policy|overall|plan)\\s+)?maximum limit\\b\\s*:?\\s*\\$\\s?\\d", OVERALL_MAXIMUM], governedPatterns: [{
    // An overall limit heading (review R2): not an out-of-pocket, visit,
    // per-day or drug maximum.
    heading: "^(?!.*\\b(?:out[- ]of[- ]pocket|visits?|per day|drugs?|pharmacy|prescriptions?)\\b).*(?:\\b(?:overall|policy|certificate|plan|lifetime|coverage)\\s+(?:maximum|limit)\\b|\\bmaximum\\s+(?:coverage|limit|amount)\\b|\\bcoverage\\s+limit\\b)",
    line: "^\\s*[•·▪\\-–]\\s*(?:through|up to|ages?|under|over|\\d+\\s*(?:-|–|to|through|and)\\s*(?:\\d+|older|over|under))\\b[^:$]*:\\s*\\$\\s?\\d",
  }] },
  { name: "pre-existing-conditions", label: "Pre-existing-condition rule", patterns: ["pre-existing"] },
  { name: "eligibility", label: "Eligibility", patterns: ["\\b(?:eligibility\\s*:\\s*\\w+|eligible to (?:buy|purchase|enroll)|eligibility requirements)\\b", "must be (?:under age|at least|a non-?u\\.?s\\.? resident|residing|enrolled|a full-time student)", "\\b\\d+ days? of age or older\\b"], excludePatterns: [CLAIM_PROCEDURE] },
  { name: "student-eligibility", label: "Student / visa eligibility", patterns: ["F-1|J-1|student eligibility|student status|full-time student", "must be (?:under age|a full-time student)"], contextField: "visaOrStatus" },
  { name: "network", label: "Provider network", patterns: ["provider network", "(?<!out of )PPO network", "network of (?:U\\.?S\\.? )?providers"] },
  { name: "primary-care-visit", label: "Primary / physician visits", patterns: ["primary care", "office visit", "physician visit"] },
  { name: "specialist-visit", label: "Specialist", patterns: ["specialist"] },
  { name: "hospitalization", label: "Hospitalization / inpatient", patterns: ["hospital|inpatient|in-patient|admitted", "intensive care", "\\bICU\\b", "room and board", "extended care facility", "inpatient facility"] },
  { name: "surgery", label: "Surgery", patterns: ["surgery", "surgical", "surgeon", "anesthesia"] },
  { name: "mental-health", label: "Mental / behavioral health", patterns: ["mental health|behavioral health"] },
  { name: "maternity-coverage", label: "Maternity", patterns: ["maternity|pregnancy|prenatal"] },
  { name: "dental-coverage", label: "Dental", patterns: ["\\bdental\\b"] },
  { name: "vision-coverage", label: "Vision", patterns: ["\\bvision\\b|optical|eyewear"] },
  { name: "preventive-care", label: "Preventive care", patterns: ["preventive|preventative|wellness visit|annual physical"] },
  { name: "urgent-care", label: "Urgent / walk-in care", patterns: ["urgent care", "walk-in", "walk in clinic"] },
  { name: "lab-and-imaging", label: "Labs & imaging", patterns: ["\\blab\\b|laborator|radiolog|x-?ray|imaging|MRI|CT scan|diagnostic imaging"] },
  { name: "ambulance", label: "Ambulance", patterns: ["ambulance"] },
  { name: "international-coverage", label: "International restrictions", patterns: ["outside the (country|U\\.S\\.)|abroad|international|travel coverage"], requiredPatterns: [GEO_RESTRICTION], excludePatterns: [DEFINITION, CONTACT_LINE], contextField: "countryOrResidency" },
  { name: "network-rules", label: "Network / out-of-network rules", excludePatterns: [PER_NETWORK_SHARE], patterns: ["out-of-network", "out of network", "network use required", "must use (a )?network"] },
  { name: "preauthorization", label: "Preauthorization", patterns: ["pre-?authorization", "prior authorization", "pre-certification", "precertification", "approved in advance"] },
  { name: "material-exclusions", label: "Material exclusions", excludePatterns: [EXCLUSION_REFERENCE], patterns: ["exclusion", "excluded from coverage", "not covered", "limitations and exclusions"] },
  { name: "waiting-period", label: "Waiting periods", patterns: ["waiting period"] },
  { name: "claims-filing-deadline", label: "Claims filing deadline", patterns: ["\\b(?:proof|notice) of (?:claim|loss)\\b.*\\bwithin\\b.*(?:\\(\\d+\\)|\\b\\d+\\s*(?:days?|months?|years?)\\b)", "\\bclaims?\\b.*\\b(?:must|shall|should)\\s+be\\s+(?:filed|submitted|received|presented)\\b.*\\b(?:within|no later than|not later than)\\b.*\\d"], excludePatterns: ["\\b(?:action|proceeding|suit)s?\\b.*\\bbrought\\b"] },
  { name: "geographic-restrictions", label: "Geographic restrictions", patterns: ["service area", "home country", "coverage area", "area of coverage", "territor(?:y|ial)", "state of residence", "country of residence", "destination country", "\\b(?:the )?(?:United States\\b|U\\.S\\.(?:A\\.?)?(?!\\w)|USA\\b)"], requiredPatterns: [GEO_RESTRICTION], excludePatterns: [DEFINITION, CONTACT_LINE], labelHeadPattern: "^\\s*(?:area of coverage|coverage area|service area|territor(?:y|ial)|geographic)" },
  { name: "coverage-duration", label: "Coverage-duration limits", patterns: ["maximum trip", "minimum \\d+\\s*(day|week|month|year)", "maximum \\d+\\s*(day|week|month|year)", "renewable", "up to \\d+\\s*months? of coverage"] },
  { name: "age-limits", label: "Age limits", patterns: ["\\bage limits?\\b", "\\b(?:under|over|below|above|at least|younger than|older than)\\s+(?:the\\s+)?age\\s+(?:of\\s+)?\\d+", "\\bage\\s+\\d+", "\\b\\d+\\s+(?:years?\\s+(?:of\\s+age|old)|days?\\s+of\\s+age)", "\\b(?:maximum|minimum)\\s+(?:issue\\s+|entry\\s+|enrol?lment\\s+)?age\\b", "\\b(?:dependents?|child(?:ren)?|members?|persons?|people|applicants?|insureds?|students?|travell?ers?|individuals?|adults?|spouses?)\\s+(?:who are\\s+|aged?\\s+)?(?:under|over|below|above)\\s+\\d+"], excludePatterns: ["\\$\\s?\\d"], contextField: "age" },
  { name: "referral-requirement", label: "Referrals", patterns: ["referral"], excludePatterns: [LEGAL_REFERRAL] },
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
  const period = line.match(/\bper (year|month|visit|day)\b|\bannual(?:ly)?\b|\blifetime\b|\b(?:per|for each)\s+(?:covered\s+)?(?:illness|injury|condition|accident|admission|incident|occurrence)(?:\s+or\s+(?:illness|injury|condition|accident))?\b|\bper certificate period\b/gi);
  if (period) qualifiers.period = [...new Set(period.map((p) => p.toLowerCase()))].join(", ");
  const age = line.match(/\bage\s*\d+(?:\s*(?:years? old|\+))?(?:\s+and\s+(?:over|under))?|\b(?:under|over)\s+(?:age\s*)?\d+\b|\b\d+\s+(?:days?|years?)\s+of age(?: or older)?\b/i);
  if (age) qualifiers.ageBand = age[0].trim();
  const cond = line.match(/(?:if|when|unless|waived[^.,;]*|after[^.,;]*)/i);
  if (cond) qualifiers.conditions = cond[0].trim();
  return qualifiers;
}
