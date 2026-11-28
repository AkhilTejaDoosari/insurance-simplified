// WP5 jobs against real Postgres (db/migrations/0008_extraction_jobs.sql) through the
// web app's job store. SKIPS (never fake-passes) when SUPABASE_URL / secret key are absent.
//
// Proves: enqueue is idempotent; two workers never claim the same job; only the lease
// holder reports; a worker that dies mid-job is replaced once its lease expires and its
// late reports are refused; cancel and retry are idempotent; finished jobs stay finished.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseJobStore } from "@/app/lib/jobs/store";

const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";
const configured = Boolean(url && key);
const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}`);
  return res;
}

const SESSION = `sess-jobs-${randomUUID()}`;
const EXTRACTION = { document_sha256: "a".repeat(64), pages: 1, parser: { name: "t", version: "1" }, facts: [] };

describe.skipIf(!configured)("extraction jobs in Postgres (migration 0008)", () => {
  afterAll(async () => {
    if (configured) await rest(`/rest/v1/sessions?id=eq.${SESSION}`, { method: "DELETE" });
  });

  it("runs the lifecycle with leases, recovery, cancel and retry", async () => {
    await rest("/rest/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ id: SESSION, capability_hash: "x".repeat(64) }),
    });
    const store = supabaseJobStore();

    // enqueue: one job per document, twice is the same
    expect((await store.enqueue(SESSION, ["d1", "d2"], false)).map((j) => j.documentId).sort()).toEqual(["d1", "d2"]);
    const again = await store.enqueue(SESSION, ["d1", "d2"], true);
    expect(again).toHaveLength(2);
    expect(again.every((j) => j.status === "uploaded" && !j.cloudConsent)).toBe(true);

    // two workers, two different jobs
    const a = (await store.claim("w1", 600))!;
    const b = (await store.claim("w2", 600))!;
    expect([a.documentId, b.documentId].sort()).toEqual(["d1", "d2"]);
    expect(a.status).toBe("parsing");
    expect(a.attempts).toBe(1);
    expect(await store.claim("w3", 600)).toBeNull(); // nothing left

    // only the lease holder reports
    expect(await store.progress(a.id, "w2", "extracting", 600)).toBeNull();
    expect((await store.progress(a.id, "w1", "extracting", 600))!.status).toBe("extracting");

    // w1 dies: its lease runs out, w3 takes the job over (attempt 2)
    await rest(`/rest/v1/extraction_jobs?id=eq.${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() }),
    });
    const taken = (await store.claim("w3", 600))!;
    expect(taken.id).toBe(a.id);
    expect(taken.attempts).toBe(2);
    expect(await store.finish(a.id, "w1", "failed", null, "late")).toBeNull(); // refused
    expect((await store.finish(a.id, "w3", "completed", EXTRACTION as never, null))!.status).toBe("completed");
    expect(await store.finish(a.id, "w3", "failed", null, "again")).toBeNull(); // stays completed

    // cancel: the running job is asked to stop; cancelling twice changes nothing
    await store.cancel(SESSION);
    const afterCancel = await store.cancel(SESSION);
    const runB = afterCancel.find((j) => j.id === b.id)!;
    expect(runB.cancelRequested).toBe(true);
    expect((await store.progress(b.id, "w2", "verifying", 600))!.cancelRequested).toBe(true);
    expect((await store.finish(b.id, "w2", "cancelled", null, null))!.status).toBe("cancelled");

    // retry: the cancelled job starts over; the completed one is untouched; twice is the same
    await store.retry(SESSION);
    const retried = await store.retry(SESSION);
    expect(retried.find((j) => j.id === b.id)).toMatchObject({ status: "uploaded", attempts: 0, cancelRequested: false });
    expect(retried.find((j) => j.id === a.id)).toMatchObject({ status: "completed" });
    expect((await store.get(a.id))!.result).toMatchObject({ document_sha256: "a".repeat(64) });
  });
});
