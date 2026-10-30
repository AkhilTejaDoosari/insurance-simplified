// Personalized "Eligibility for you" composite row (Essentials #1).
// Replaces the separate visible Eligibility / Student-visa / Coverage-dates
// rows: those facts remain in the extraction contract as evidence feeders,
// but only this composite renders. User context (age, residency, visa,
// location, coverage dates) parameterizes the evaluation and is never a
// display row. Verdicts reuse the closed five-state vocabulary.

import type {
  CellValue,
  ComparisonTable,
  EvidenceCitation,
  TableRow,
} from "@/app/lib/extraction/types";
import type { Verdict } from "@/app/lib/verdicts";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { NO_RATE_FOR_AGE_PREFIX, VARIES_BY_AGE } from "@/app/lib/extraction/premium";

export const ELIGIBILITY_ROW_NAME = "eligibility-for-you";

export const ELIGIBILITY_ROW_LABEL = "Eligibility for you";

/** Feeder facts: extracted for evidence, never rendered as own rows. */
export const ELIGIBILITY_FEEDERS: readonly string[] = [
  "eligibility",
  "student-eligibility",
  "coverage-dates",
  "age-limits",
];

/** Feeders with no canonical display section of their own. age-limits keeps
 *  its Rules & Restrictions row and additionally feeds the composite. */
export const NON_DISPLAY_FEEDERS: readonly string[] = [
  "eligibility",
  "student-eligibility",
  "coverage-dates",
];

/** Intake fields that can complete an otherwise unevaluatable composite. */
export const ELIGIBILITY_INPUT_FIELDS: readonly string[] = [
  "visaOrStatus",
  "coverageDates",
  "age",
];

const SEVERITY: Record<Verdict, number> = {
  "DOES NOT APPEAR TO FIT": 4,
  CONFLICTED: 3,
  "NEEDS VERIFICATION": 2,
  SUPPORTED: 1,
  "NOT STATED": 0,
};

/** Single deterministic context rule-out (FR-003): a context field rules
 *  text out when the user supplied it and the text does not contain the
 *  user's value. Both extraction engines defer to this — the LLM provides
 *  evidence, this decides fit. */
export function contextFieldRulesOut(
  contextField: string | undefined,
  userContext: Record<string, string>,
  text: string
): string | null {
  if (!contextField) return null;
  const userValue = (userContext[contextField] ?? "").trim();
  if (!userValue) return null;
  if (!text.toLowerCase().includes(userValue.toLowerCase())) {
    return contextField;
  }
  return null;
}

const feederContextField = (factName: string): string | undefined =>
  FACTS.find((f) => f.name === factName)?.contextField;

/** A feeder row is ruled out when every cited value misses the supplied
 *  context value across its display and evidence quotes. */
export function feederRuledOut(
  row: TableRow,
  userContext: Record<string, string>
): string | null {
  const field = feederContextField(row.factName);
  if (!field) return null;
  if ((userContext[field] ?? "").trim() === "") return null;
  if (row.values.length === 0) return null;
  const allOut = row.values.every((v) => {
    const haystack = [v.display, ...v.evidence.map((e) => e.quote)].join("\n");
    return contextFieldRulesOut(field, userContext, haystack) !== null;
  });
  return allOut ? field : null;
}

/** Build the composite from feeder rows; feeders stay in the table for
 *  evidence/contract stability and are hidden at the display layer.
 *  Deterministic evaluation runs here for BOTH engines: engine verdicts
 *  never override the context rule-out. */
