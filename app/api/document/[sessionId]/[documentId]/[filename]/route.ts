// Serves an uploaded PDF's raw bytes back to the browser. This endpoint
// performs NO page navigation: citations link to the app-owned viewer at
// `/view/<sessionId>/<documentId>/<filename>?page=N` (see
// app/lib/document-url.ts), which renders the cited page itself instead of
// relying on the browser PDF viewer's `#page=` fragment. The filename
// segment is only there so the browser names the tab after it; documentId
// is what selects the file. Files live only as long as the session (see
// app/lib/session.ts). Unknown sessions and unknown documents fail with
// distinct explicit 404s, never a silent wrong file.

import { NextRequest, NextResponse } from "next/server";
import { getSession, readDocumentFile } from "@/app/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; documentId: string }> }
) {
  const { sessionId, documentId } = await params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  }
  const doc = session.documents.find((d) => d.documentId === documentId);
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
