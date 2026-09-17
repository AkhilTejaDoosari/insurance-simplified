// Citation viewer resolution (used by app/view/...?page=N).
// Pure logic, kept separate from the page component so it is unit-testable:
// turns a session lookup plus a raw `page` query value into either the
// exact page to render or an explicit failure.
//
// A citation must never silently point at a different page than requested:
// an out-of-range or unparseable citation page is an explicit invalid-page
// error, never a clamp. A missing page defaults to 1 only because the same
// viewer URL without `?page` doubles as a general document link.

import type { Session } from "@/app/lib/session";

export type CitationResolution =
  | {
      ok: true;
      filename: string;
      page: number;
      pageCount: number;
      text: string;
    }
  | { ok: false; error: "unknown-session" }
  | { ok: false; error: "unknown-document" }
  | { ok: false; error: "invalid-page"; pageCount: number };

export type PageRequest =
  | { kind: "missing" }
  | { kind: "valid"; page: number }
  | { kind: "invalid" };

/** Parse a raw `page` query value. Only positive integers are valid;
 *  anything else (including empty or non-numeric input) is invalid —
 *  never defaulted — so callers fail explicitly. */
export function parsePageRequest(
  pageParam: string | string[] | undefined | null
): PageRequest {
  if (pageParam === undefined || pageParam === null) return { kind: "missing" };
  const raw = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return { kind: "invalid" };
  const page = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(page) || page < 1) return { kind: "invalid" };
  return { kind: "valid", page };
}

/** Resolve which page of which document a citation link should show. */
export function resolveCitationPage(
  session: Session | undefined,
  documentId: string,
  pageParam: string | string[] | undefined
): CitationResolution {
  if (!session) return { ok: false, error: "unknown-session" };
  const doc = session.documents.find((d) => d.documentId === documentId);
  if (!doc) return { ok: false, error: "unknown-document" };
  const requested = parsePageRequest(pageParam);
  if (requested.kind === "invalid") {
    return { ok: false, error: "invalid-page", pageCount: doc.pageCount };
  }
  const page = requested.kind === "missing" ? 1 : requested.page;
  if (page > Math.max(doc.pageCount, 1)) {
    return { ok: false, error: "invalid-page", pageCount: doc.pageCount };
  }
  return {
    ok: true,
    filename: doc.filename,
    page,
    pageCount: doc.pageCount,
    text: doc.pages[page - 1] ?? "",
  };
}
