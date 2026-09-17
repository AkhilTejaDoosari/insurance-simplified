// Serves an uploaded PDF back to the browser. Without `?page`, this is the
// full original file. With `?page=N`, it renders ONLY page N of the
// original uploaded PDF as a one-page PDF (pdf-lib copy), so citations can
// point at the actual source page without relying on the browser PDF
// viewer's `#page=` fragment (see app/lib/document-url.ts sourcePageUrl).
// The filename segment is display-only; documentId is what selects the
// file. Files live only as long as the session (see app/lib/session.ts).
// Every failure is explicit: unknown session / unknown document are
// distinct 404s, and an invalid `?page` is a 400 — a citation never
// silently serves a different page than requested.

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { parsePageRequest } from "@/app/lib/citation";
import { getSession, readDocumentFile } from "@/app/lib/session";

function pdfHeaders(filename: string): HeadersInit {
  return {
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
    "cache-control": "private, no-store",
  };
}

export async function GET(
  request: NextRequest,
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
  const pageParam = new URL(request.url).searchParams.get("page");
  if (pageParam === null) {
    return new NextResponse(new Uint8Array(bytes), {
      headers: pdfHeaders(doc.filename),
    });
  }
  const requested = parsePageRequest(pageParam);
  if (requested.kind !== "valid" || requested.page > doc.pageCount) {
    return NextResponse.json(
      {
        error: `Invalid page: ?page must be an integer from 1 to ${doc.pageCount}`,
      },
      { status: 400 }
    );
  }
  let singlePage: Uint8Array;
  try {
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [requested.page - 1]);
    out.addPage(copied);
    singlePage = await out.save();
  } catch {
    return NextResponse.json(
      { error: "Could not read the requested PDF page" },
      { status: 422 }
    );
  }
  return new NextResponse(Buffer.from(singlePage), {
    headers: pdfHeaders(doc.filename),
  });
}
