import type { Metadata } from "next";
import { getSession } from "@/app/lib/session";
import { resolveCitationPage } from "@/app/lib/citation";
import { documentUrl, rawDocumentUrl, sourcePageUrl } from "@/app/lib/document-url";

type Props = {
  params: Promise<{ sessionId: string; documentId: string; filename: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Browser tab uses the ACTUAL stored document filename (documentId is
 *  authoritative for lookup; the URL filename segment is display-only and
 *  is never trusted for metadata). Falls back to the URL segment only when
 *  the session is gone and there is nothing stored to name. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionId, documentId, filename } = await params;
  const stored = getSession(sessionId)?.documents.find(
    (d) => d.documentId === documentId
  )?.filename;
  return { title: `${stored ?? filename} — citation` };
}

export default async function CitationViewer({ params, searchParams }: Props) {
  const { sessionId, documentId } = await params;
  const { page } = await searchParams;
  const resolved = resolveCitationPage(getSession(sessionId), documentId, page);

  if (!resolved.ok) {
    let message: string;
    if (resolved.error === "unknown-session") {
      message =
        "This citation link is no longer valid: the comparison session has expired or was closed.";
    } else if (resolved.error === "unknown-document") {
      message =
        "This citation link is no longer valid: the document is not part of this comparison session.";
    } else {
      message = `This citation link is no longer valid: the document has ${resolved.pageCount} page${resolved.pageCount === 1 ? "" : "s"}, so the requested page does not exist.`;
    }
    return (
      <main className="panel" aria-label="Citation">
        <h1>Citation unavailable</h1>
        <p className="text-muted" role="alert">
          {message}
        </p>
        <p>
          <a href="/">Start a new comparison</a>
        </p>
      </main>
    );
  }

  return (
    <main className="panel" aria-label="Citation">
      <p className="text-muted">
        {resolved.filename} — Page {resolved.page} of {resolved.pageCount}
      </p>
      <iframe
        title={`${resolved.filename}, page ${resolved.page}`}
        src={sourcePageUrl(sessionId, documentId, resolved.filename, resolved.page)}
        style={{ width: "100%", height: "70vh", border: "1px solid #ccc" }}
      />
      <blockquote className="quote">
        <p style={{ whiteSpace: "pre-wrap" }}>{resolved.text}</p>
        <cite>
          {documentId}, page {resolved.page}
        </cite>
      </blockquote>
      <nav style={{ display: "flex", gap: 16, marginTop: 16 }}>
        {resolved.page > 1 ? (
          <a href={documentUrl(sessionId, documentId, resolved.filename, resolved.page - 1)}>
            ← Page {resolved.page - 1}
          </a>
        ) : null}
        {resolved.page < resolved.pageCount ? (
          <a href={documentUrl(sessionId, documentId, resolved.filename, resolved.page + 1)}>
            Page {resolved.page + 1} →
          </a>
        ) : null}
        <a
          href={rawDocumentUrl(sessionId, documentId, resolved.filename)}
          target="_blank"
          rel="noopener"
        >
          Open full original PDF
        </a>
      </nav>
    </main>
  );
}
