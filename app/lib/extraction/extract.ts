// Extraction path: builds the comparison table (constitution principle II).
// This module MUST NOT be imported by the RAG path (app/lib/rag/*).
//
// Two engines, one output contract:
// - Deterministic fallback (default; no credentials needed): pattern-based
//   line matching against FACTS with qualifier-preserving displays.
// - LLM engine (opt-in via useLlm when configured): schema-constrained call
//   over safe-prompt-wrapped documents; output validated with validateTable.

import {
  validateTable,
  type CellValue,
  type ComparisonTable,
  type TableRow,
} from "@/app/lib/extraction/types";
import {
  FACTS,
  FACT_LIST_VERSION,
  VAGUE_PATTERNS,
  extractQualifiers,
} from "@/app/lib/extraction/fact-list";
import { wrapDocuments } from "@/app/lib/llm/safe-prompt";
import { completeJson } from "@/app/lib/llm/client";

export interface ExtractInputDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  pages: string[];
}

function normalize(display: string): string {
  return display.toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "").trim();
}

function isVague(line: string): boolean {
  const lower = line.toLowerCase();
  return VAGUE_PATTERNS.some((p) => lower.includes(p));
}

type MonetaryShape = "fixed" | "range" | "options" | "non-monetary";

/** Classify monetary displays so structurally different presentations of one
 *  benefit (range vs. enumerated options vs. fixed amount) are not read as
 *  insurers contradicting the same figure. */
function monetaryShape(display: string): MonetaryShape {
  const amounts = display.match(/\$\s*[\d,]+(?:\.\d{1,2})?/g) ?? [];
  if (amounts.length === 0) return "non-monetary";
  if (
    /\$\s*[\d,]+(?:\.\d{1,2})?\s*(?:-|–|—|to)\s*\$?\s*[\d,]+(?:\.\d{1,2})?/i.test(display)
  ) {
    return "range";
  }
  return amounts.length > 1 ? "options" : "fixed";
}

function describeMonetaryShapes(shapes: MonetaryShape[]): string {
  const labels = {
    range: "a range",
    options: "enumerated options",
    fixed: "a fixed amount",
    "non-monetary": "a non-monetary statement",
  } as const;
  return [...new Set(shapes)].map((shape) => labels[shape]).join(" vs. ");
}

/** Find the first matching line per fact per document (line = sentence-ish unit). */
function findMatches(
  factPatterns: string[],
  pages: string[]
): { page: number; quote: string } | null {
  const regexes = factPatterns.map((p) => new RegExp(p, "i"));
  for (let i = 0; i < pages.length; i++) {
    const lines = pages[i].split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (regexes.some((re) => re.test(line))) {
        return { page: i + 1, quote: line };
      }
    }
  }
  return null;
}

/** FR-003: a context field rules the fact out when the user supplied it and
 *  the matched line does not contain the user's value. */
function ruledOutByContext(
  contextField: string | undefined,
  userContext: Record<string, string>,
  quote: string
): string | null {
  if (!contextField) return null;
  const userValue = (userContext[contextField] ?? "").trim();
  if (!userValue) return null;
  if (!quote.toLowerCase().includes(userValue.toLowerCase())) {
    return contextField;
  }
  return null;
}

