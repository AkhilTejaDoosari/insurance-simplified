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
  "Every populated value needs >=1 evidence entry with 1-based page and the exact quote.",
  "Rows for facts in no document use NOT STATED with empty values.",
  "Differing values across documents use CONFLICTED; vague/partial statements use NEEDS VERIFICATION.",
].join("\n");

export async function extractViaLlm(
  documents: ExtractInputDocument[],
  userContext: Record<string, string>
): Promise<ComparisonTable> {
  const prompt = wrapDocuments(
    `${EXTRACTION_INSTRUCTIONS}\nUser context (apply a field ONLY when documents reference it): ${JSON.stringify(userContext)}`,
    documents.map(({ documentId, pages }) => ({ documentId, pages }))
  );
  const raw = await completeJson([{ role: "user", content: prompt }]);
  return validateTable(raw);
}

export function extractComparison(
  documents: ExtractInputDocument[],
  userContext: Record<string, string> = {},
  opts: { useLlm?: boolean } = {}
): ComparisonTable {
  if (!opts.useLlm) return extractFallback(documents, userContext);
  throw new Error("useLlm=true requires the async extractViaLlm path");
}
