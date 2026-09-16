// Comparison table types + validator (contracts/comparison-schema.md v1).
// Used by the extraction path; the RAG path MUST NOT import this module
// (constitution principle II — separate schemas per path).

import { assertVerdict, type Verdict } from "@/app/lib/verdicts";

export interface Qualifiers {
  networkTier?: string;
  period?: string;
  ageBand?: string;
  conditions?: string;
}

export interface EvidenceCitation {
  documentId: string;
  /** 1-based page number. */
  page: number;
  quote: string;
}

export interface CellValue {
  documentId: string;
  /** Full value text with ALL qualifiers verbatim (FR-006). */
  display: string;
  qualifiers: Qualifiers;
  evidence: EvidenceCitation[];
}

export interface TableRow {
  factName: string;
  verdict: Verdict;
  /** Required when verdict is DOES NOT APPEAR TO FIT: names the ruling-out context field. */
  rationale?: string;
  values: CellValue[];
}

export interface ComparisonTable {
  schemaVersion: "v1";
  factListVersion: string;
  documents: { documentId: string; filename: string; pageCount: number }[];
  rows: TableRow[];
}

function fail(msg: string): never {
  throw new Error(`Invalid comparison table: ${msg}`);
}

/** Validate an unknown payload against comparison-schema v1. Throws on violation. */
export function validateTable(payload: unknown): ComparisonTable {
  if (typeof payload !== "object" || payload === null) fail("payload not an object");
  const t = payload as Record<string, unknown>;
  if (t.schemaVersion !== "v1") fail("schemaVersion must be 'v1'");
  if (typeof t.factListVersion !== "string" || !t.factListVersion) {
    fail("factListVersion required");
  }
  if (!Array.isArray(t.documents)) fail("documents must be an array");
  if (!Array.isArray(t.rows)) fail("rows must be an array");

  const docIds = new Set<string>();
  for (const d of t.documents as Record<string, unknown>[]) {
    if (typeof d.documentId !== "string") fail("document missing documentId");
    docIds.add(d.documentId);
  }

  for (const r of t.rows as Record<string, unknown>[]) {
    assertVerdict(r.verdict);
    if (typeof r.factName !== "string" || !r.factName) fail("row missing factName");
    if (!Array.isArray(r.values)) fail(`row ${r.factName}: values must be an array`);
    if (r.verdict === "NOT STATED" && (r.values as unknown[]).length > 0) {
      fail(`row ${r.factName}: NOT STATED rows must have empty values`);
    }
    if (r.verdict === "DOES NOT APPEAR TO FIT" && typeof r.rationale !== "string") {
      fail(`row ${r.factName}: DOES NOT APPEAR TO FIT requires a rationale naming the context field`);
    }
    for (const v of r.values as Record<string, unknown>[]) {
      if (typeof v.documentId !== "string" || !docIds.has(v.documentId)) {
        fail(`row ${r.factName}: value references unknown document`);
      }
      if (typeof v.display !== "string" || !v.display.trim()) {
        fail(`row ${r.factName}: value display must be non-empty`);
      }
      if (typeof v.qualifiers !== "object" || v.qualifiers === null) {
        fail(`row ${r.factName}: value qualifiers must be an object`);
      }
      if (!Array.isArray(v.evidence) || v.evidence.length === 0) {
        fail(`row ${r.factName}: every populated value requires >=1 evidence entry (FR-007)`);
      }
      for (const e of v.evidence as Record<string, unknown>[]) {
        if (e.documentId !== v.documentId) fail(`row ${r.factName}: evidence document mismatch`);
        if (typeof e.page !== "number" || e.page < 1) fail(`row ${r.factName}: evidence page must be >= 1`);
        if (typeof e.quote !== "string" || !e.quote.trim()) {
          fail(`row ${r.factName}: evidence quote must be non-empty`);
        }
      }
    }
  }

  return payload as ComparisonTable;
}
