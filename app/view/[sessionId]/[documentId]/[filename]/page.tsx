import type { Metadata } from "next";
import { getSession } from "@/app/lib/session";
import { resolveCitationPage } from "@/app/lib/citation";
import { documentUrl, rawDocumentUrl } from "@/app/lib/document-url";

type Props = {
  params: Promise<{ sessionId: string; documentId: string; filename: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Browser tab keeps the human-readable filename (same reason the filename
 *  is the last path segment). React/Next escape this; it is display-only —
 *  the documentId selects the file. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { filename } = await params;
  return { title: `${filename} — citation` };
}

export default async function CitationViewer({ params, searchParams }: Props) {
  const { sessionId, documentId } = await params;
  const { page } = await searchParams;
  const resolved = resolveCitationPage(getSession(sessionId), documentId, page);

  if (!resolved.ok) {
    return (
      <main className="panel" aria-label="Citation">
        <h1>Citation unavailable</h1>
        <p className="text-muted" role="alert">
          {resolved.error === "unknown-session"
            ? "This citation link is no longer valid: the comparison session has expired or was closed."
            : "This citation link is no longer valid: the document is not part of this comparison session."}
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
          Open original PDF
        </a>
      </nav>
    </main>
  );
}
