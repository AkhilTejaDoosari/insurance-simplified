// Stable production error contract (P3-HIJ).
//
// Every production-facing failure responds:
//   { error: { code, message, retryable, requestId } }
// with an HTTP status matching the code. Public `message` strings are FIXED
// per code — raw exception text (which may carry API keys, SQL, stack traces,
// or document content) is logged server-side only and NEVER echoed to the
// client. Degraded successes (chat answer/refusal after LLM→semantic→lexical
// fallback) keep their existing 200 shapes untouched — only failures use this.
//
// Scope: chat / upload / extract routes + health DB probe logging. Other
// routes (citation, document, export) are out of scope and unchanged.

import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_INPUT"
  | "UNKNOWN_SESSION"
  | "UNPROCESSABLE_DOCUMENTS"
  | "PROVIDER_UNAVAILABLE"
  | "EXTRACTION_FAILED"
  | "CHAT_FAILED"
  | "VALIDATION_ERROR"
  | "SESSION_AUTH_REQUIRED"
  | "NOT_FOUND"
  | "STATE_CONFLICT"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}

/** Fixed public message per code — the ONLY client-visible failure text. */
export const PUBLIC_MESSAGES: Record<ApiErrorCode, string> = {
  BAD_INPUT: "Invalid request: sessionId and a non-empty question are required.",
  UNKNOWN_SESSION: "Unknown session.",
  VALIDATION_ERROR: "Invalid request data.",
  SESSION_AUTH_REQUIRED: "Session authentication required.",
  NOT_FOUND: "Resource not found.",
  STATE_CONFLICT: "Operation conflicted with current state.",
  DEPENDENCY_UNAVAILABLE: "Required dependency unavailable.",
  INTERNAL_ERROR: "Internal application error.",
  UNPROCESSABLE_DOCUMENTS: "One or more files could not be processed.",
  PROVIDER_UNAVAILABLE:
    'LLM provider unavailable. Set LLM_BASE_URL and LLM_API_KEY, or send engine: "fallback" to use the built-in extraction.',
  EXTRACTION_FAILED: "Extraction failed.",
  CHAT_FAILED: "Chat failed.",
};

/** Per-request id. crypto.randomUUID when available, unguessable fallback otherwise. */
export function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the Math.random fallback
  }
  return `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build the contract body. Prefer `errorResponse` at route level. */
export function error(
  code: ApiErrorCode,
  message: string,
  retryable: boolean,
  requestId: string,
): ApiErrorBody {
  return { error: { code, message, retryable, requestId } };
}

/** Maps legacy error codes to their canonical counterparts. */
export const legacyToCanonical: Partial<Record<ApiErrorCode, ApiErrorCode>> = {
  UNKNOWN_SESSION: "SESSION_AUTH_REQUIRED",
  BAD_INPUT: "VALIDATION_ERROR",
};

/** Convenience: fixed public message + JSON response with status. */
export function errorResponse(
  code: ApiErrorCode,
  status: number,
  opts: { retryable?: boolean; requestId?: string; message?: string } = {},
): NextResponse {
  const requestId = opts.requestId ?? newRequestId();
  return NextResponse.json(
    error(code, opts.message ?? PUBLIC_MESSAGES[code], opts.retryable ?? false, requestId),
    { status },
  );
}

/**
 * Sanitize a free-form detail (e.g. a per-file upload reason) before it may
 * reach a client. Takes ONLY the Error message (never `.stack`), strips
 * secret/token/key-shaped material, and truncates. Fixed validation strings
 * pass through unchanged; anything else degrades to `fallback`.
 */
export function safeDetail(raw: unknown, fallback = "Could not be read"): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : fallback;
  if (typeof text !== "string" || !text.trim()) return fallback;
  const redacted = text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-key]")
    .replace(/\bsk-[A-Za-z0-9-_]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9\-_]*\.[A-Za-z0-9\-_.]*/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, "api_key=[redacted]")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[redacted]");
  const clean = redacted.trim();
  if (!clean) return fallback;
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
}

/**
 * Server-side only failure log. Raw error text goes here (stderr) so the
 * client response can stay fixed-message. Never returns the raw text.
 */
export function logFailure(requestId: string, route: string, err: unknown): void {
  console.error(`[${route}] requestId=${requestId} failed:`, err);
}
