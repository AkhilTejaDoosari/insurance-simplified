// P4 session database repository: durable session persistence behind a
// provider-neutral seam. Replaces tmpdir-based session store (app/lib/session.ts)
// for restart-safe, cross-request authoritative session state.
//
// LAZINESS: importing this module never touches the network or environment.
// Credentials resolve at call time; without SUPABASE_URL / SUPABASE_SECRET_KEY
// the async methods throw SessionDbUnconfiguredError (callers treat that as
// the honest-skip signal — tmpdir store remains the fallback).
//
// SCHEMA: expects db/migrations/0004_sessions.sql applied (sessions table with
// capability_hash, status, context_json, owner_user_id).

import { createHash } from "node:crypto";
import { generateCapability, hashCapability, verifyCapability } from "@/app/lib/session-capability";
import { requireScopeId } from "@/app/lib/rag/ownership";

export interface SessionRow {
  id: string;
  status: "DRAFT" | "PROCESSING" | "READY" | "PARTIAL" | "FAILED" | "DELETING" | "DELETED";
  context_json: Record<string, unknown>;
  capability_hash: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  owner_user_id: string | null;
}

export interface CreateSessionInput {
  context: Record<string, string>;
  capability?: string; // if omitted, generated
}

export interface UpdateSessionContextInput {
  context: Record<string, string>;
}

/** Thrown when database persistence is invoked without credentials. */
export class SessionDbUnconfiguredError extends Error {
  constructor() {
    super(
      "SessionDb: SUPABASE_URL and SUPABASE_SECRET_KEY are unset — skipping persistence",
    );
    this.name = "SessionDbUnconfiguredError";
  }
}

export interface SessionDbConfig {
  url: string;
  serviceKey: string;
}

function resolveSessionDbConfig(): SessionDbConfig | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

export function isSessionDbConfigured(): boolean {
  return resolveSessionDbConfig() !== null;
}

function restHeaders(config: SessionDbConfig): Record<string, string> {
  return {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
    "content-type": "application/json",
  };
}

async function restRequest(
  config: SessionDbConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${config.url}${path}`, {
    ...init,
    headers: { ...restHeaders(config), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    // In development, treat missing sessions table (404) as unconfigured
    // so local dev can fall back to tmpdir without running migrations.
    // In production, fail explicitly — missing table is a deployment error.
    if (
      res.status === 404 &&
      path.startsWith("/rest/v1/sessions") &&
      process.env.NODE_ENV !== "production"
    ) {
      throw new SessionDbUnconfiguredError();
    }
    throw new Error(
      `SessionDb ${init?.method ?? "GET"} ${path} failed with status ${res.status}`,
    );
  }
  return res;
}

/** Generate a new session ID (opaque, non-sequential). */
export function generateSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new session with a high-entropy capability and persist to DB. */
export async function createSessionDb(input: CreateSessionInput): Promise<{
  sessionId: string;
  capability: string;
  status: "DRAFT";
}> {
  const config = resolveSessionDbConfig();
  if (!config) throw new SessionDbUnconfiguredError();

  const sessionId = generateSessionId();
  const capability = input.capability ?? generateCapability();
  const capabilityHash = hashCapability(capability);
  const now = new Date().toISOString();

  await restRequest(config, "/rest/v1/sessions", {
    method: "POST",
    body: JSON.stringify([
      {
        id: sessionId,
        status: "DRAFT",
        context_json: input.context,
        capability_hash: capabilityHash,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        owner_user_id: null,
      },
    ]),
  });

  return { sessionId, capability, status: "DRAFT" };
}

/** Fetch a session by ID (requires valid capability verification by caller). */
export async function getSessionDb(sessionId: string): Promise<SessionRow | null> {
  const config = resolveSessionDbConfig();
  if (!config) throw new SessionDbUnconfiguredError();

  requireScopeId(sessionId, "SessionDb.getSessionDb");
  const res = await restRequest(
    config,
    `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=*`,
  );
  const rows = (await res.json()) as SessionRow[];
  return rows[0] ?? null;
}

/** Update session context (merges with existing context_json). */
export async function updateSessionContextDb(
  sessionId: string,
  input: UpdateSessionContextInput,
): Promise<void> {
  const config = resolveSessionDbConfig();
  if (!config) throw new SessionDbUnconfiguredError();

  requireScopeId(sessionId, "SessionDb.updateSessionContextDb");
  const now = new Date().toISOString();
  await restRequest(config, `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      context_json: input.context,
      updated_at: now,
    }),
  });
}

/** Update session status. */
export async function updateSessionStatusDb(
  sessionId: string,
  status: SessionRow["status"],
): Promise<void> {
  const config = resolveSessionDbConfig();
  if (!config) throw new SessionDbUnconfiguredError();

  requireScopeId(sessionId, "SessionDb.updateSessionStatusDb");
  const now = new Date().toISOString();
  await restRequest(config, `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      updated_at: now,
      ...(status === "DELETED" ? { deleted_at: now } : {}),
    }),
  });
}

/** Verify a presented capability against the stored hash for a session. */
export async function verifySessionCapability(
  sessionId: string,
  presentedCapability: string,
): Promise<boolean> {
  const config = resolveSessionDbConfig();
  if (!config) throw new SessionDbUnconfiguredError();

  requireScopeId(sessionId, "SessionDb.verifySessionCapability");
  const res = await restRequest(
    config,
    `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=capability_hash`,
  );
  const rows = (await res.json()) as { capability_hash: string }[];
  if (rows.length === 0) return false;
  return verifyCapability(presentedCapability, rows[0].capability_hash);
}

/** Delete a session (marks DELETED, retains capability_hash for idempotency). */
export async function deleteSessionDb(sessionId: string): Promise<boolean> {
  const config = resolveSessionDbConfig();
  if (!config) throw new SessionDbUnconfiguredError();

  requireScopeId(sessionId, "SessionDb.deleteSessionDb");
  const now = new Date().toISOString();
  await restRequest(config, `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "DELETED",
      deleted_at: now,
      updated_at: now,
    }),
  });
  return true;
}

/** Extract capability from request (cookie, Authorization: Bearer, x-session-capability). */
export { generateCapability, hashCapability, verifyCapability, extractCapability, SESSION_CAPABILITY_COOKIE, ConflictingCapabilityError } from "@/app/lib/session-capability";