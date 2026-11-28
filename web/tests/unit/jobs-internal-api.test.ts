// The engine worker's internal job API: service token required (constant-time check),
// only the lease holder gets a document or reports, and a completed job must carry the
// engine's result. The job store is stubbed; its SQL is tested in tests/integration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { jobStore, type Job, type JobStore } from "@/app/lib/jobs/store";

vi.mock("@/app/lib/jobs/store", async (orig) => ({
  ...(await orig<typeof import("@/app/lib/jobs/store")>()),
  jobStore: vi.fn(),
}));

import { POST as claim } from "@/app/api/internal/jobs/claim/route";
import { GET as document } from "@/app/api/internal/jobs/[jobId]/document/route";
import { POST as progress } from "@/app/api/internal/jobs/[jobId]/progress/route";
import { POST as finish } from "@/app/api/internal/jobs/[jobId]/finish/route";

const TOKEN = "service-token-for-tests-0123456789";
const job = (o: Partial<Job> = {}): Job => ({
  id: "job-1",
  sessionId: "sess-1",
  documentId: "doc-1",
  status: "parsing",
  cloudConsent: true,
  attempts: 1,
  maxAttempts: 3,
  cancelRequested: false,
  errorCode: null,
  leaseOwner: "w1",
  result: null,
  ...o,
});
const store = {
  claim: vi.fn<JobStore["claim"]>(),
  get: vi.fn<JobStore["get"]>(),
  progress: vi.fn<JobStore["progress"]>(),
  finish: vi.fn<JobStore["finish"]>(),
};

const req = (path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? TOKEN}` }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const params = (jobId = "job-1") => ({ params: Promise.resolve({ jobId }) });

beforeEach(() => {
  vi.stubEnv("ENGINE_SERVICE_TOKEN", TOKEN);
  vi.mocked(jobStore).mockReturnValue(store as unknown as JobStore);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("internal job API (engine worker)", () => {
  it("refuses a missing or wrong service token, and a deployment without one", async () => {
    expect((await claim(req("/api/internal/jobs/claim", { body: { worker: "w1" }, token: null }))).status).toBe(401);
    expect((await claim(req("/api/internal/jobs/claim", { body: { worker: "w1" }, token: "nope" }))).status).toBe(401);
    vi.stubEnv("ENGINE_SERVICE_TOKEN", "");
    expect((await claim(req("/api/internal/jobs/claim", { body: { worker: "w1" } }))).status).toBe(503);
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("claims with a lease, or answers 204 when there is nothing to do", async () => {
    store.claim.mockResolvedValueOnce(job()).mockResolvedValueOnce(null);
    const res = await claim(req("/api/internal/jobs/claim", { body: { worker: "w1" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).job).toMatchObject({ id: "job-1", sessionId: "sess-1", documentId: "doc-1", cloudConsent: true, attempt: 1 });
    expect(store.claim).toHaveBeenCalledWith("w1", 1200);
    expect((await claim(req("/api/internal/jobs/claim", { body: { worker: "w1" } }))).status).toBe(204);
    expect((await claim(req("/api/internal/jobs/claim", { body: { worker: "bad worker!" } }))).status).toBe(400);
  });

  it("gives the document only to the lease holder of a running job", async () => {
    store.get.mockResolvedValue(job({ leaseOwner: "w2" }));
    expect((await document(req("/api/internal/jobs/job-1/document?worker=w1", { method: "GET" }), params())).status).toBe(409);
    store.get.mockResolvedValue(job({ status: "completed", leaseOwner: null }));
    expect((await document(req("/api/internal/jobs/job-1/document?worker=w1", { method: "GET" }), params())).status).toBe(409);
  });

  it("a heartbeat answers whether the user cancelled; a lost lease is 409", async () => {
    store.progress.mockResolvedValueOnce(job({ status: "extracting", cancelRequested: true })).mockResolvedValueOnce(null);
    const ok = await progress(req("/api/internal/jobs/job-1/progress", { body: { worker: "w1", status: "extracting" } }), params());
    expect(await ok.json()).toEqual({ status: "extracting", cancel: true });
    const lost = await progress(req("/api/internal/jobs/job-1/progress", { body: { worker: "w1", status: "verifying" } }), params());
    expect(lost.status).toBe(409);
    const bad = await progress(req("/api/internal/jobs/job-1/progress", { body: { worker: "w1", status: "completed" } }), params());
    expect(bad.status).toBe(400); // finishing goes through /finish only
  });

  it("a completed job needs the engine's result; failure codes are short and plain", async () => {
    const noResult = await finish(req("/api/internal/jobs/job-1/finish", { body: { worker: "w1", status: "completed" } }), params());
    expect(noResult.status).toBe(400);
    expect(store.finish).not.toHaveBeenCalled();
    store.finish.mockResolvedValue(job({ status: "failed" }));
    await finish(
      req("/api/internal/jobs/job-1/finish", { body: { worker: "w1", status: "failed", errorCode: "Deductible $500 <script>" } }),
      params(),
    );
    expect(store.finish).toHaveBeenCalledWith("job-1", "w1", "failed", null, "failed"); // not echoed
    const result = { document_sha256: "a".repeat(64), pages: 2, facts: [] };
    store.finish.mockResolvedValue(job({ status: "completed" }));
    const done = await finish(req("/api/internal/jobs/job-1/finish", { body: { worker: "w1", status: "completed", result } }), params());
    expect(done.status).toBe(200);
    expect(store.finish).toHaveBeenLastCalledWith("job-1", "w1", "completed", result, null);
    store.finish.mockResolvedValue(null);
    const late = await finish(req("/api/internal/jobs/job-1/finish", { body: { worker: "w1", status: "cancelled" } }), params());
    expect(late.status).toBe(409);
  });
});
