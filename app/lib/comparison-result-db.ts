// Durable validated comparison result (P2): persist the exact validated
// payload the UI rendered so /api/export serves the SAME authoritative result
// and can refuse stale/mismatched exports.
//
// Authorization stays on sessions.capability_hash (app/lib/session-auth.ts).
// This module stores NO capability or secret material — only the validated
// payload + a document-version fingerprint + timestamps + 30-day expiry.
//
// Storage: same PostgREST seam as session-db.ts (service key, server-only).
// Fail-closed: reads/writes throw ComparisonResultError; callers decide
// degradation. Retention: rows carry expires_at = now + 30d and are treated
// as absent once expired (matches SESSION_LIFETIME_MS in the export route).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireScopeId } from "@/app/lib/rag/ownership";
import {
  isSessionDbConfigured,
  type SessionDbConfig,
} from "@/app/lib/session-db";
import type { SessionDocument } from "@/app/lib/session";

export const COMPARISON_RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ComparisonResultStatus = "READY" | "STALE";

/** Shape persisted in comparison_results.result_json. No capability/secret. */
export interface PersistedComparisonResultPayload {
  schemaVersion: string;
  factListVersion: string;
  documents: { documentId: string; filename: string; pageCount: number }[];
  rows: unknown[];
  presentationGroups?: unknown[];
  contacts?: unknown[];
  userContext: Record<string, string>;
}

