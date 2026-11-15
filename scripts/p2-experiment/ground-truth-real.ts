// Extraction-quality scorecard — gold labels for the preserved real corpus.
//
// Complements ./ground-truth.ts (span-level labels for the three insurance
// brochures doc-1..doc-3). This file adds:
//   - document role + expected plan identity for all six corpus documents;
//   - value-level gold targets (concept, figure, required enrollment/network
//     qualifiers, acceptable source pages) for FEP Blue Focus, FEMA NFIP and
//     the health-education guide;
//   - known noise spans that must NOT become comparison facts.
//
// Labels were taken from manual source inspection recorded in
// docs/archive/reports/REAL_PDF_DIAGNOSTIC.md and docs/archive/reports/UNSEEN_DOCUMENT_GENERALIZATION.md §4,
// and re-checked against the extracted text layer. Only short verbatim
// phrases are stored; the PDFs themselves are never committed (nonstandard/
// is gitignored; FEP/FEMA/health are read from REAL_PDFS_DIR).
//
// EXPERIMENT-ONLY: nothing in app/ imports this file.

export type CorpusKey = "img" | "worldtrips" | "sevencorners" | "fep" | "fema" | "health";

export type DocumentRole = "plan-document" | "program-brochure" | "educational-guide";

export interface CorpusDoc {
  key: CorpusKey;
  /** documentId used in the session (doc-1..3 keep ./ground-truth.ts ids). */
  documentId: string;
  /** "repo" = path relative to repo root; "real" = filename under REAL_PDFS_DIR. */
  location: "repo" | "real";
  file: string;
  /** Session the document is evaluated in (documents sharing a session are extracted together). */
  session: "brochures-3" | "fep-alone" | "fema-alone" | "health-alone";
  role: DocumentRole;
  /** Exact attested plan names expected (registered/service marks ignored). [] = must attest none. */
  expectedPlans: string[];
  pageCount: number;
}

export const CORPUS: CorpusDoc[] = [
  { key: "img", documentId: "doc-1", location: "repo", file: "nonstandard/01_img_patriot_exchange_2026.pdf", session: "brochures-3", role: "plan-document", expectedPlans: ["Patriot Exchange Program"], pageCount: 34 },
  { key: "worldtrips", documentId: "doc-2", location: "repo", file: "nonstandard/03_worldtrips_studentsecure.pdf", session: "brochures-3", role: "plan-document", expectedPlans: ["StudentSecure"], pageCount: 8 },
  { key: "sevencorners", documentId: "doc-3", location: "repo", file: "nonstandard/04_seven_corners_travel_medical_usa.pdf", session: "brochures-3", role: "plan-document", expectedPlans: ["Travel Medical Including the USA"], pageCount: 4 },
  { key: "fep", documentId: "fep", location: "real", file: "FEP-Blue-Focus-Brochure-2027-10-23.pdf", session: "fep-alone", role: "plan-document", expectedPlans: ["FEP Blue Focus"], pageCount: 140 },
  { key: "fema", documentId: "fema", location: "real", file: "fema-nfip-protect-the-life-youve-built-brochure-09-2022.pdf", session: "fema-alone", role: "program-brochure", expectedPlans: [], pageCount: 8 },
  { key: "health", documentId: "health", location: "real", file: "Health Insurance Brochure DIGITAL.pdf", session: "health-alone", role: "educational-guide", expectedPlans: [], pageCount: 13 },
];

export interface ValueTarget {
  id: string;
  doc: CorpusKey;
  /** Inventory rows that legitimately carry this concept. */
  rows: string[];
  /** Every figure that must appear in the value display and its cited quote. */
  figures: string[];
  /** Pages where the source states this value (1-based). */
  pages: number[];
  /** Applicability labels that must survive in the value's qualifiers/display. */
  requiredQualifiers: string[];
  /** Qualifier labels that would be WRONG for this value (scope leak). */
  forbiddenQualifiers?: string[];
  /** "plan" = should be attributed to the doc's plan when qualifiers are complete;
   *  "none" = program/educational context, must never be plan-attributed. */
  attribution: "plan" | "none";
  importance: "critical" | "important";
  note: string;
}

const FEP_DEDUCTIBLE_PAGES = [17, 36, 55, 63, 75, 79, 94, 116, 121, 133];
const FEP_OOP_PAGES = [17, 31, 121, 135];

