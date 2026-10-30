// Session store (clarify session 2026-09-16, FR-019).
// Sessions live in a server-local temporary directory and are deleted on
// close. The only save mechanism is the downloadable export file
// (app/api/export/route.ts). File-backed (not module-memory) so session
// state is shared across routes in dev, production, and multi-worker
// servers; the retention guarantee is unchanged: delete on close, export
// or nothing.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceIdFor, type EvidenceRecord } from "@/app/lib/evidence-ids";

export interface SessionDocument {
  documentId: string;
  filename: string;
  pageCount: number;
  /** Extracted text, one entry per page (1-based index = position + 1). */
  pages: string[];
  /** P3-A durable-object metadata (nullable: unknown stays unknown for
   *  pre-P3-A sessions). sha256 = hex of the ORIGINAL bytes; objectKey =
   *  stable session/document-scoped content-addressed key (objects.ts sessionObjectKeyFor).
   *  Legacy documents may retain the earlier global content-addressed key. DB row stays
   *  authoritative when persistence is configured. */
  sha256?: string;
  objectKey?: string;
}

export interface Session {
  sessionId: string;
  createdAt: string;
  documents: SessionDocument[];
  userContext: Record<string, string>;
  /** Session-bound evidence registry: opaque evidence ID → cited passage.
   *  Populated by the extract/chat routes so citation URLs can resolve an
   *  `&evidence=` ID back to its exact quote without trusting the URL. */
  evidence: Record<string, EvidenceRecord>;
  /** SHA-256 hash of the session capability (for authorization). */
  capabilityHash?: string;
}

