/** Link to an uploaded PDF served by app/api/document, optionally opened at a
 *  1-based page via the browser PDF viewer's `#page=` fragment. The filename
 *  is the last path segment so the browser titles the tab with it. */
export function documentUrl(
  sessionId: string,
  documentId: string,
  filename: string,
  page?: number
): string {
  const base = `/api/document/${encodeURIComponent(sessionId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
  return page ? `${base}#page=${page}` : base;
}
