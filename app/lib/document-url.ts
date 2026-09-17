/** Citation viewer URL (app-owned page navigation).
 *
 *  Previously citations linked straight at the raw PDF with a `#page=`
 *  fragment and depended on the browser's PDF viewer to honour it. That
 *  hint is ignored wherever no compatible viewer handles the navigation
 *  (no-viewer browsers download the file instead, some mobile viewers
 *  ignore the fragment), so citations did not reliably open at the cited
 *  page. Citations now point at the in-app viewer (`/view/...?page=N`),
 *  which renders the cited page itself; the raw PDF stays available via
 *  {@link rawDocumentUrl}. The filename is the last path segment so the
 *  browser titles the tab with it. */
export function documentUrl(
  sessionId: string,
  documentId: string,
  filename: string,
  page?: number
): string {
  const base = `/view/${encodeURIComponent(sessionId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
  return page ? `${base}?page=${page}` : base;
}

/** Direct link to the uploaded PDF bytes (app/api/document). No page
 *  navigation is attempted here — page behaviour belongs to the viewer
 *  built by {@link documentUrl}. */
export function rawDocumentUrl(
  sessionId: string,
  documentId: string,
  filename: string
): string {
  return `/api/document/${encodeURIComponent(sessionId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
}
