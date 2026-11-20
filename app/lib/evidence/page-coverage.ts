// Page-coverage records per document version (EC-10, EC-13).
//
// A record says, for one registered document version (sha256), which pages
// were read and which were unreadable. The exclusion inventory's "exclusion
// sections read" state may be derived only from these records plus sealed
// exclusion provisions — never declared by a caller.
//
// This module defines the type, its validation, and the adapter point. The
// readability reader itself (per-page text quality) is produced elsewhere at
// ingestion; until one is registered, a document simply has no coverage
// record, and consumers must treat its coverage as unknown (never complete).

export const PAGE_READ_STATUSES = ["read", "unreadable", "not_read"] as const;
/** read = text layer read and usable · unreadable = page present but its
 *  text could not be read (e.g. image-only) · not_read = not processed. */
export type PageReadStatus = (typeof PAGE_READ_STATUSES)[number];

export interface PageCoverageEntry {
  /** 1-based page number. */
  page: number;
  status: PageReadStatus;
  /** Short machine reason for unreadable/not_read (no page text). */
  reason?: string;
}

export interface PageCoverageRecord {
  sessionId: string;
  documentId: string;
  /** Document version this record describes; must equal the registered sha256. */
  documentSha256: string;
  pageCount: number;
  /** Exactly one entry per page 1..pageCount, in order. */
  pages: readonly PageCoverageEntry[];
  /** Identifier of the producer (e.g. "ingestion.text-layer@1"). */
  producer: string;
}

/** Adapter point: the ingestion readability reader implements this. The
 *  registry calls it at registration with the registered identity and stored
 *  pages; returning `undefined` means "no coverage known". */
export interface PageCoverageSource {
  coverageFor(input: {
    sessionId: string;
    documentId: string;
    documentSha256: string;
    pageCount: number;
    pages: readonly string[];
  }): PageCoverageRecord | undefined;
}

export type CoverageCheck = { ok: true } | { ok: false; reason: string };

/** Validate a record against the registered document. Fail closed: a page
 *  can be "read" only if its stored text is non-empty. */
export function checkCoverageRecord(
  record: PageCoverageRecord,
  doc: { sessionId: string; documentId: string; sha256: string; pageCount: number; pages: readonly string[] },
): CoverageCheck {
  if (!record || typeof record !== "object") return { ok: false, reason: "malformed" };
  if (record.sessionId !== doc.sessionId) return { ok: false, reason: "session mismatch" };
  if (record.documentId !== doc.documentId) return { ok: false, reason: "document mismatch" };
  if (record.documentSha256 !== doc.sha256) return { ok: false, reason: "document version mismatch" };
  if (record.pageCount !== doc.pageCount) return { ok: false, reason: "page count mismatch" };
  if (typeof record.producer !== "string" || !record.producer.trim()) return { ok: false, reason: "producer required" };
  if (!Array.isArray(record.pages) || record.pages.length !== doc.pageCount) return { ok: false, reason: "entries must cover every page" };
  for (const [i, entry] of record.pages.entries()) {
    if (!entry || entry.page !== i + 1) return { ok: false, reason: "entries must be pages 1..n in order" };
    if (!(PAGE_READ_STATUSES as readonly string[]).includes(entry.status)) return { ok: false, reason: "invalid status" };
    if (entry.status === "read" && !(doc.pages[i] ?? "").trim()) return { ok: false, reason: `page ${i + 1} has no stored text` };
  }
  return { ok: true };
}

/** Pages a consumer may treat as read. Unknown coverage reads as none. */
export function readPages(record: PageCoverageRecord | undefined): number[] {
  return record ? record.pages.filter((p) => p.status === "read").map((p) => p.page) : [];
}

/** True only when every page of the document version was read. */
export function allPagesRead(record: PageCoverageRecord | undefined): boolean {
  return !!record && record.pages.length > 0 && record.pages.every((p) => p.status === "read");
}