export function buildEligibilityRow(
  rows: TableRow[],
  userContext: Record<string, string>
): TableRow {
  const feeders = rows.filter((r) => (ELIGIBILITY_FEEDERS as readonly string[]).includes(r.factName));
  for (const feeder of feeders) {
    const ruledOut = feederRuledOut(feeder, userContext);
    if (ruledOut) {
      return {
        factName: ELIGIBILITY_ROW_NAME,
        verdict: "DOES NOT APPEAR TO FIT",
        rationale: `User context field '${ruledOut}' rules this fact out.`,
        values: feeder.values.map((v) => ({
          documentId: v.documentId,
          display: v.display,
          qualifiers: { ...v.qualifiers },
          evidence: v.evidence.map((e) => ({ ...e })),
        })),
      };
    }
  }
  const cited = feeders.filter((r) => r.verdict !== "NOT STATED" && r.values.length > 0);
  if (cited.length === 0) {
    return { factName: ELIGIBILITY_ROW_NAME, verdict: "NOT STATED", values: [] };
  }
  let winning = cited[0];
  for (const r of cited) {
    if (SEVERITY[r.verdict] > SEVERITY[winning.verdict]) winning = r;
  }
  const values: CellValue[] = cited.flatMap((r) =>
    r.values.map((v) => ({
      documentId: v.documentId,
      display: v.display,
      qualifiers: { ...v.qualifiers },
      evidence: v.evidence.map((e) => ({ ...e })),
    }))
  );
  const row: TableRow = {
    factName: ELIGIBILITY_ROW_NAME,
    verdict: winning.verdict,
    values,
  };
  if (winning.verdict === "DOES NOT APPEAR TO FIT" && typeof winning.rationale === "string") {
    row.rationale = winning.rationale;
  }
  return row;
}

/** Append the composite to a validated-shape table (feeders retained). */
export function withEligibilityRow<T extends ComparisonTable>(
  table: T,
  userContext: Record<string, string>
): T {
  const composite = buildEligibilityRow(table.rows, userContext);
  return {
    ...table,
    rows: [...table.rows.filter((r) => r.factName !== ELIGIBILITY_ROW_NAME), composite],
  };
}

/** First still-missing intake field when the composite genuinely cannot
 *  complete (NOT STATED); null when evaluation finished or nothing missing. */
export function eligibilityMissingField(
  composite: TableRow,
  userContext: Record<string, string>
): string | null {
  if (composite.verdict !== "NOT STATED") return null;
  for (const field of ELIGIBILITY_INPUT_FIELDS) {
    if (!(userContext[field] ?? "").trim()) return field;
  }
  return null;
}

// --- Controlled interpretation (V1.1 M2 task 7) ---------------------------
// Pure rules over validated rows + exact user context. Every material finding
// carries a rule ID, the user-context inputs it consumed, and the source
// evidence it rests on (spec R.3). The closed output vocabulary is the three
// information types of spec I: documented fact, potential conflict,
// unresolved question. Nothing here ever produces a determination the
// evidence cannot support — a missing input yields a question, and an
// apparent conflict stays potential (spec I: "An apparent conflict is not
// automatically a definitive rejection").

/** Closed vocabulary for what a rule established. */
export type InterpretationKind =
  | "documented-fact"
  | "potential-conflict"
  | "unresolved-question";

export interface Interpretation {
  ruleId: string;
  kind: InterpretationKind;
  /** Plain-language statement of what the evidence does and does not say. */
  statement: string;
  /** Exact user-context inputs this rule consumed. */
  context: { field: string; value: string }[];
  /** Concrete question to confirm before relying on the coverage. */
  question?: string;
  /** Source passages the finding rests on; empty only for genuine absence. */
  evidence: EvidenceCitation[];
}

export const RULE_IDS = {
  residenceCoverage: "residence-coverage-mismatch",
  residenceUnconfirmed: "residence-not-supplied",
  premiumMissing: "premium-not-stated",
  premiumAgeDependent: "premium-age-unknown",
  eligibilityUnconfirmed: "eligibility-unconfirmed",
} as const;

/** A restriction must target coverage *in* the residence country, not just
 * mention residency alongside an unrelated exclusion on the same page. */