export function extractFallback(
  documents: ExtractInputDocument[],
  userContext: Record<string, string>
): ComparisonTable {
  const rows: TableRow[] = FACTS.map((fact) => {
    const values: CellValue[] = [];
    let ruledOutField: string | null = null;
    let allVague = true;

    for (const doc of documents) {
      const match = findMatches(fact.patterns, doc.pages);
      if (!match) continue;
      const vague = isVague(match.quote);
      if (!vague) allVague = false;
      const ruledOut = ruledOutByContext(fact.contextField, userContext, match.quote);
      if (ruledOut) ruledOutField = ruledOut;
      values.push({
        documentId: doc.documentId,
        display: match.quote,
        qualifiers: extractQualifiers(match.quote),
        evidence: [{ documentId: doc.documentId, page: match.page, quote: match.quote }],
      });
    }

    if (values.length === 0) {
      return { factName: fact.name, verdict: "NOT STATED", values: [] };
    }
    if (ruledOutField && values.every((v) =>
      ruledOutByContext(fact.contextField, userContext, v.display))) {
      return {
        factName: fact.name,
        verdict: "DOES NOT APPEAR TO FIT",
        rationale: `User context field '${ruledOutField}' rules this fact out.`,
        values,
      };
    }
    if (allVague) {
      return { factName: fact.name, verdict: "NEEDS VERIFICATION", values };
    }
    const distinct = new Set(values.map((v) => normalize(v.display)));
    if (distinct.size > 1) {
      const shapes = values.map((v) => monetaryShape(v.display));
      if (shapes.every((shape) => shape !== "non-monetary") && new Set(shapes).size > 1) {
        return {
          factName: fact.name,
          verdict: "NEEDS VERIFICATION",
          rationale: `The documents structure this benefit differently (${describeMonetaryShapes(shapes)}); verify which presentation applies.`,
          values,
        };
      }
    }
    return {
      factName: fact.name,
      verdict: distinct.size === 1 ? "SUPPORTED" : "CONFLICTED",
      values,
    };
  });

  return {
    schemaVersion: "v1",
    factListVersion: FACT_LIST_VERSION,
    documents: documents.map(({ documentId, filename, pageCount }) => ({
      documentId,
      filename,
      pageCount,
    })),
    rows,
  };
}

const EXTRACTION_INSTRUCTIONS = [
  "You extract comparable insurance facts from the DOCUMENT blocks below.",
  `Facts to extract (one row each): ${FACTS.map((f) => f.name).join(", ")}.`,
  "Return ONLY a JSON object matching comparison-schema v1:",
  '{"schemaVersion":"v1","factListVersion":"v1","documents":[{documentId,filename,pageCount}],"rows":[{factName,verdict,rationale?,values:[{documentId,display,qualifiers,evidence:[{documentId,page,quote}]}]}]}',
  "Verdict is one of SUPPORTED, DOES NOT APPEAR TO FIT, NOT STATED, CONFLICTED, NEEDS VERIFICATION — never anything else.",
  "display MUST quote values with ALL qualifiers verbatim (network tier, period, age band, conditions) — never collapse them.",
  "Every value object MUST include a qualifiers object using any of these keys: networkTier, period, ageBand, conditions, planTier. When a value has no qualifiers to report, use an empty object {} — never null, and never omit the field.",
  "PLAN TIERS: when ONE document describes several named plan tiers or options (e.g. Lite / Plus / Platinum, or Basic / Enhanced) with different figures for the same benefit, emit a SEPARATE value object per tier, each with qualifiers.planTier set to that tier's name exactly as the document names it and display holding only that tier's figure. NEVER write one display like \"$0 to $2,500 for Lite and Plus; $0 to $25,000 for Platinum\". Correct shape for that case:",
  '[{"documentId":"doc-1","display":"$0 to $2,500","qualifiers":{"planTier":"Lite"},"evidence":[...]},{"documentId":"doc-1","display":"$0 to $2,500","qualifiers":{"planTier":"Plus"},"evidence":[...]},{"documentId":"doc-1","display":"$0 to $25,000","qualifiers":{"planTier":"Platinum"},"evidence":[...]}]',
  "Brochure comparison tables flatten to a header line naming the tiers (e.g. \"LITE PLUS PLATINUM\") followed by benefit lines listing one figure per tier in the SAME ORDER (e.g. \"Deductible $0 to $2,500 $0 to $2,500 $0 to $25,000\" = Lite $0 to $2,500, Plus $0 to $2,500, Platinum $0 to $25,000). Map figures to tiers by position and emit one value per tier; do not keep only the first figure.",
  "A figure that applies to every tier of a document gets one value with no planTier.",
  "Tiers within one document differing from each other is NOT a conflict; verdicts compare documents against each other.",
  "Every populated value needs >=1 evidence entry with 1-based page and the exact quote.",
  "Rows for facts in no document use NOT STATED with empty values.",
  "Never attach evidence to an absence, and never cite an unrelated passage to fill the evidence requirement — state the absence explicitly.",
  "Differing values across documents use CONFLICTED; vague/partial statements use NEEDS VERIFICATION.",
  "When values differ in KIND rather than contradicting each other — a range vs. enumerated options vs. one fixed amount — prefer NEEDS VERIFICATION with a rationale explaining the structural difference, not CONFLICTED.",
].join("\n");

