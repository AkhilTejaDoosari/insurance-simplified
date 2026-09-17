// Session store (clarify session 2026-09-16, FR-019).
// Sessions live in a server-local temporary directory and are deleted on
// close. The only save mechanism is the downloadable export file
// (app/api/export/route.ts). File-backed (not module-memory) so session
// state is shared across routes in dev, production, and multi-worker
// servers; the retention guarantee is unchanged: delete on close, export
// or nothing.

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
  userContext: Record<string, string> = {}
): Session {
  const sessionId = `sess-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const session: Session = {
    sessionId,
    createdAt: new Date().toISOString(),
    documents,
    userContext,
    evidence: {},
  };
  writeFileSync(pathFor(sessionId), JSON.stringify(session));
  return session;
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

export function sessionCount(): number {
  try {
    return readdirSync(sessionsDir()).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
