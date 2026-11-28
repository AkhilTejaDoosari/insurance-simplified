// WP5 background jobs: the extraction_jobs table (db/migrations/0008_extraction_jobs.sql)
// through Supabase REST with the service key. Server-only. The web app is the table's only
// reader and writer (owner decision 2026-11-28): users reach it through their session
// capability (/api/jobs/...), the engine worker through the internal job API with the
// service token (/api/internal/jobs/...). Never PDF bytes or capability material here.

import { randomUUID } from "node:crypto";
import { isSessionDbConfigured } from "@/app/lib/session-db";
import { isEngineConfigured } from "@/app/lib/engine/client";
import type { components } from "@/app/lib/engine/contract.gen";

export type Extraction = components["schemas"]["Extraction"];
export type JobStatus =
  | "uploaded"
  | "parsing"
  | "extracting"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";
export const RUNNING: readonly JobStatus[] = ["parsing", "extracting", "verifying"];
export const FINAL: readonly JobStatus[] = ["completed", "failed", "cancelled"];

export interface Job {
  id: string;
  sessionId: string;
  documentId: string;
  status: JobStatus;
  cloudConsent: boolean;
  attempts: number;
  maxAttempts: number;
  cancelRequested: boolean;
  errorCode: string | null;
  leaseOwner: string | null;
  result: Extraction | null;
}

export interface JobStore {
  /** One job per (session, document); enqueueing again changes nothing (idempotent). */
  enqueue(sessionId: string, documentIds: string[], cloudConsent: boolean): Promise<Job[]>;
  list(sessionId: string): Promise<Job[]>;
  get(jobId: string): Promise<Job | null>;
  cancel(sessionId: string): Promise<Job[]>;
  retry(sessionId: string): Promise<Job[]>;
  claim(worker: string, leaseSeconds: number): Promise<Job | null>;
  progress(jobId: string, worker: string, status: JobStatus, leaseSeconds: number): Promise<Job | null>;
  finish(
    jobId: string,
    worker: string,
    status: "completed" | "failed" | "cancelled",
    result: Extraction | null,
    errorCode: string | null,
  ): Promise<Job | null>;
}

/** Background jobs are used when ENGINE_JOBS=1, the engine and the database are
 *  configured. Otherwise /api/extract reads synchronously (the rollback path). */
export function jobsEnabled(): boolean {
  return process.env.ENGINE_JOBS === "1" && isEngineConfigured() && isSessionDbConfigured();
}

/** Lease of one claim: the engine's own per-document limit (900 s) plus a margin. A
 *  worker that dies stops renewing it; the job becomes claimable again afterwards. */
export const LEASE_SECONDS = 1200;

interface Row {
  id: string;
  session_id: string;
  document_id: string;
  status: JobStatus;
  cloud_consent: boolean;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  error_code: string | null;
  lease_owner: string | null;
  result_json: Extraction | null;
}

const fromRow = (r: Row): Job => ({
  id: r.id,
  sessionId: r.session_id,
  documentId: r.document_id,
  status: r.status,
  cloudConsent: r.cloud_consent,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  cancelRequested: r.cancel_requested,
  errorCode: r.error_code,
  leaseOwner: r.lease_owner,
  result: r.result_json,
});

export class JobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStoreError";
  }
}

export function supabaseJobStore(): JobStore {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) throw new JobStoreError("job store not configured");
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

  async function call(path: string, init: RequestInit = {}): Promise<Row[]> {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...headers, ...((init.headers ?? {}) as Record<string, string>) },
      cache: "no-store",
    });
    // never echo the database's message: it may carry query details
    if (!res.ok) throw new JobStoreError(`${init.method ?? "GET"} ${path.split("?")[0]} failed with status ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as Row[]) : [];
  }
  const rpc = (fn: string, args: Record<string, unknown>) =>
    call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  const one = (rows: Row[]) => (rows[0] ? fromRow(rows[0]) : null);
  const list = async (sessionId: string) =>
    (
      await call(
        `/rest/v1/extraction_jobs?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.asc,id.asc`,
      )
    ).map(fromRow);

  return {
    async enqueue(sessionId, documentIds, cloudConsent) {
      if (documentIds.length) {
        await call("/rest/v1/extraction_jobs?on_conflict=session_id,document_id", {
          method: "POST",
          headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(
            documentIds.map((documentId) => ({
              id: `job-${randomUUID()}`,
              session_id: sessionId,
              document_id: documentId,
              cloud_consent: cloudConsent,
            })),
          ),
        });
      }
      return list(sessionId);
    },
    list,
    async get(jobId) {
      return one(await call(`/rest/v1/extraction_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`));
    },
    async cancel(sessionId) {
      return (await rpc("cancel_extraction_jobs", { p_session: sessionId })).map(fromRow);
    },
    async retry(sessionId) {
      return (await rpc("retry_extraction_jobs", { p_session: sessionId })).map(fromRow);
    },
    async claim(worker, leaseSeconds) {
      return one(await rpc("claim_extraction_job", { p_worker: worker, p_lease_seconds: leaseSeconds }));
    },
    async progress(jobId, worker, status, leaseSeconds) {
      return one(
        await rpc("progress_extraction_job", {
          p_id: jobId,
          p_worker: worker,
          p_status: status,
          p_lease_seconds: leaseSeconds,
        }),
      );
    },
    async finish(jobId, worker, status, result, errorCode) {
      return one(
        await rpc("finish_extraction_job", {
          p_id: jobId,
          p_worker: worker,
          p_status: status,
          p_result: result,
          p_error: errorCode,
        }),
      );
    },
  };
}

/** What a user (and the UI) may see of a job: never the worker or the raw result. */
export function jobView(job: Job, filename: string) {
  return {
    documentId: job.documentId,
    filename,
    status: job.status,
    attempts: job.attempts,
    cancelRequested: job.cancelRequested,
    errorCode: job.errorCode,
  };
}

/** The job store the routes use (Supabase). */
export function jobStore(): JobStore {
  return supabaseJobStore();
}