const COVERAGE_LOST = /\b(?:does not cover|do not cover|not covered|is not covered|does not apply|not applicable|not available|is not available|excludes?|excluded?|exclusion|does not include|not payable)\b/i;
const RESIDENCE_PLACE = /\b(?:in|within|for)\b[^.!?]{0,90}\bcountry of residence\b/i;
const COVERAGE_WORD = /\b(?:cover(?:age)?|claims?|benefits?|policies?|plans?)\b/i;
const COVERAGE_IN_RESIDENCE = /\b(?:cover(?:age)?|claims?|benefits?|policies?|plans?)\b[^.!?]{0,90}\b(?:in|within|for)\b[^.!?]{0,90}\bcountry of residence\b/i;

function excludesResidenceCoverage(quote: string): boolean {
  return quote.split(/[.!?;\n]+/).some((clause) => {
    const lost = COVERAGE_LOST.exec(clause);
    if (!lost) return false;
    const before = clause.slice(0, lost.index);
    const after = clause.slice(lost.index + lost[0].length);
    return (RESIDENCE_PLACE.test(after) && COVERAGE_WORD.test(before + lost[0])) ||
      COVERAGE_IN_RESIDENCE.test(before) ||
      COVERAGE_IN_RESIDENCE.test(after);
  });
}

const COUNTRY_ALIASES: Record<string, string> = {
  "us": "united states",
  "usa": "united states",
  "u.s.": "united states",
  "united states of america": "united states",
  "uk": "united kingdom",
  "u.k.": "united kingdom",
  "great britain": "united kingdom",
};

const KNOWN_COUNTRIES = new Set([
  "argentina",
  "australia",
  "austria",
  "belgium",
  "brazil",
  "canada",
  "chile",
  "china",
  "colombia",
  "denmark",
  "finland",
  "france",
  "germany",
  "india",
  "indonesia",
  "ireland",
  "israel",
  "italy",
  "japan",
  "malaysia",
  "mexico",
  "netherlands",
  "new zealand",
  "norway",
  "philippines",
  "portugal",
  "singapore",
  "south africa",
  "south korea",
  "spain",
  "sweden",
  "switzerland",
  "thailand",
  "united arab emirates",
  "united kingdom",
  "united states",
]);

function normalizeCountry(name: string): string {
  const key = name.toLowerCase().trim();
  return COUNTRY_ALIASES[key] ?? key;
}

const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
]);

const US_STATE_ABBREVIATIONS = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia",
  "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt",
  "va", "wa", "wv", "wi", "wy", "dc",
]);

const US_ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

function isDomesticUsSuffix(suffix: string): boolean {
  const norm = suffix.toLowerCase().replace(/\.$/, "");
  return US_STATE_NAMES.has(norm) || US_STATE_ABBREVIATIONS.has(norm) || US_ZIP_PATTERN.test(norm);
}

/** The destination country is explicit when the location names it. Recognized
 *  US state/ZIP suffixes are treated as domestic when the residence is the US.
 *  Any other suffix is ambiguous and must not be assumed domestic or foreign. */
function locationCountry(location: string, residence: string): string | null {
  const loc = location.trim();
  const res = residence.trim();
  if (!res || !loc) return null;
  // A bare city name cannot establish a country without guessing.
  if (!loc.includes(",")) return null;
  const suffix = /(?:^|,)\s*([a-z0-9][a-z0-9 .-]*)\s*$/i.exec(loc)?.[1]?.trim();
  if (!suffix) return null;
  const suffixNorm = normalizeCountry(suffix);
  const resNorm = normalizeCountry(res);
  if (KNOWN_COUNTRIES.has(suffixNorm)) {
    return suffixNorm === resNorm ? res : suffixNorm;
  }
  if (resNorm === "united states" && isDomesticUsSuffix(suffix)) {
    return res;
  }
  return null;
}

/** Derive the controlled interpretations for a validated result. Deterministic:
 *  no model prose is re-evaluated here — only validated displays, evidence and
 *  canonical user context feed these rules. */
