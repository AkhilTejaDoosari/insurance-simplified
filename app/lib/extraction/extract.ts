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
import { evidenceIdFor } from "@/app/lib/evidence-ids";
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
  return display.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "");
}

function isVague(line: string): boolean {
  const lower = line.toLowerCase();
  return VAGUE_PATTERNS.some((p) => lower.includes(p));
}

type ScopeQualifierKey = "planTier" | "networkTier" | "period" | "ageBand" | "conditions";

/** Qualifier keys that scope a value to one slice of a plan. Two values
 *  share a scope only when every one of these agrees (case-insensitive):
 *  in-network vs. out-of-network are different scopes, as are Lite vs.
 *  Platinum tiers. */
const SCOPE_KEYS: readonly ScopeQualifierKey[] = [
  "planTier",
  "networkTier",
  "period",
  "ageBand",
  "conditions",
];

function scopeSignature(qualifiers: unknown): string {
  const q =
    typeof qualifiers === "object" && qualifiers !== null
      ? (qualifiers as Record<string, unknown>)
      : {};
  return SCOPE_KEYS.map((k) => {
    const v = q[k];
    return typeof v === "string" ? v.toLowerCase().trim() : "";
  }).join("|");
}

/** Genuine same-document/same-scope contradiction: two values from the SAME
 *  documentId, under the SAME scope, with different normalized readings.
 *  Values from different documentIds are different comparison inputs —
 *  never a conflict, no matter how far apart the figures are. V1 has no
 *  document-to-plan identity, so it confirms CONFLICTED only within one
 *  documentId and never infers that two documents describe the same plan;
 *  cross-document same-plan conflict detection is a future plan-identity
 *  capability. */
export function hasSameScopeContradiction(
  values: { documentId: unknown; display: unknown; qualifiers: unknown }[]
): boolean {
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i];
      const b = values[j];
      if (a.documentId !== b.documentId) continue;
      if (scopeSignature(a.qualifiers) !== scopeSignature(b.qualifiers)) continue;
      if (typeof a.display !== "string" || typeof b.display !== "string") continue;
      if (normalize(a.display) === normalize(b.display)) continue;
      return true;
    }
  }
  return false;
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
        evidence: [{
          documentId: doc.documentId,
          page: match.page,
          quote: match.quote,
          evidenceId: evidenceIdFor(doc.documentId, match.page, match.quote),
        }],
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
    // Cross-document differences are comparison data, not evidence
    // conflict: separate plans are expected to state different figures
    // (different structures too — a range in one plan vs. a fixed amount
    // in another is SUPPORTED). CONFLICTED is reserved for a genuine
    // same-document/same-scope contradiction, which the single-match-per-document
    // fallback cannot observe, so every cited row here is SUPPORTED.
    return {
      factName: fact.name,
      verdict: "SUPPORTED",
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
  "Tiers within one document differing from each other is NOT a conflict; different plans, tiers, and scopes stating different values is normal comparison data.",
  "Every populated value needs >=1 evidence entry with 1-based page and the exact quote.",
  "Rows for facts in no document use NOT STATED with empty values.",
  "Never attach evidence to an absence, and never cite an unrelated passage to fill the evidence requirement — state the absence explicitly.",
  "Use SUPPORTED whenever each value has cited, usable evidence — even when figures differ across documents, plan tiers, or network tiers (e.g. doc-1 deductible $250 vs. doc-2 deductible $500; Lite $250 vs. Platinum $500; in-network vs. out-of-network).",
  "Use CONFLICTED ONLY for a genuine same-document/same-scope contradiction: two values from the SAME documentId with the SAME scope (planTier, networkTier, period, ageBand, and conditions all equal) making incompatible claims, each with its own evidence. Two values from different documentIds are NEVER sufficient for CONFLICTED — V1 has no document-to-plan identity, so never infer that two documents describe the same plan — and values scoped to different tiers are NEVER contradictory merely because the figures differ.",
  "Use NEEDS VERIFICATION ONLY when the source statement itself is vague, partial, ambiguous, or cannot safely support a concrete interpretation — never merely because different plans structure a benefit differently (a range in one plan vs. a fixed amount in another is SUPPORTED).",
].join("\n");

/** Boundary normalization for LLM output (defense in depth: the prompt
 *  requires qualifiers, but models still omit or null it). Coerce missing,
 *  null, or non-object qualifiers on any value to {} before validation.
 *  Evidence IDs are always server-assigned here (never model-generated):
 *  every well-formed evidence entry gets its deterministic session-bound
 *  ID so citation URLs resolve; malformed entries are left for validation
 *  to reject. */
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
          const v = { ...(value as Record<string, unknown>) };
          const q = v.qualifiers;
          if (typeof q !== "object" || q === null || Array.isArray(q)) {
            v.qualifiers = {};
          }
          if (Array.isArray(v.evidence)) {
            v.evidence = v.evidence.map((e) => {
              if (typeof e !== "object" || e === null) return e;
              const entry = { ...(e as Record<string, unknown>) };
              if (
                typeof entry.documentId === "string" &&
                typeof entry.page === "number" &&
                typeof entry.quote === "string"
              ) {
                entry.evidenceId = evidenceIdFor(entry.documentId, entry.page, entry.quote);
              }
              return entry;
            });
          }
          return v;
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
 *  - CONFLICTED is kept only for a genuine same-document/same-scope
 *    contradiction (same documentId, same qualifiers scope, incompatible
 *    readings each with its own evidence). V1 has no document-to-plan
 *    identity, so cross-document values are comparison data and are
 *    recorded SUPPORTED; detecting conflicts across documents that belong
 *    to one plan is a future plan-identity capability. */
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
          (v): v is { documentId: unknown; display: unknown; qualifiers: unknown } =>
            typeof v === "object" && v !== null
        );
        if (!hasSameScopeContradiction(typed)) {
          console.warn(
            `[extractViaLlm] CONFLICTED on fact "${String(r.factName)}" has no same-document/same-scope contradiction (cross-document differences are comparison data); recorded as SUPPORTED`
          );
          out.verdict = "SUPPORTED";
          delete out.rationale;
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
