// Engine worker: claim the next job (leased). 204 when there is none.
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { LEASE_SECONDS, jobStore } from "@/app/lib/jobs/store";
import { WORKER, serviceTokenError } from "@/app/lib/jobs/service-auth";

export async function POST(request: NextRequest) {
  const denied = serviceTokenError(request);
  if (denied) return denied;
  const requestId = newRequestId();
  const body = (await request.json().catch(() => null)) as { worker?: unknown } | null;
  const worker = typeof body?.worker === "string" ? body.worker : "";
  if (!WORKER.test(worker)) return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "worker required" });
  try {
    const job = await jobStore().claim(worker, LEASE_SECONDS);
    if (!job) return new NextResponse(null, { status: 204 });
    return NextResponse.json({
      job: {
        id: job.id,
        sessionId: job.sessionId,
        documentId: job.documentId,
        cloudConsent: job.cloudConsent,
        attempt: job.attempts,
        leaseSeconds: LEASE_SECONDS,
      },
    });
  } catch (err) {
    logFailure(requestId, "jobs.claim", err);
    return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { requestId, retryable: true });
  }
}
