// AT-PERSIST read-back by RE-DERIVATION (no durable seal key; owner default).
//
// A comparison result read back from comparison_results carries no authority.
// Before any surface (chat, export) uses it, this module:
//   1. checks the stored content still reproduces the fingerprint issued at
//      extraction (canonical content binding; detects edits after issue);
//   2. re-runs the single verification boundary (verify-table) over the stored
//      rows against the session's stored page text;
//   3. re-seals provable values into a fresh ProvisionStore and re-issues each
//      re-derived row under THIS request's EvidenceAuthority;
//   4. renders the STORED rows through the issued-resolution gate, so a stored
//      row is shown only if it equals its re-derivation; anything else is
//      "cannot be confirmed" and shows no value.

import { EvidenceAuthority, canonicalJson } from "@/app/lib/evidence/canonical";
import { CANNOT_BE_CONFIRMED, checkIssued, type Issued } from "@/app/lib/evidence/issued";
import { isCannotBeConfirmedRow, issueRows, renderIssuedRows, type RowResolution } from "@/app/lib/evidence/row-resolution";
import { sealVerifiedTable, type SessionEvidence } from "@/app/lib/evidence/session-evidence";
import {
  documentFingerprint,
  resultFingerprintFor,
  type ComparisonResultRecord,
} from "@/app/lib/comparison-result-db";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import { verifyComparisonTable, type VerifiableDocument } from "@/app/lib/extraction/verify-table";
import type { ComparisonTable, RegisteredComparisonTable, TableRow } from "@/app/lib/extraction/types";

export interface ReadBackDocument extends VerifiableDocument {
  sha256?: string;
}

export interface ConfirmedResult {
  /** Rows as surfaces may render them (evidence ids minted here). */
  table: RegisteredComparisonTable;
  /** factNames shown as "cannot be confirmed". */
  cannotBeConfirmed: string[];
  /** Stored rows by factName, used ONLY to relate an unconfirmed row to a
   *  chat citation — never displayed. */
  storedRows: TableRow[];
  /** Present when re-derivation ran: the request's registry and store. */
  evidence: SessionEvidence | null;
}

/** verify-table prefixes a row's prior rationale to its grounding notes, so a
 *  re-run may repeat notes already present; that is the same rationale. */
function sameRationale(stored: string | undefined, derived: string | undefined): boolean {
  if (stored === derived) return true;
  if (typeof stored !== "string" || typeof derived !== "string") return false;
  if (!derived.startsWith(`${stored} `)) return false;
  return stored.includes(derived.slice(stored.length + 1));
}

function storedCoreTable(record: ComparisonResultRecord): ComparisonTable {
  const p = record.payload;
  return {
    schemaVersion: p.schemaVersion as "v1",
    factListVersion: p.factListVersion,
    documents: p.documents,
    ...(p.plans ? { plans: p.plans } : {}),
    ...(p.coverage !== undefined ? { coverage: p.coverage } : {}),
    rows: (Array.isArray(p.rows) ? p.rows : []) as TableRow[],
  } as ComparisonTable;
}

