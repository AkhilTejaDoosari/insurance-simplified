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
  };
  writeFileSync(pathFor(sessionId), JSON.stringify(session));
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  if (!isSafeId(sessionId)) return undefined;
  try {
    return JSON.parse(readFileSync(pathFor(sessionId), "utf8")) as Session;
  } catch {
    return undefined;
  }
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
