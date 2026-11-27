// Session-bound opaque evidence identifiers.
// A citation URL carries `&evidence=<id>` instead of the quote itself so
// the viewer can resolve the exact cited passage server-side and validate
// it (same session, same document, same page) before highlighting.
//
// IDs are deterministic content hashes (`ev-` + sha256 prefix over
// documentId, page, and quote), so re-running extraction over unchanged
// documents yields the same IDs and the session registry stays idempotent.
// Pure (no fs): safe to import from both the extraction and RAG paths.

import { createHash } from "node:crypto";

export interface EvidenceRecord {
  documentId: string;
  page: number;
  quote: string;
}

export function evidenceIdFor(documentId: string, page: number, quote: string): string {
  return (
    "ev-" +
    createHash("sha256")
      .update(`${documentId}\n${page}\n${quote}`)
      .digest("hex")
      .slice(0, 16)
  );
}

/** Attach the deterministic session-bound evidence ID to a core citation.
 *  Used at the server/session boundary to enrich validated extraction and
 *  answer output for UI navigation — never inside the engines. */
export function withEvidenceId<T extends EvidenceRecord>(
  entry: T
): T & { evidenceId: string } {
  return {
    ...entry,
    evidenceId: evidenceIdFor(entry.documentId, entry.page, entry.quote),
  };
}
