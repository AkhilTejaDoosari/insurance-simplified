import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getEvidenceRecord, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { loadSession } from "@/app/lib/session-store";
import { capabilityAuthorizes } from "@/app/lib/session-auth";

/** The ONLY way this page reads a session: the request's capability is
 *  verified for THIS session first (DB hash; tmpdir fallback only when the DB
 *  is unconfigured) — for a cache hit exactly as for a durable restore. No
 *  capability, a wrong one, or another session's ⇒ undefined, rendered exactly
 *  like an unknown session (no filename, page count, passage or link). */
async function authorizedViewerSession(sessionId: string) {
  const capability = (await cookies()).get(SESSION_CAPABILITY_COOKIE)?.value;
  if (!(await capabilityAuthorizes(sessionId, capability))) return undefined;
  return loadSession(sessionId);
}
import { isMatchingEvidence, resolveCitationPage } from "@/app/lib/citation";
import { documentUrl, rawDocumentUrl } from "@/app/lib/document-url";
import PdfEvidenceViewer from "@/app/components/PdfEvidenceViewer";

type Props = {
  params: Promise<{ sessionId: string; documentId: string; filename: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Browser tab uses the ACTUAL stored document filename — only for an
 *  authorized request. Otherwise a neutral title (the URL segment is never
 *  trusted as metadata). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionId, documentId } = await params;
  const stored = (await authorizedViewerSession(sessionId))?.documents.find(
    (d) => d.documentId === documentId
  )?.filename;
  return { title: stored ? `${stored} — citation` : "Citation" };
}

export default async function CitationViewer({ params, searchParams }: Props) {
  const { sessionId, documentId } = await params;
  const { page, evidence } = await searchParams;
  const resolved = resolveCitationPage(await authorizedViewerSession(sessionId), documentId, page);

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
  // explicitly — a citation never highlights a passage it did not cite,
  // and the quote is never trusted from URL parameters.
  const evidenceParam = Array.isArray(evidence) ? evidence[0] : evidence;
  const record = evidenceParam ? getEvidenceRecord(sessionId, evidenceParam) : undefined;
  const evidenceValid = isMatchingEvidence(record, documentId, resolved.page);
  const evidenceError =
    evidenceParam !== undefined && !evidenceValid
      ? "This citation link is no longer valid: its evidence reference does not match this document and page."
      : null;

  return (
    <main className="panel" aria-label="Citation">
      <p className="text-muted">
        {resolved.filename} — Page {resolved.page} of {resolved.pageCount}
      </p>
      <PdfEvidenceViewer
        pdfUrl={rawDocumentUrl(sessionId, documentId, resolved.filename)}
        page={resolved.page}
        quote={evidenceValid && record ? record.quote : null}
      />
      {evidenceValid && record ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <p>
            <strong>Cited passage:</strong> “{record.quote}”
          </p>
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
