// The session's background reads: one job per document, its stage, and - once every job
// has ended - the engine results, saved with the session exactly as a synchronous read
// saves them (then GET /api/results serves them through the read-back gate).
//
// Requires valid session capability. Session ID alone is insufficient for authorization.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { requireScopeId } from "@/app/lib/rag/ownership";
import { loadSession } from "@/app/lib/session-store";
import { jobStore, jobView } from "@/app/lib/jobs/store";
import { allEnded, assembleAndSave } from "@/app/lib/jobs/assemble";
import { confirmSavedEngineDocuments } from "@/app/lib/engine/read-back";

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const requestId = newRequestId();
  const { sessionId } = await params;
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok) return auth.errorResponse!;
  try {
    requireScopeId(sessionId, "GET /api/jobs");
  } catch {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }
  const session = await loadSession(sessionId);
  if (!session) return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  try {
    const jobs = await jobStore().list(sessionId);
    const names = new Map(session.documents.map((d) => [d.documentId, d.filename] as const));
    const view = jobs.map((j) => jobView(j, names.get(j.documentId) ?? j.documentId));
    if (!allEnded(jobs)) return NextResponse.json({ sessionId, done: false, jobs: view }, { headers: { "cache-control": "no-store" } });
    const saved = await assembleAndSave(sessionId, session.documents, session.userContext, jobs);
    return NextResponse.json(
      {
        sessionId,
        done: true,
        jobs: view,
        engine: { documents: confirmSavedEngineDocuments(saved, session.documents) },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    logFailure(requestId, "jobs.list", err);
    return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { requestId, retryable: true });
  }
}
