// Serves an uploaded PDF back to the browser so evidence citations can link
// to `/api/document?sessionId=…&documentId=…#page=N`. The `#page=` fragment
// is handled by the browser's PDF viewer. Files live only as long as the
// session (see app/lib/session.ts). URL builder: app/lib/document-url.ts.

import { NextRequest, NextResponse } from "next/server";
import { getSession, readDocumentFile } from "@/app/lib/session";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const documentId = searchParams.get("documentId");
  if (!sessionId || !documentId) {
    return NextResponse.json({ error: "sessionId and documentId required" }, { status: 400 });
  }
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