/** Boundary normalization for LLM output (defense in depth: the prompt
 *  requires qualifiers, but models still omit or null it). Coerce missing,
 *  null, or non-object qualifiers on any value to {} before validation. */
export function normalizeLlmTable(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return raw;
  return {
    ...table,
    rows: (table.rows as unknown[]).map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const r = row as Record<string, unknown>;
      if (!Array.isArray(r.values)) return row;
      return {
        ...r,
        values: (r.values as unknown[]).map((value) => {
          if (typeof value !== "object" || value === null) return value;
          const v = value as Record<string, unknown>;
          const q = v.qualifiers;
          if (typeof q !== "object" || q === null || Array.isArray(q)) {
            return { ...v, qualifiers: {} };
          }
          return value;
        }),
      };
    }),
  };
}

/** Boundary cleanup for LLM output (principle IV): a value without evidence
 *  is a claim without support, so it cannot enter the table. A citation
 *  pointing at a different document than the value is discarded first (it
 *  supports nothing about this document), which may leave the value
 *  evidence-less. Drop such values — warning loudly, since dropped values
 *  are a model-reliability signal — and flip rows left with no cited values
 *  to NOT STATED instead of failing the whole table. NOT STATED rows
 *  carrying values are left untouched so validation still rejects that
 *  contract violation. */
export function dropEvidenceLessValues(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return raw;
  return {
    ...table,
    rows: (table.rows as unknown[]).map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const r = row as Record<string, unknown>;
      if (!Array.isArray(r.values)) return row;
      if (r.verdict === "NOT STATED") return row;
      const kept: unknown[] = [];
      for (const value of r.values as unknown[]) {
        if (typeof value !== "object" || value === null) {
          kept.push(value);
          continue;
        }
        const v = value as Record<string, unknown>;
        const evidence = Array.isArray(v.evidence)
          ? v.evidence.filter((e) => {
              const ok =
                typeof e === "object" && e !== null &&
                (e as Record<string, unknown>).documentId === v.documentId;
              if (!ok) {
                console.warn(
                  `[extractViaLlm] dropped citation on fact "${String(r.factName)}" that points at a different document than value "${String(v.documentId)}"`
                );
              }
              return ok;
            })
          : [];
        if (evidence.length > 0) {
          kept.push({ ...v, evidence });
          continue;
        }
        console.warn(
          `[extractViaLlm] dropped evidence-less value for fact "${String(r.factName)}" ` +
            `from document "${String(v.documentId)}" — claims without citations are treated as unstated (principle IV)`
        );
      }
      if (kept.length > 0) return { ...r, values: kept };
      if ((r.values as unknown[]).length === 0) return row;
      const flipped: Record<string, unknown> = { ...r, verdict: "NOT STATED", values: [] };
      delete flipped.rationale;
      return flipped;
    }),
  };
}

/** Displays that are really absences phrased as values ("Not explicitly
 *  stated", "Not specified", "Not mentioned in the document"). */
const ABSENCE_DISPLAY = /^\s*(?:not|no)\s+(?:\w+\s+)?(?:stated|specified|mentioned|provided|listed|addressed|indicated|found)\b/i;

