import type { Metadata } from "next";
import { getEvidenceRecord, getSession } from "@/app/lib/session";
import { locatePassage, resolveCitationPage } from "@/app/lib/citation";
import { documentUrl, rawDocumentUrl, sourcePageUrl } from "@/app/lib/document-url";
import SourceFrame from "@/app/components/SourceFrame";

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
  const { page, evidence } = await searchParams;
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

  // Resolve the opaque evidence ID server-side and validate it against the
  // URL before highlighting anything. Unknown or mismatched IDs fail
  // explicitly — a citation never highlights a passage it did not cite.
  const evidenceParam = Array.isArray(evidence) ? evidence[0] : evidence;
  const record = evidenceParam ? getEvidenceRecord(sessionId, evidenceParam) : undefined;
  const evidenceValid =
    record !== undefined &&
    record.documentId === documentId &&
    record.page === resolved.page;
  const evidenceError =
    evidenceParam !== undefined && !evidenceValid
      ? "This citation link is no longer valid: its evidence reference does not match this document and page."
      : null;
  const located =
    evidenceValid && record ? locatePassage(resolved.text, record.quote) : null;

  return (
    <main className="panel" aria-label="Citation">
      <p className="text-muted">
        {resolved.filename} — Page {resolved.page} of {resolved.pageCount}
      </p>
      <SourceFrame
        pageUrl={sourcePageUrl(sessionId, documentId, resolved.filename, resolved.page)}
        fullUrl={rawDocumentUrl(sessionId, documentId, resolved.filename)}
        title={`${resolved.filename}, page ${resolved.page}`}
      />
      <blockquote className="quote">
        <p style={{ whiteSpace: "pre-wrap" }}>
          {located ? (
            <>
              {located.before}
              <mark>{located.match}</mark>
              {located.after}
            </>
          ) : (
            resolved.text
          )}
        </p>
        <cite>
          {documentId}, page {resolved.page}
        </cite>
      </blockquote>
      {evidenceValid && record ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <p>
            <strong>Cited passage:</strong> “{record.quote}”
          </p>
          {!located ? (
            <p className="text-muted">
              Automatic highlighting is unavailable for this passage — the
              exact cited quote is shown above.
            </p>
          ) : null}
        </div>
      ) : null}
      {evidenceError ? (
        <p className="text-muted" role="alert">
          {evidenceError}
        </p>
      ) : null}
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