function sessionsDir(): string {
  const dir = join(tmpdir(), "insurance-simplified-sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pathFor(sessionId: string): string {
  return join(sessionsDir(), `${sessionId}.json`);
}

/** Directory holding a session's raw uploaded PDFs (served back for page links). */
function filesDirFor(sessionId: string): string {
  return join(sessionsDir(), sessionId);
}

function isSafeId(sessionId: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(sessionId);
}

/** Generate a high-entropy session capability (256-bit, base64url). */
export function generateCapability(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a capability for storage (SHA-256 hex). */
export function hashCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

/** Verify a presented capability against a stored hash (timing-safe). */
export function verifyCapability(presented: string, expectedHash: string): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const presentedHash = Buffer.from(hashCapability(presented), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  if (presentedHash.length !== expected.length) return false;
  return timingSafeEqual(presentedHash, expected);
}

/** Cookie name for session capability. */
export const SESSION_CAPABILITY_COOKIE = "sid_cap";

/** Keep the original PDF bytes so citations can open the source at a page. */
export function saveDocumentFile(
  sessionId: string,
  documentId: string,
  bytes: Uint8Array
): void {
  if (!isSafeId(sessionId) || !isSafeId(documentId)) return;
  mkdirSync(filesDirFor(sessionId), { recursive: true });
  writeFileSync(join(filesDirFor(sessionId), `${documentId}.pdf`), bytes);
}

export function readDocumentFile(
  sessionId: string,
  documentId: string
): Buffer | undefined {
  if (!isSafeId(sessionId) || !isSafeId(documentId)) return undefined;
  try {
    return readFileSync(join(filesDirFor(sessionId), `${documentId}.pdf`));
  } catch {
    return undefined;
  }
}

export function createSession(
  documents: SessionDocument[],
  userContext: Record<string, string> = {},
  capability?: string,
  sessionId?: string
): { session: Session; capability: string; capabilityHash: string } {
  const sid = sessionId ?? `sess-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const cap = capability ?? generateCapability();
  const capabilityHash = hashCapability(cap);
  const session: Session = {
    sessionId: sid,
    createdAt: new Date().toISOString(),
    documents,
    userContext,
    evidence: {},
    capabilityHash,
  };
  writeFileSync(pathFor(sid), JSON.stringify(session));
  return { session, capability: cap, capabilityHash };
}

export function getSession(sessionId: string): Session | undefined {
  if (!isSafeId(sessionId)) return undefined;
  try {
    const session = JSON.parse(readFileSync(pathFor(sessionId), "utf8")) as Session;
    if (!session.evidence || typeof session.evidence !== "object") {
      session.evidence = {};
    }
    return session;
  } catch {
    return undefined;
  }
}

export function updateSessionContext(
  sessionId: string,
  patch: Record<string, string>,
): Session | undefined {
  if (!isSafeId(sessionId)) return undefined;
  const session = getSession(sessionId);
  if (!session) return undefined;
  session.userContext = { ...session.userContext, ...patch };
  writeFileSync(pathFor(sessionId), JSON.stringify(session));
  return session;
}

/** Register cited passages in the session-bound evidence registry.
 *  IDs are deterministic content hashes, so re-registering the same
 *  passage is idempotent. */
export function registerEvidence(
  sessionId: string,
  entries: EvidenceRecord[]
): void {
  if (!isSafeId(sessionId)) return;
  const session = getSession(sessionId);
  if (!session) return;
  for (const entry of entries) {
    session.evidence[evidenceIdFor(entry.documentId, entry.page, entry.quote)] = entry;
  }
  writeFileSync(pathFor(sessionId), JSON.stringify(session));
}

/** Resolve an opaque evidence ID back to its cited passage, or undefined
 *  when the ID was never registered in this session. */
export function getEvidenceRecord(
  sessionId: string,
  evidenceId: string
): EvidenceRecord | undefined {
  if (!isSafeId(sessionId) || !/^ev-[0-9a-f]{16}$/.test(evidenceId)) return undefined;
  return getSession(sessionId)?.evidence[evidenceId];
}

/** P3-A: record durable-object metadata for one document (additive: leaves
 *  all other session fields untouched). No-op when the session/document is
 *  unknown. Returns true when the metadata was recorded. */
export function attachDocumentObjectMetadata(
  sessionId: string,
  documentId: string,
  metadata: { sha256: string; objectKey: string }
): boolean {
  if (!isSafeId(sessionId) || !isSafeId(documentId)) return false;
  const session = getSession(sessionId);
  if (!session) return false;
  const doc = session.documents.find((d) => d.documentId === documentId);
  if (!doc) return false;
  doc.sha256 = metadata.sha256;
  doc.objectKey = metadata.objectKey;
  writeFileSync(pathFor(sessionId), JSON.stringify(session));
  return true;
}

/** Delete a session and all its documents/extracted data. */
export function deleteSession(sessionId: string): boolean {
  if (!isSafeId(sessionId)) return false;
  try {
    rmSync(pathFor(sessionId));
  } catch {
    return false;
  }
  rmSync(filesDirFor(sessionId), { recursive: true, force: true });
  return true;
}

/** Verify a presented capability against the stored hash in the tmpdir session. */
export function verifySessionCapabilityTmpdir(
  sessionId: string,
  presentedCapability: string
): boolean {
  if (!isSafeId(sessionId)) return false;
  const session = getSession(sessionId);
  if (!session?.capabilityHash) return false;
  return verifyCapability(presentedCapability, session.capabilityHash);
}

export function sessionCount(): number {
  try {
    return readdirSync(sessionsDir()).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Delete ONE document from a session and all its derived copies.
 *
 * Removes: the document entry in the session JSON (metadata + page text),
 * the raw PDF bytes file (<sessionsDir>/<sessionId>/<documentId>.pdf),
 * and evidence-registry entries citing that document. The session-level
 * chunk cache is invalidated because the cache key is content-derived and
 * would otherwise be rewritten on next access with stale membership.
 *
 * Callers holding vectors for this document must also drop them:
 * InMemoryCosineIndex has no per-document removal (call clear() + re-add
 * survivors, or rebuild via chunksForSession), and PostgresVectorStore
 * has deleteDocument(documentId). Returns false when the session or the
 * document is unknown, or when either id is unsafe.
 */
export function deleteSessionDocument(sessionId: string, documentId: string): boolean {
  if (!isSafeId(sessionId) || !isSafeId(documentId)) return false;
  const session = getSession(sessionId);
  if (!session) return false;
  if (!session.documents.some((d) => d.documentId === documentId)) return false;
  session.documents = session.documents.filter((d) => d.documentId !== documentId);
  for (const [id, entry] of Object.entries(session.evidence)) {
    if (entry.documentId === documentId) delete session.evidence[id];
  }
  writeFileSync(pathFor(sessionId), JSON.stringify(session));
  try {
    rmSync(join(filesDirFor(sessionId), `${documentId}.pdf`), { force: true });
  } catch {
    void 0;
  }
  // Invalidate the derived chunk cache (chunks.ts): key changes with
  // membership, but delete the file so no stale copy survives on disk.
  try {
    rmSync(join(tmpdir(), "insurance-simplified-chunks", `${sessionId}.json`), {
      force: true,
    });
  } catch {
    void 0;
  }
  return true;
}
