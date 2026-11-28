// The session's saved engine results, so reloading "/" shows the results screen again.
//
// Requires valid session capability (cookie / Authorization: Bearer / x-session-capability).
// Session ID alone is insufficient for authorization. Returns only what /api/extract
// already returned to this session: the engine's facts (printed words, pages, states) and
// the documents' names and page counts - never PDF bytes or capability material.

import { NextRequest, NextResponse } from "next/server";
import { loadComparisonResult, documentFingerprint } from "@/app/lib/comparison-result-db";
import { requireScopeId } from "@/app/lib/rag/ownership";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { loadSession } from "@/app/lib/session-store";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { confirmSavedEngineDocuments } from "@/app/lib/engine/read-back";

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const requestId = newRequestId();
  const { sessionId } = await params;
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok) return auth.errorResponse!;
  try {
    requireScopeId(sessionId, "GET /api/results");
  } catch {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }
  const session = await loadSession(sessionId);
  if (!session) return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  try {
    const record = await loadComparisonResult(sessionId);
    // A result saved for other documents than the session holds now is stale: never shown.
    const engine =
      record && record.documentFingerprint === documentFingerprint(session.documents)
        ? record.payload.engine
        : undefined;
    if (!engine) return errorResponse("NOT_FOUND", 404, { requestId, message: "No saved results" });
    return NextResponse.json(
      {
        sessionId,
        documents: session.documents.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          pageCount: d.pageCount,
        })),
        // re-checked against the session's own documents before it is shown again
        engine: { documents: confirmSavedEngineDocuments(engine.documents, session.documents) },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    logFailure(requestId, "results.load", err);
    return errorResponse("INTERNAL_ERROR", 500, { requestId });
  }
}
