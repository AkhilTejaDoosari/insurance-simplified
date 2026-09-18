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
import type { EvidenceRecord } from "@/app/lib/evidence-ids";

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

/** Resolve which page of which document a citation link should show. */export function resolveCitationPage(
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

export interface LocatedPassage {
  before: string;
  match: string;
  after: string;
}

/** Collapse every whitespace run to one space, remembering for each
 *  normalized char the original offset it came from. */
function normalizeSpace(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      if (!inSpace) {
        text += " ";
        map.push(i);
        inSpace = true;
      }
    } else {
      text += s[i];
      map.push(i);
      inSpace = false;
    }
  }
  return { text, map };
}

/** Locate the exact cited passage inside its page text for highlighting.
 *  Compares the quote's word sequence against whitespace-normalized page
 *  text with plain substring search (linear — no regex backtracking on
 *  large pages), then maps the hit back to original offsets. Returns the
 *  split only when there is EXACTLY one match — zero or several matches
 *  mean the passage cannot be identified safely, so the caller must fall
 *  back to showing the quote unhighlighted rather than risk marking the
 *  wrong passage.
 *
 *  @deprecated Hard-deprecated out of the viewer path. The canonical
 *  highlight matcher is `matchEvidencePassage` in
 *  `app/lib/pdf/text-match.ts` (used by PdfEvidenceViewer); this helper
 *  must not be imported from `app/components` or `app/view`. It remains
 *  exported for explicit non-viewer uses only (parity tests), so the two
 *  uniqueness rules cannot silently diverge again. */
export function locatePassage(pageText: string, quote: string): LocatedPassage | null {
  const normalizedQuote = quote.split(/\s+/).filter(Boolean).join(" ");
  if (!normalizedQuote || !pageText) return null;
  const { text: normalizedPage, map } = normalizeSpace(pageText);
  const first = normalizedPage.indexOf(normalizedQuote);
  if (first === -1) return null;
  if (normalizedPage.indexOf(normalizedQuote, first + 1) !== -1) return null;
  const start = map[first];
  const end = map[first + normalizedQuote.length - 1] + 1;
  return {
    before: pageText.slice(0, start),
    match: pageText.slice(start, end),
    after: pageText.slice(end),
  };
}

/** Validate a registry-resolved evidence record against the citation URL
 *  before highlighting anything: the record must name the same document
 *  and page the URL points at. A mismatch (or unknown ID) must fail
 *  explicitly — never highlight a passage the citation did not cite. */
export function isMatchingEvidence(
  record: EvidenceRecord | undefined,
  documentId: string,
  page: number
): record is EvidenceRecord {
  return (
    record !== undefined &&
    record.documentId === documentId &&
    record.page === page
  );
}
