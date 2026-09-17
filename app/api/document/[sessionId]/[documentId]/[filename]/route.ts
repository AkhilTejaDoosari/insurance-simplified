// Serves an uploaded PDF back to the browser so evidence citations can link
// to `/api/document/<sessionId>/<documentId>/<filename>#page=N`. The
// filename segment is only there so the browser names the tab after it;
// documentId is what selects the file. `#page=` is handled by the browser's
// PDF viewer. Files live only as long as the session (see app/lib/session.ts).
// URL builder: app/lib/document-url.ts.

import { NextRequest, NextResponse } from "next/server";
import { getSession, readDocumentFile } from "@/app/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; documentId: string }> }
) {
  const { sessionId, documentId } = await params;
  const session = getSession(sessionId);
  const doc = session?.documents.find((d) => d.documentId === documentId);
  const bytes = doc ? readDocumentFile(sessionId, documentId) : undefined;
  if (!doc || !bytes) {
    return NextResponse.json({ error: "Unknown document" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${doc.filename.replace(/["\\\r\n]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  });
}
