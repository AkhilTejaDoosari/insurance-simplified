// Citation viewer resolution (used by app/view/...?page=N).
// Pure logic, kept separate from the page component so it is unit-testable:
// turns a session lookup plus a raw `page` query value into either the
// exact page to render or an explicit failure (unknown session vs. unknown
// document), never a silent wrong page.

import type { Session } from "@/app/lib/session";

export type CitationResolution =
  | {
      ok: true;
      filename: string;
      page: number;
      pageCount: number;
      text: string;
    }
  | { ok: false; error: "unknown-session" | "unknown-document" };

/** Resolve which page of which document a citation link should show.
 *  Missing/unparseable `page` defaults to 1; out-of-range pages clamp to
 *  the nearest valid page so the viewer always states exactly where it is. */
export function resolveCitationPage(
  session: Session | undefined,
  documentId: string,
  pageParam: string | string[] | undefined
): CitationResolution {
  if (!session) return { ok: false, error: "unknown-session" };
  const doc = session.documents.find((d) => d.documentId === documentId);
  if (!doc) return { ok: false, error: "unknown-document" };
  const raw = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  const page = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), Math.max(doc.pageCount, 1))
    : 1;
  return {
    ok: true,
    filename: doc.filename,
    page,
    pageCount: doc.pageCount,
    text: doc.pages[page - 1] ?? "",
  };
}