/** Boundary reconciliation of LLM output against things the model does not
 *  get to decide (principle IV, contracts/comparison-schema.md):
 *  - `documents` metadata comes from the uploads, not the model.
 *  - An absence phrased as a value is an absence: drop it (it cannot carry
 *    evidence), and flip rows left empty to NOT STATED.
 *  - DOES NOT APPEAR TO FIT must name the ruling-out context field; without
 *    one it is NEEDS VERIFICATION (or NOT STATED when there are no values).
 *  - CONFLICTED needs values from >= 2 documents; with fewer it is SUPPORTED.
 *  - CONFLICTED values that differ in monetary shape (range vs. options vs.
 *    fixed) are NEEDS VERIFICATION, exactly as the deterministic engine rules. */
export function reconcileLlmTable(
  raw: unknown,
  documents: ExtractInputDocument[]
): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const table = raw as Record<string, unknown>;
  if (!Array.isArray(table.rows)) return raw;
  return {
    ...table,
    documents: documents.map(({ documentId, filename, pageCount }) => ({
      documentId,
      filename,
      pageCount,
    })),
    rows: (table.rows as unknown[]).map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const r = row as Record<string, unknown>;
      if (!Array.isArray(r.values)) return row;

      const values = (r.values as unknown[]).filter((value) => {
        if (typeof value !== "object" || value === null) return true;
        const v = value as Record<string, unknown>;
        if (typeof v.display === "string" && ABSENCE_DISPLAY.test(v.display)) {
          console.warn(
            `[extractViaLlm] treated "${v.display}" on fact "${String(r.factName)}" (${String(v.documentId)}) as an absence`
          );
          return false;
        }
        return true;
      });
      if (values.length === 0 && (r.values as unknown[]).length > 0) {
        return { factName: r.factName, verdict: "NOT STATED", values: [] };
      }

      const out: Record<string, unknown> = { ...r, values };
      if (r.verdict === "DOES NOT APPEAR TO FIT" && typeof r.rationale !== "string") {
        console.warn(
          `[extractViaLlm] DOES NOT APPEAR TO FIT on fact "${String(r.factName)}" names no context field; downgraded`
        );
        if (values.length === 0) return { factName: r.factName, verdict: "NOT STATED", values: [] };
        out.verdict = "NEEDS VERIFICATION";
      }
      if (r.verdict === "CONFLICTED") {
        const typed = values.filter(
          (v): v is { documentId: string; display: string } =>
            typeof v === "object" && v !== null &&
            typeof (v as Record<string, unknown>).display === "string"
        );
        const docIds = new Set(typed.map((v) => v.documentId));
        const shapes = typed.map((v) => monetaryShape(v.display));
        if (docIds.size < 2) {
          console.warn(
            `[extractViaLlm] CONFLICTED on fact "${String(r.factName)}" with values from ${docIds.size} document(s); recorded as SUPPORTED`
          );
          out.verdict = "SUPPORTED";
          delete out.rationale;
        } else if (
          shapes.every((shape) => shape !== "non-monetary") &&
          new Set(shapes).size > 1
        ) {
          out.verdict = "NEEDS VERIFICATION";
          out.rationale = `The documents structure this benefit differently (${describeMonetaryShapes(shapes)}); verify which presentation applies.`;
        }
      }
      return out;
    }),
  };
}

export async function extractViaLlm(
  documents: ExtractInputDocument[],
  userContext: Record<string, string>
): Promise<ComparisonTable> {
  const prompt = wrapDocuments(
    `${EXTRACTION_INSTRUCTIONS}\nUser context (apply a field ONLY when documents reference it): ${JSON.stringify(userContext)}`,
    documents.map(({ documentId, pages }) => ({ documentId, pages }))
  );
  const raw = await completeJson([{ role: "user", content: prompt }]);
  return validateTable(
    reconcileLlmTable(dropEvidenceLessValues(normalizeLlmTable(raw)), documents)
  );
}

export function extractComparison(
  documents: ExtractInputDocument[],
  userContext: Record<string, string> = {},
  opts: { useLlm?: boolean } = {}
): ComparisonTable {
  if (!opts.useLlm) return extractFallback(documents, userContext);
  throw new Error("useLlm=true requires the async extractViaLlm path");
}
