// Engine worker: heartbeat with the stage reached; answers whether the user cancelled.
// 409 when this worker no longer holds the lease (it must stop: another worker has it).
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { LEASE_SECONDS, RUNNING, jobStore, type JobStatus } from "@/app/lib/jobs/store";
import { WORKER, serviceTokenError } from "@/app/lib/jobs/service-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = serviceTokenError(request);
  if (denied) return denied;
  const requestId = newRequestId();
  const { jobId } = await params;
  const body = (await request.json().catch(() => null)) as { worker?: unknown; status?: unknown } | null;
  const worker = typeof body?.worker === "string" ? body.worker : "";
  const status = body?.status as JobStatus;
  if (!WORKER.test(worker) || !RUNNING.includes(status))
    return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "worker and a running status required" });
  try {
    const job = await jobStore().progress(jobId, worker, status, LEASE_SECONDS);
    if (!job) return errorResponse("STATE_CONFLICT", 409, { requestId, message: "Lease lost." });
    return NextResponse.json({ status: job.status, cancel: job.cancelRequested });
  } catch (err) {
    logFailure(requestId, "jobs.progress", err);
    return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { requestId, retryable: true });
  }
}
