/** Citation viewer URL (app-owned page navigation).
 *
 *  Previously citations linked straight at the raw PDF with a `#page=`
 *  fragment and depended on the browser's PDF viewer to honour it. That
 *  hint is ignored wherever no compatible viewer handles the navigation,
 *  so citations did not reliably open at the cited page. Citations now
 *  point at the in-app viewer (`/view/...?page=N&evidence=ev-…`), which
 *  renders the cited page of the original PDF itself with PDF.js and
 *  highlights the cited passage; the full original PDF stays available via
 *  {@link rawDocumentUrl}. The filename is the last path segment so the
 *  browser titles the tab with it. */
export function documentUrl(
  sessionId: string,
  documentId: string,
  filename: string,
  page?: number,
  evidenceId?: string
): string {
  const base = `/view/${encodeURIComponent(sessionId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
  const params = new URLSearchParams();
  if (page !== undefined) params.set("page", String(page));
  if (evidenceId) params.set("evidence", evidenceId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Direct link to the uploaded PDF bytes (app/api/document), served
 *  byte-for-byte as uploaded. Page behaviour belongs to the viewer built
 *  by {@link documentUrl}. */
export function rawDocumentUrl(
  sessionId: string,
  documentId: string,
  filename: string
): string {
  return `/api/document/${encodeURIComponent(sessionId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
}
