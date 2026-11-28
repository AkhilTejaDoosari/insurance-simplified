// Engine worker: end a job it holds - completed (with the engine's extraction), failed
// (short code) or cancelled. A repeated or late call (lease lost) changes nothing: 409.
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { jobStore, type Extraction } from "@/app/lib/jobs/store";
import { WORKER, serviceTokenError } from "@/app/lib/jobs/service-auth";

const MAX_RESULT_BYTES = 5 * 1024 * 1024;
const CODE = /^[a-z0-9_:.-]{1,64}$/i;

/** The engine's own response shape, checked before it is stored. */
function isExtraction(v: unknown): v is Extraction {
  const x = v as Partial<Extraction> | null;
  return (
    !!x &&
    typeof x === "object" &&
    typeof x.document_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(x.document_sha256) &&
    typeof x.pages === "number" &&
    Array.isArray(x.facts)
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = serviceTokenError(request);
  if (denied) return denied;
  const requestId = newRequestId();
  const { jobId } = await params;
  const raw = await request.text();
  if (raw.length > MAX_RESULT_BYTES) return errorResponse("VALIDATION_ERROR", 413, { requestId, message: "Result too large." });
  let body: { worker?: unknown; status?: unknown; result?: unknown; errorCode?: unknown } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const worker = typeof body?.worker === "string" ? body.worker : "";
  const status = body?.status;
  if (!WORKER.test(worker) || (status !== "completed" && status !== "failed" && status !== "cancelled"))
    return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "worker and a final status required" });
  if (status === "completed" && !isExtraction(body?.result))
    return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "A completed job needs the engine's result." });
  const errorCode = typeof body?.errorCode === "string" && CODE.test(body.errorCode) ? body.errorCode : null;
  try {
    const job = await jobStore().finish(
      jobId,
      worker,
      status,
      status === "completed" ? (body!.result as Extraction) : null,
      status === "failed" ? (errorCode ?? "failed") : null,
    );
    if (!job) return errorResponse("STATE_CONFLICT", 409, { requestId, message: "Lease lost or job already ended." });
    return NextResponse.json({ status: job.status });
  } catch (err) {
    logFailure(requestId, "jobs.finish", err);
    return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { requestId, retryable: true });
  }
}
