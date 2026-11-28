// Engine worker: the PDF of a job it holds the lease for (bytes as uploaded).
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { RUNNING, jobStore } from "@/app/lib/jobs/store";
import { WORKER, serviceTokenError } from "@/app/lib/jobs/service-auth";
import { loadSession } from "@/app/lib/session-store";
import { readDocumentFile } from "@/app/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = serviceTokenError(request);
  if (denied) return denied;
  const requestId = newRequestId();
  const { jobId } = await params;
  const worker = request.nextUrl.searchParams.get("worker") ?? "";
  if (!WORKER.test(worker)) return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "worker required" });
  try {
    const job = await jobStore().get(jobId);
    // only the lease holder of a running job gets the document
    if (!job || job.leaseOwner !== worker || !RUNNING.includes(job.status))
      return errorResponse("STATE_CONFLICT", 409, { requestId, message: "Not this worker's job." });
    if (!(await loadSession(job.sessionId)))
      return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
    const bytes = readDocumentFile(job.sessionId, job.documentId);
    if (!bytes) return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown document" });
    return new NextResponse(Buffer.from(bytes), {
      headers: { "content-type": "application/pdf", "cache-control": "no-store" },
    });
  } catch (err) {
    logFailure(requestId, "jobs.document", err);
    return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { requestId, retryable: true });
  }
}