/** Re-derive a stored result for this session and request. */
export function confirmStoredResult(input: {
  sessionId: string;
  documents: readonly ReadBackDocument[];
  record: ComparisonResultRecord;
  authority?: EvidenceAuthority;
}): ConfirmedResult {
  const authority = input.authority ?? new EvidenceAuthority();
  const stored = storedCoreTable(input.record);
  const docs = [...input.documents];
  let issued: Issued<RowResolution>[] = [];
  let evidence: SessionEvidence | null = null;

  const bound =
    input.record.sessionId === input.sessionId &&
    typeof input.record.payload.resultFingerprint === "string" &&
    input.record.payload.resultFingerprint ===
      resultFingerprintFor({
        documentFingerprint: documentFingerprint(docs),
        table: stored,
        context: input.record.payload.userContext ?? {},
      });

  let plansVerified = false;
  try {
    const rederived = verifyComparisonTable(structuredClone(stored), docs);
    plansVerified = canonicalJson(rederived.plans ?? null) === canonicalJson(stored.plans ?? null);
    if (bound && plansVerified && rederived.rows.length === stored.rows.length) {
      evidence = sealVerifiedTable(input.sessionId, docs, rederived, { authority });
      const rows = rederived.rows.map((row, i) =>
        sameRationale(stored.rows[i]?.rationale, row.rationale) ? { ...row, rationale: stored.rows[i].rationale } : row,
      );
      issued = issueRows(authority, input.sessionId, rows, evidence.provisionIdsByRow);
    }
  } catch {
    issued = [];
    evidence = null;
    plansVerified = false;
  }

  // Render the STORED rows under the re-derived seals: equal → confirmed.
  const candidates = stored.rows.map((row, i) => {
    const seal = issued[i];
    const resolution: RowResolution = { row, provisionIds: seal ? [...seal.resolution.provisionIds] : [] };
    return seal ? { resolution, meta: seal.meta, seal: seal.seal } : { resolution };
  });
  const rendered = renderIssuedRows(authority, input.sessionId, candidates);

  const p = input.record.payload;
  const table: RegisteredComparisonTable = {
    schemaVersion: stored.schemaVersion,
    factListVersion: stored.factListVersion,
    documents: stored.documents,
    ...(p.resultFingerprint ? { resultFingerprint: p.resultFingerprint } : {}),
    // Plan identities are kept only when every source re-verifies unchanged.
    ...(plansVerified && stored.plans ? { plans: stored.plans } : {}),
    ...(bound && p.coverage !== undefined ? { coverage: p.coverage } : {}),
    presentationGroups: (p.presentationGroups ?? []) as RegisteredComparisonTable["presentationGroups"],
    rows: rendered.rows.map((row) => ({ ...row, values: row.values.map((v) => ({ ...v, evidence: v.evidence.map(withEvidenceId) })) })),
  };
  return { table, cannotBeConfirmed: rendered.cannotBeConfirmed, storedRows: stored.rows, evidence };
}

/** Re-check, at render time, that an issued row is still confirmed. */
export function rowStillConfirmed(authority: EvidenceAuthority, sessionId: string, issued: unknown): boolean {
  return checkIssued<RowResolution>(authority, sessionId, issued).status === "confirmed";
}

/** A comparison-row resolution related to a chat answer. */
export interface AnswerResolution {
  factName: string;
  /** "confirmed" rows re-derived; anything else is "cannot be confirmed". */
  status: "confirmed" | typeof CANNOT_BE_CONFIRMED;
  verdict: TableRow["verdict"];
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function overlaps(a: { documentId: string; page: number; quote: string }, b: { documentId: string; page: number; quote: string }): boolean {
  if (a.documentId !== b.documentId || a.page !== b.page) return false;
  const x = squash(a.quote);
  const y = squash(b.quote);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

/** Rows whose evidence overlaps a verified chat citation, with their
 *  confirmation status. An unconfirmed row's stored evidence is used ONLY to
 *  relate it to the citation; its values are never shown. */
export function resolutionsForCitations(
  confirmed: Pick<ConfirmedResult, "table" | "storedRows">,
  citations: readonly { documentId: string; page: number; quote: string }[],
): AnswerResolution[] {
  const out: AnswerResolution[] = [];
  confirmed.table.rows.forEach((row, i) => {
    const unconfirmed = isCannotBeConfirmedRow(row);
    const source = unconfirmed ? confirmed.storedRows[i] : row;
    const evidence = Array.isArray(source?.values)
      ? source.values.flatMap((v) => (Array.isArray(v?.evidence) ? v.evidence : []))
      : [];
    const related = evidence.some((e) =>
      e && typeof e.quote === "string" && typeof e.documentId === "string" && citations.some((c) => overlaps(c, e)),
    );
    if (!related) return;
    out.push(
      unconfirmed
        ? { factName: row.factName, status: CANNOT_BE_CONFIRMED, verdict: row.verdict }
        : { factName: row.factName, status: "confirmed", verdict: row.verdict },
    );
  });
  return out;
}