export interface ComparisonResultRecord {
  sessionId: string;
  status: ComparisonResultStatus;
  documentFingerprint: string;
  payload: PersistedComparisonResultPayload;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export class ComparisonResultError extends Error {
  readonly step: string;
  constructor(step: string, message: string) {
    super(`comparison-result ${step}: ${message}`);
    this.name = "ComparisonResultError";
    this.step = step;
  }
}

/** Missing table in development = not migrated yet; fall back to local. */
export class ComparisonResultUnconfiguredError extends Error {
  constructor() {
    super("ComparisonResult: comparison_results table is not migrated yet");
    this.name = "ComparisonResultUnconfiguredError";
  }
}

/**
 * Document-version fingerprint: sha256 over ordered document identities.
 * Uses content sha256 when present (durable uploads), else page-count + a
 * stable hash of extracted page text. Any re-upload that changes bytes or
 * page text yields a different fingerprint, so stale results are refused.
 */
export function documentFingerprint(
  documents: ReadonlyArray<Pick<SessionDocument, "documentId" | "filename" | "pageCount" | "pages" | "sha256">>,
): string {
  const canonical = [...documents]
    .sort((a, b) => a.documentId.localeCompare(b.documentId))
    .map((d) => ({
      documentId: d.documentId,
      filename: d.filename,
      pageCount: d.pageCount,
      content:
        d.sha256 ??
        createHash("sha256").update(d.pages.join("\u0000"), "utf8").digest("hex"),
    }));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function resolveConfig(): SessionDbConfig | null {
  if (!isSessionDbConfigured()) return null;
  const url = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return null;
  return { url, serviceKey };
}

// Local fallback (dev/tests without Supabase): mirrors the session store's
// tmpdir layout. Same record shape, same 30-day expiry, same fail-closed
// reads. Never authoritative in production — Supabase is the durable owner.
function resultDir(): string {
  const dir = join(tmpdir(), "insurance-simplified-sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function localPath(sessionId: string): string {
  return join(resultDir(), `${sessionId}.result.json`);
}

function saveLocal(record: ComparisonResultRecord): void {
  writeFileSync(localPath(record.sessionId), JSON.stringify(record));
}

function loadLocal(sessionId: string, now: number): ComparisonResultRecord | null {
  try {
    const record = JSON.parse(
      readFileSync(localPath(sessionId), "utf8"),
    ) as ComparisonResultRecord;
    if (!record || typeof record.sessionId !== "string") return null;
    if (record.status !== "READY") return null;
    return isUsable(record, now) ? record : null;
  } catch {
    return null;
  }
}

function headers(config: SessionDbConfig): Record<string, string> {
  return {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
    "content-type": "application/json",
  };
}

async function rest(
  config: SessionDbConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${config.url}${path}`, {
    ...init,
    headers: { ...headers(config), ...((init?.headers ?? {}) as Record<string, string>) },
  });
  if (!res.ok) {
    if (
      res.status === 404 &&
      path.startsWith("/rest/v1/comparison_results") &&
      process.env.NODE_ENV !== "production"
    ) {
      throw new ComparisonResultUnconfiguredError();
    }
    throw new ComparisonResultError(
      "postgrest",
      `${init?.method ?? "GET"} ${path} failed with status ${res.status}`,
    );
  }
  return res;
}

interface DbRow {
  session_id: string;
  status: ComparisonResultStatus;
  document_fingerprint: string;
  result_json: PersistedComparisonResultPayload;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/** True when the record is present and not expired. */
export function isUsable(record: ComparisonResultRecord, now = Date.now()): boolean {
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(expires) && now < expires;
}

/** Upsert the validated result for a session (READY, fresh 30-day expiry). */
export async function saveComparisonResult(input: {
  sessionId: string;
  documentFingerprint: string;
  payload: PersistedComparisonResultPayload;
}): Promise<void> {
  const scope = requireScopeId(input.sessionId, "saveComparisonResult");
  if (!/^[0-9a-f]{64}$/.test(input.documentFingerprint)) {
    throw new ComparisonResultError("fingerprint", "invalid document fingerprint");
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COMPARISON_RESULT_TTL_MS).toISOString();
  const record: ComparisonResultRecord = {
    sessionId: scope,
    status: "READY",
    documentFingerprint: input.documentFingerprint,
    payload: input.payload,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt,
  };
  const config = resolveConfig();
  if (!config) {
    saveLocal(record);
    return;
  }
  try {
    await rest(config, "/rest/v1/comparison_results", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          session_id: scope,
          status: "READY",
          document_fingerprint: input.documentFingerprint,
          result_json: input.payload,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          expires_at: expiresAt,
        },
      ]),
    });
  } catch (err) {
    if (err instanceof ComparisonResultUnconfiguredError) {
      saveLocal(record);
      return;
    }
    throw err;
  }
  /** Opportunistic retention sweep: physical rows outlive their 30-day
   *  expiry without a scheduled job, so piggyback expired-row removal on
   *  each save. Best-effort only — a sweep failure must never fail the
   *  save itself (the new row above is the priority). */
  try {
    await rest(
      config,
      `/rest/v1/comparison_results?expires_at=lt.${encodeURIComponent(now.toISOString())}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
  } catch {
    // Expired rows remain load-bearing-absent (isUsable treats them as gone);
    // the next save retries the sweep.
  }
}

/** Load a session's READY result; null when absent/expired/STALE (fail closed). */
export async function loadComparisonResult(
  sessionId: string,
  now = Date.now(),
): Promise<ComparisonResultRecord | null> {
  const scope = requireScopeId(sessionId, "loadComparisonResult");
  const config = resolveConfig();
  if (!config) return loadLocal(scope, now);
  let rows: DbRow[];
  try {
    const res = await rest(
      config,
      `/rest/v1/comparison_results?session_id=eq.${encodeURIComponent(scope)}&select=*`,
    );
    rows = (await res.json()) as DbRow[];
  } catch (err) {
    if (err instanceof ComparisonResultUnconfiguredError) return loadLocal(scope, now);
    throw err;
  }
  const row = rows[0];
  if (!row) return null;
  const record: ComparisonResultRecord = {
    sessionId: row.session_id,
    status: row.status,
    documentFingerprint: row.document_fingerprint,
    payload: row.result_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
  if (record.status !== "READY") return null;
  return isUsable(record, now) ? record : null;
}

/** Remove a session's stored result from both local and durable stores. */
export async function deleteComparisonResult(sessionId: string): Promise<void> {
  const scope = requireScopeId(sessionId, "deleteComparisonResult");
  try {
    rmSync(localPath(scope), { force: true });
  } catch {
    // Local removal is best-effort; the durable delete below is authoritative.
  }
  const config = resolveConfig();
  if (!config) return;
  try {
    await rest(
      config,
      `/rest/v1/comparison_results?session_id=eq.${encodeURIComponent(scope)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
  } catch (err) {
    if (err instanceof ComparisonResultUnconfiguredError) return;
    throw err;
  }
}
