// Retry the session's background reads (idempotent: a second call changes nothing).
// Requires valid session capability. Session ID alone is insufficient for authorization.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { loadSession } from "@/app/lib/session-store";
import { jobStore, jobView } from "@/app/lib/jobs/store";

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const requestId = newRequestId();
  const { sessionId } = await params;
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok) return auth.errorResponse!;
  const session = await loadSession(sessionId);
  if (!session) return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  try {
    const jobs = await jobStore().retry(sessionId);
    const names = new Map(session.documents.map((d) => [d.documentId, d.filename] as const));
    return NextResponse.json({ sessionId, jobs: jobs.map((j) => jobView(j, names.get(j.documentId) ?? j.documentId)) });
  } catch (err) {
    logFailure(requestId, "jobs.retry", err);
    return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { requestId, retryable: true });
  }
}
