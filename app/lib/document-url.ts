/** Link to an uploaded PDF served by app/api/document, optionally opened at a
 *  1-based page via the browser PDF viewer's `#page=` fragment. */
export function documentUrl(sessionId: string, documentId: string, page?: number): string {
  const base = `/api/document?sessionId=${encodeURIComponent(sessionId)}&documentId=${encodeURIComponent(documentId)}`;
  return page ? `${base}#page=${page}` : base;
}
