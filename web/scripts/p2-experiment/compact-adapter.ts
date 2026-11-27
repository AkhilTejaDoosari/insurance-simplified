// Local-only P2 adapter proof. Not imported by application/runtime code.
// This is intentionally narrower than a semantic classifier: ambiguous claims
// abstain, and citation occurrence is never treated as semantic applicability.
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import {
  validateTable,
  type ComparisonTable,
  type TableRow,
} from "@/app/lib/extraction/types";

type CompactCitation = { page: number; quote: string };
type CompactValue = {
  documentId: string;
  concept: string;
  value: string;
  scope?: Record<string, unknown>;
  /** Locally declared applicability dimensions required for this proof case. */
  requiredScope?: string[];
  evidence: CompactCitation[];
};
type SourceDocument = {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
};
type Rejection = {
  status: "incomplete" | "unsupported" | "unmappable";
  reasons: string[];
};
type Accepted = { status: "accepted"; row: TableRow };
export type AdapterResult = Rejection | Accepted;

const FIELD_MAP: Record<string, { factName: string; displaySubject: RegExp }> =
  {
    deductible: {
      factName: "Annual deductible",
      displaySubject: /\bdeductible\b/i,
    },
  };
const SCOPE_KEYS = new Set([
  "period",
  "currency",
  "frequency",
  "ageBand",
  "conditions",
]);

export function adaptCompactValue(
  candidate: CompactValue,
  documents: SourceDocument[],
): AdapterResult {
  const doc = documents.find(
    (item) => item.documentId === candidate.documentId,
  );
  if (!doc || !candidate.documentId?.trim())
    return {
      status: "unsupported",
      reasons: ["unknown or malformed document identity"],
    };
  if (!candidate.evidence.length)
    return { status: "incomplete", reasons: ["citation required"] };
  const scope = candidate.scope ?? {};
  const missingRequired = (candidate.requiredScope ?? []).filter(
    (key) => scope[key] === undefined,
  );
  if (missingRequired.length) {
    return {
      status: "incomplete",
      reasons: [`required qualifier(s) missing: ${missingRequired.join(", ")}`],
    };
  }
  const keys = Object.keys(scope);
  const unknown = keys.filter(
    (key) =>
      ![
        "enrollment",
        "network",
        "tier",
        "period",
        "currency",
        "frequency",
        "ageBand",
        "conditions",
        "service",
        "exclusions",
        "exceptions",
      ].includes(key),
  );
  if (unknown.length)
    return {
      status: "unsupported",
      reasons: [`unknown scope key(s): ${unknown.join(", ")}`],
    };
  if (keys.includes("exclusions"))
    return {
      status: "unsupported",
      reasons: ["asserted exclusion list is unsupported as a complete claim"],
    };
  const notRepresentable = keys.filter((key) => !SCOPE_KEYS.has(key));
  if (notRepresentable.length)
    return {
      status: "unmappable",
      reasons: [
        `scope cannot be represented losslessly: ${notRepresentable.join(", ")}`,
      ],
    };
  const field = FIELD_MAP[candidate.concept];
  if (!field)
    return {
      status: "unmappable",
      reasons: [
        `concept has no allowlisted schema mapping: ${candidate.concept}`,
      ],
    };

  const evidence = [];
  for (const item of candidate.evidence) {
    const verified = verifyEvidenceCitation(documents, {
      documentId: candidate.documentId,
      page: item.page,
      quote: item.quote,
    });
    if (!verified.ok)
      return {
        status: "incomplete",
        reasons: [`citation failed on page ${item.page}`],
      };
    evidence.push({
      documentId: candidate.documentId,
      page: item.page,
      quote: verified.quote,
    });
  }
  const cited = evidence.map((item) => item.quote).join("\n");
  if (
    !candidate.value.trim() ||
    !cited.includes(
      candidate.value.match(/\$[\d,]+(?:\.\d+)?|\d+%/)?.[0] ?? "\u0000",
    ) ||
    !field.displaySubject.test(cited)
  ) {
    return {
      status: "incomplete",
      reasons: [
        "value amount and mapped subject are not bound by cited source text",
      ],
    };
  }
  const qualifiers: Record<string, string> = {};
  for (const key of keys) {
    const value = scope[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !cited.toLowerCase().includes(value.toLowerCase())
    ) {
      return {
        status: "incomplete",
        reasons: [`scope ${key} is not explicitly bound by cited source text`],
      };
    }
    qualifiers[key] = value;
  }
  const table: ComparisonTable = {
    schemaVersion: "v1",
    factListVersion: "p2-local-adapter-proof",
    documents: [
      {
        documentId: doc.documentId,
        filename: doc.filename,
        pageCount: doc.pageCount,
      },
    ],
    rows: [
      {
        factName: field.factName,
        verdict: "NEEDS VERIFICATION",
        values: [
          {
            documentId: doc.documentId,
            display: candidate.value,
            qualifiers,
            evidence,
          },
        ],
      },
    ],
  };
  try {
    validateTable(table);
  } catch (error) {
    return {
      status: "incomplete",
      reasons: [
        `existing schema gate rejected candidate: ${(error as Error).message}`,
      ],
    };
  }
  return { status: "accepted", row: table.rows[0] };
}

function titleKey(value: string): string {
  return value
    .replace(/®|™|℠/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Experimental title-context recognition only; never mints a ProvenPlan. */
export function recognizeExperimentalPlanTitle(
  name: string,
  doc: SourceDocument,
): { recognized: boolean; name?: string } {
  if (!name.trim() || !doc.pages[0]) return { recognized: false };
  const lines = doc.pages[0]
    .split(/\r?\n/)
    .slice(0, 6)
    .map((line) => line.trim())
    .filter(Boolean);
  const requested = titleKey(name);
  const matches = lines.filter((line) => titleKey(line) === requested);
  const competing = lines.filter(
    (line) =>
      /^\s*(?:plan|policy) name:/i.test(line) && titleKey(line) !== requested,
  );
  if (matches.length !== 1 || competing.length > 0)
    return { recognized: false };
  return { recognized: true, name: matches[0].replace(/®|™|℠/g, "").trim() };
}
