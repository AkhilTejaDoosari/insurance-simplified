// Session read-through: the instance-local tmpdir session is a CACHE.
//
// Cloud Run instances are stateless; a request may land on an instance that
// never saw the upload, or after a restart. When the cache misses and durable
// persistence is configured, the session is rebuilt from its durable owners:
//   - sessions row      → context + capability hash (authorization already
//                          verified against it by requireSessionCapability)
//   - documents/pages   → page texts exactly as uploaded (citation substrate)
//   - object storage    → original PDF bytes; layout tables are recomputed
//                          from them (pure function of the bytes) and attached
//                          only if the recomputed page text equals the stored
//                          text byte for byte — otherwise no tables (fail
//                          closed: the line engine alone, no table claims).
//                          Per-page readability follows the same rule; when
//                          absent it is derived from the stored text, never
//                          over-claimed (EC-10)
//   - comparison_results→ evidence registry, so citation links keep resolving.
//                          Every restored quote is re-verified against the
//                          stored page text first; unverifiable entries are
//                          dropped, never registered (EC-1, EC-2).
//
// A cache hit is not authority on its own: when durable persistence is
// configured, the session row is looked up and a deleted/DELETING session is
// evicted from the cache and never served.
//
// Callers MUST have verified the session capability first.
import { deleteSession, getSession, registerEvidence, restoreSession, saveDocumentFile, type Session, type SessionDocument } from "@/app/lib/session";
import { getSessionDb, isSessionDbConfigured, loadSessionDocumentsDb, type SessionRow } from "@/app/lib/session-db";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { getDocumentBytes } from "@/app/lib/storage/objects";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { loadComparisonResult } from "@/app/lib/comparison-result-db";
import type { EvidenceCitation } from "@/app/lib/extraction/types";

function shortId(sessionId: string, durableId: string): string {
  const prefix = `${sessionId}--`;
  return durableId.startsWith(prefix) ? durableId.slice(prefix.length) : durableId;
}

function isLive(row: SessionRow | null): row is SessionRow {
  return !!row && !row.deleted_at && row.status !== "DELETING" && row.status !== "DELETED";
}

export async function loadSession(sessionId: string): Promise<Session | undefined> {
  const cached = getSession(sessionId);
  if (cached) {
    if (!isSessionDbConfigured()) return cached;
    // The durable row stays authoritative: a session deleted elsewhere (or
    // mid-deletion) must not keep being served from this instance's cache.
    if (isLive(await getSessionDb(sessionId))) return cached;
    deleteSession(sessionId);
    return undefined;
  }
  if (!isSessionDbConfigured()) return undefined;

  const row = await getSessionDb(sessionId);
  if (!isLive(row)) return undefined;
  const stored = await loadSessionDocumentsDb(sessionId);
  if (stored.length === 0) return undefined;

  const documents: SessionDocument[] = [];
  for (const doc of stored) {
    const documentId = shortId(sessionId, doc.durableId);
    const restored: SessionDocument = {
      documentId,
      filename: doc.filename,
      pageCount: doc.pages.length,
      pages: doc.pages,
      sha256: doc.sha256,
      ...(doc.objectKey ? { objectKey: doc.objectKey } : {}),
    };
    if (doc.objectKey) {
      try {
        const bytes = await getDocumentBytes(sessionId, doc.objectKey);
        if (bytes) {
          const re = await extractPages(bytes, doc.filename);
          const identical = re.pages.length === doc.pages.length && re.pages.every((p, i) => p === doc.pages[i]);
          if (identical) {
            restored.tables = re.tables;
            if (Array.isArray(re.readability)) restored.readability = re.readability;
          }
          saveDocumentFile(sessionId, documentId, bytes);
        }
      } catch {
        // Bytes unavailable or unreadable: page texts still serve citations;
        // no table claims are made for this document.
      }
    }
    documents.push(restored);
  }

  const context = Object.fromEntries(
    Object.entries(row.context_json ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const session = restoreSession(sessionId, documents, context, row.capability_hash, row.created_at);
  if (!session) return undefined;

  try {
    const result = await loadComparisonResult(sessionId);
    const rows = (result?.payload as { rows?: { values?: { evidence?: EvidenceCitation[] }[] }[] } | undefined)?.rows ?? [];
    const plans = (result?.payload as { plans?: { sources?: EvidenceCitation[] }[] } | undefined)?.plans ?? [];
    const evidence = [
      ...rows.flatMap((r) => (r.values ?? []).flatMap((v) => v.evidence ?? [])),
      ...plans.flatMap((p) => p.sources ?? []),
    ].filter((e) => e && verifyEvidenceCitation(documents, e).ok);
    if (evidence.length) registerEvidence(sessionId, evidence.map(({ documentId, page, quote }) => ({ documentId, page, quote })));
  } catch {
    // No persisted result yet: evidence is registered by the next extraction.
  }
  return getSession(sessionId);
}
