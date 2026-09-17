/** Citation viewer URL (app-owned page navigation).
 *
 *  Previously citations linked straight at the raw PDF with a `#page=`
 *  fragment and depended on the browser's PDF viewer to honour it. That
 *  hint is ignored wherever no compatible viewer handles the navigation
 *  (no-viewer browsers download the file instead, some mobile viewers
 *  ignore the fragment), so citations did not reliably open at the cited
 *  page. Citations now point at the in-app viewer (`/view/...?page=N`),
 *  which embeds the actual cited source page (see {@link sourcePageUrl});
 *  the full original PDF stays available via {@link rawDocumentUrl}. The
 *  filename is the last path segment so the browser titles the tab with it. */
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

/** Direct link to the uploaded PDF bytes (app/api/document). No page
 *  navigation is attempted here — page behaviour belongs to the viewer
 *  built by {@link documentUrl} and the source-page PDF built by
 *  {@link sourcePageUrl}. */
export function rawDocumentUrl(
  sessionId: string,
  documentId: string,
  filename: string
): string {
  return `/api/document/${encodeURIComponent(sessionId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
}

/** Link to the ACTUAL cited source page: the document endpoint renders
 *  only page N of the original uploaded PDF as a one-page PDF. This is
 *  what the citation viewer embeds, so the visible citation source is the
 *  original page content — not extracted text, and with no reliance on the
 *  browser PDF viewer's `#page=` fragment. */
export function sourcePageUrl(
  sessionId: string,
  documentId: string,
  filename: string,
  page: number
): string {
  return `${rawDocumentUrl(sessionId, documentId, filename)}?page=${page}`;
}