export function deriveInterpretations(
  rows: TableRow[],
  userContext: Record<string, string>,
): Interpretation[] {
  const out: Interpretation[] = [];

  // Residence restriction vs the residence the user actually supplied.
  // Both parts of the restriction must appear in the SAME cited passage;
  // concatenating unrelated values could falsely create an exclusion.
  const residenceEvidence = rows
    .filter((row) => row.verdict !== "NOT STATED" && row.verdict !== "NEEDS VERIFICATION")
    .flatMap((row) => row.values.flatMap((value) => value.evidence))
    .filter((e) => excludesResidenceCoverage(e.quote))
    .map((e) => ({ documentId: e.documentId, page: e.page, quote: e.quote }));
  if (residenceEvidence.length > 0) {
    const residence = (userContext.countryOrResidency ?? "").trim();
    const location = (userContext.location ?? "").trim();
    const context = [
      ...(residence ? [{ field: "countryOrResidency", value: residence }] : []),
      ...(location ? [{ field: "location", value: location }] : []),
    ];
    const destinationCountry = locationCountry(location, residence);
    const evidence: EvidenceCitation[] = residenceEvidence;
    if (residence && destinationCountry && destinationCountry.toLowerCase() === residence.toLowerCase()) {
      out.push({
        ruleId: RULE_IDS.residenceCoverage,
        kind: "potential-conflict",
        statement:
          `The document excludes coverage in the insured person's country of residence. Your requested coverage location (${location}) is in your stated country of residence (${residence}); this may affect coverage, but does not determine eligibility.`,
        context,
        question: "Ask the insurer whether the residence-country exclusion applies to your requested coverage location.",
        evidence,
      });
    } else if (residence && destinationCountry) {
      out.push({
        ruleId: RULE_IDS.residenceCoverage,
        kind: "documented-fact",
        statement: `The document excludes coverage in the insured person's country of residence (${residence}). Your stated coverage location is ${location}; this restriction alone does not establish eligibility or coverage there.`,
        context,
        evidence,
      });
    } else {
      out.push({
        ruleId: RULE_IDS.residenceUnconfirmed,
        kind: "unresolved-question",
        statement:
          "The document restricts coverage by country of residence. Your residence or the country of your requested coverage location cannot be established from the supplied context, so applicability remains unknown.",
        context,
        question: "Provide your country of residence and the country of your requested coverage location to check this restriction.",
        evidence,
      });
    }
  }

  // Cost the source never states, or a rate that depends on missing context.
  const premium = rows.find((r) => r.factName === "premium");
  if (premium && premium.values.length === 0 && premium.verdict === "NOT STATED") {
    out.push({
      ruleId: RULE_IDS.premiumMissing,
      kind: "unresolved-question",
      statement: "The premium is not stated in the uploaded evidence.",
      context: [],
      question:
        "Ask the insurer for a quote covering your age, residence and coverage dates before relying on this plan.",
      evidence: [],
    });
  } else if (
    premium &&
    premium.values.length === 0 &&
    (premium.rationale === VARIES_BY_AGE ||
      (typeof premium.rationale === "string" &&
        premium.rationale.startsWith(NO_RATE_FOR_AGE_PREFIX)))
  ) {
    out.push({
      ruleId: RULE_IDS.premiumAgeDependent,
      kind: "unresolved-question",
      statement: premium.rationale,
      context: (userContext.age ?? "").trim()
        ? [{ field: "age", value: userContext.age!.trim() }]
        : [],
      question:
        premium.rationale === VARIES_BY_AGE
          ? "Share your age so the applicable rate band can be selected."
          : "Ask the insurer which published rate covers your age.",
      evidence: [],
    });
  }

  // Eligibility the evidence never completes stays unconfirmed.
  const eligibility = rows.find((r) => r.factName === ELIGIBILITY_ROW_NAME);
  if (eligibility && eligibility.verdict === "NOT STATED" && eligibility.values.length === 0) {
    out.push({
      ruleId: RULE_IDS.eligibilityUnconfirmed,
      kind: "unresolved-question",
      statement:
        "Eligibility is unconfirmed: the uploaded evidence does not state whether the policy applies to you.",
      context: [],
      question:
        "Ask the insurer which eligibility conditions apply to your age, residence, visa status and coverage dates.",
      evidence: [],
    });
  }

  return out;
}
