// Shapes of the real-document evaluation labels (the data itself lives in
// REAL_FIXTURES_DIR/p2-experiment; see real-fixtures.ts). Types only.

// ---- span-level labels (ground-truth)
export type DocId = "doc-1" | "doc-2" | "doc-3";

export type GroundTruthKind =
  | "coverage-fact"
  | "deductible-limit"
  | "exclusion-restriction"
  | "eligibility"
  | "tier-dependent"
  | "optional-rider"
  | "narrative"
  | "known-false-positive";

export interface GroundTruthItem {
  id: string;
  doc: DocId;
  page: number;
  span: string;
  kind: GroundTruthKind;
  /** Open-vocabulary expected concept (may sit outside the 43-fact inventory). */
  expectedConcept: string;
  /** Plan/tier/network/age/condition applicability as stated by the source. */
  applicability: string;
  expectedHandling: "display" | "optional" | "withhold";
  notes?: string;
}

export interface GroundTruthModule {
  GROUND_TRUTH: GroundTruthItem[];
  DOCS: Record<DocId, { documentId: DocId; file: string; label: string }>;
}

// ---- corpus, value and noise targets (ground-truth-real)
/** Neutral corpus key chosen by the local label file. */
export type CorpusKey = string;

export type DocumentRole = "plan-document" | "program-brochure" | "educational-guide";

export interface CorpusDoc {
  key: CorpusKey;
  /** documentId used in the session (doc-1..3 keep the ground-truth ids). */
  documentId: string;
  /** "repo" = path relative to repo root; "real" = filename under REAL_PDFS_DIR. */
  location: "repo" | "real";
  file: string;
  /** Session the document is evaluated in (documents sharing a session are extracted together). */
  session: string;
  role: DocumentRole;
  /** Exact attested plan names expected (registered/service marks ignored). [] = must attest none. */
  expectedPlans: string[];
  pageCount: number;
}

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

export interface NoiseTarget {
  id: string;
  doc: CorpusKey;
  page: number;
  /** Verbatim fragment of the source line. */
  span: string;
  kind: "table-of-contents" | "educational-definition" | "narrative";
  note: string;
}

export interface GroundTruthRealModule {
  CORPUS: CorpusDoc[];
  VALUE_TARGETS: ValueTarget[];
  NOISE_TARGETS: NoiseTarget[];
  /** Corpus key whose deductible/OOP gold set is exhaustive (row precision). */
  ROW_PRECISION_DOC?: CorpusKey;
}

/** Heuristic noise detectors applied to EVERY emitted value's cited quotes.
 *  They are lower-bound flags, not labels: reported separately from measured
 *  precision. (Pattern logic only — no source text.) */
export const NOISE_HEURISTICS: { kind: NoiseTarget["kind"]; re: RegExp }[] = [
  { kind: "table-of-contents", re: /\.{6,}\s*\d{0,3}\s*$/ },
  { kind: "table-of-contents", re: /\.{12,}/ },
  { kind: "educational-definition", re: /^\s*[A-Z][A-Za-z ()'/-]{2,50}:\s+(?:A|An|The)\s+[a-z]/ },
  { kind: "educational-definition", re: /\b(?:is|are)\s+(?:a|an|the)\s+(?:fixed\s+|general\s+|set\s+)?(?:dollar\s+)?(?:amount|percentage|term)\b/i },
  { kind: "educational-definition", re: /\bis\s+defined\s+as\b|\bmeans\s+(?:a|an|the|any)\b/i },
];

// ---- adjudicated claim labels (claim-labels)
export type ClaimVerdict = "correct" | "concept-adjacent" | "missing-qualifier" | "wrong-concept" | "incorrect";
/** `pending`: an open owner adjudication question about a restriction whose
 *  applicability the source does not settle (never counted as complete). */
export interface ClaimLabel { verdict: ClaimVerdict; note?: string; pending?: string }
export interface ClaimLabelsModule { CLAIM_LABELS: Record<string, ClaimLabel> }

// ---- hand-written gold provisions (gold-provisions)
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
export interface GoldProvisionsModule { GOLD: GoldProvision[]; WITHHELD_DOCUMENTS: readonly string[] }