export const VALUE_TARGETS: ValueTarget[] = [
  // ------------------------------------------------------------------ FEP
  // PDF p17 (Changes for 2027): "For Self Only contracts, the calendar year
  // deductible is now $1,000. For Self Plus One, and Self and Family
  // contracts, the deductible is now $2,000"; restated p36 and in Section 5
  // headers; p29 explains per-person mechanics.
  {
    id: "fep-deductible-self-only", doc: "fep", rows: ["annual-deductible"], figures: ["$1,000"],
    pages: FEP_DEDUCTIBLE_PAGES, requiredQualifiers: ["Self Only"],
    attribution: "plan", importance: "critical",
    note: "Calendar-year deductible, Self Only enrollment = $1,000 (p17, p36).",
  },
  {
    id: "fep-deductible-family", doc: "fep", rows: ["annual-deductible"], figures: ["$2,000"],
    pages: FEP_DEDUCTIBLE_PAGES, requiredQualifiers: ["Self Plus One", "Self and Family"],
    forbiddenQualifiers: ["Self Only"],
    attribution: "plan", importance: "critical",
    note: "Calendar-year deductible, Self Plus One and Self and Family enrollments = $2,000 (p17, p36).",
  },
  // PDF p17 / p31: "For a Self Only enrollment, your out-of-pocket maximum
  // ... is $11,000 when you use Preferred providers. For a Self Plus One or a
  // Self and Family enrollment ... $22,000 for Preferred provider services."
  {
    id: "fep-oop-self-only", doc: "fep", rows: ["out-of-pocket-maximum"], figures: ["$11,000"],
    pages: FEP_OOP_PAGES, requiredQualifiers: ["Self Only", "Preferred"],
    attribution: "plan", importance: "critical",
    note: "Preferred-provider catastrophic OOP maximum, Self Only = $11,000 (p17, p31, p135).",
  },
  {
    id: "fep-oop-family", doc: "fep", rows: ["out-of-pocket-maximum"], figures: ["$22,000"],
    pages: FEP_OOP_PAGES, requiredQualifiers: ["Self Plus One", "Self and Family", "Preferred"],
    forbiddenQualifiers: ["Self Only"],
    attribution: "plan", importance: "critical",
    note: "Preferred-provider catastrophic OOP maximum, Self Plus One and Self and Family = $22,000 (p17, p31, p135).",
  },
  {
    id: "fep-maternity-facility-copay", doc: "fep", rows: ["maternity-coverage"], figures: ["$3,000"],
    pages: [17], requiredQualifiers: ["Preferred"],
    attribution: "plan", importance: "important",
    note: "Maternity copayment billed by a Preferred facility = $3,000 per pregnancy (p17).",
  },
  {
    id: "fep-precert-penalty", doc: "fep", rows: ["preauthorization"], figures: ["$500"],
    pages: [31], requiredQualifiers: [],
    attribution: "plan", importance: "important",
    note: "$500 penalty for failing to obtain precertification (p31).",
  },
  // ----------------------------------------------------------------- FEMA
  {
    id: "fema-max-limits-single-family", doc: "fema", rows: ["policy-limit"], figures: ["$250,000", "$100,000"],
    pages: [5], requiredQualifiers: ["maximum", "Single-Family"],
    attribution: "none", importance: "critical",
    note: "Program maximum available: building $250,000 / contents $100,000 for a single-family home (p5) — available caps, not a purchased limit.",
  },
  {
    id: "fema-waiting-period", doc: "fema", rows: ["waiting-period"], figures: ["30-day"],
    pages: [6], requiredQualifiers: ["typically"],
    attribution: "none", importance: "important",
    note: "There's typically a 30-day waiting period before a policy goes into effect (p6) — 'typically' must survive.",
  },
  // --------------------------------------------------------------- health
  {
    id: "health-part-d-cap", doc: "health", rows: ["prescriptions", "out-of-pocket-maximum"], figures: ["$2,100"],
    pages: [4], requiredQualifiers: ["Part D"],
    attribution: "none", importance: "important",
    note: "2026 Medicare Part D out-of-pocket cap $2,100/year (p4) — program-level, not a chosen plan.",
  },
];

/** Concept-scoped spans that must NOT become comparison facts (noise). */
export interface NoiseTarget {
  id: string;
  doc: CorpusKey;
  page: number;
  /** Verbatim fragment of the source line. */
  span: string;
  kind: "table-of-contents" | "educational-definition" | "narrative";
  note: string;
}

export const NOISE_TARGETS: NoiseTarget[] = [
  { id: "fep-toc-oop", doc: "fep", page: 4, span: "Your catastrophic protection out-of-pocket maximum for deductibles, coinsurance, and copayments", kind: "table-of-contents", note: "TOC entry with dot leaders and page number." },
  { id: "fep-toc-deductible", doc: "fep", page: 4, span: "Deductible....", kind: "table-of-contents", note: "TOC entry." },
  { id: "fep-def-deductible", doc: "fep", page: 29, span: "deductible is a fixed amount of covered expenses", kind: "educational-definition", note: "Definition of a deductible, not a value." },
  { id: "health-def-deductible", doc: "health", page: 12, span: "Deductible: A dollar amount that you must pay each year", kind: "educational-definition", note: "Glossary definition (UNSEEN_DOCUMENT_GENERALIZATION.md §5)." },
  { id: "health-toc-medigap", doc: "health", page: 2, span: "Medigap ....", kind: "table-of-contents", note: "TOC entry." },
];


/** Heuristic noise detectors applied to EVERY emitted value's cited quotes.
 *  They are lower-bound flags, not labels: reported separately from measured
 *  precision. */
export const NOISE_HEURISTICS: { kind: NoiseTarget["kind"]; re: RegExp }[] = [
  { kind: "table-of-contents", re: /\.{6,}\s*\d{0,3}\s*$/ },
  { kind: "table-of-contents", re: /\.{12,}/ },
  { kind: "educational-definition", re: /^\s*[A-Z][A-Za-z ()'/-]{2,50}:\s+(?:A|An|The)\s+[a-z]/ },
  { kind: "educational-definition", re: /\b(?:is|are)\s+(?:a|an|the)\s+(?:fixed\s+|general\s+|set\s+)?(?:dollar\s+)?(?:amount|percentage|term)\b/i },
  { kind: "educational-definition", re: /\bis\s+defined\s+as\b|\bmeans\s+(?:a|an|the|any)\b/i },
];
