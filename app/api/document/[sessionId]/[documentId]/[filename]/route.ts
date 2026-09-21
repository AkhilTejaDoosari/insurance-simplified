// Serves an uploaded PDF back to the browser, BYTE-FOR-BYTE as uploaded.
// Simple provenance serving: validate session/document, return the original
// file as application/pdf. No PDF rewriting, no page transformation — page
// selection belongs entirely to the app-owned citation viewer
// (app/view/...?page=N&evidence=..., see app/lib/document-url.ts), which
// renders the cited page itself with PDF.js. The filename segment is
// display-only; documentId is what selects the file. Files live only as
// long as the session (see app/lib/session.ts). Unknown sessions and
// unknown documents fail with distinct explicit 404s, never a silent
// wrong file.
//
// Requires valid session capability (cookie / Authorization: Bearer / x-session-capability).
// Session ID alone is insufficient for authorization.

import { NextRequest, NextResponse } from "next/server";
import { getSession, readDocumentFile } from "@/app/lib/session";
import { requireScopeId } from "@/app/lib/rag/ownership";
import { getDefaultObjectStore } from "@/app/lib/storage/objects";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { errorResponse, newRequestId } from "@/app/lib/api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; documentId: string }> }
) {
  const requestId = newRequestId();
  const { sessionId, documentId } = await params;

  // Verify capability before accessing session data
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok) {
    return auth.errorResponse!;
  }

  // P3-A ownership seam: authorization/scope is checked BEFORE any byte
  // fetch — unscoped callers fail closed here and never reach the store.
  try {
    requireScopeId(sessionId, "GET /api/document");
  } catch {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }
  const doc = session.documents.find((d) => d.documentId === documentId);
  if (!doc) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown document" });
  }
  // P3-A: durable object store first (survives restarts), legacy
  // session-temp fallback second. Either leg returns the ORIGINAL bytes —
  // the viewer/PDF.js path stays byte-identical.
  let bytes: Uint8Array | Buffer | undefined;
  if (doc.objectKey) {
    try {
      bytes = await getDefaultObjectStore().get(doc.objectKey);
    } catch {
      bytes = undefined;
    }
  }
  bytes ??= readDocumentFile(sessionId, documentId);
  if (!bytes) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown document" });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${doc.filename.replace(/["\\\r\n]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  });
}