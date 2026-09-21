// Session authorization guard: extracts and verifies the anonymous session
// capability before allowing access to protected session-owned resources.
//
// Every protected route must call `requireSessionCapability(request, sessionId)`
// which:
//   1. Extracts the capability from cookie / Authorization: Bearer / x-session-capability
//   2. Verifies it against the stored hash (DB first, tmpdir fallback)
//   3. Returns the verified sessionId on success
//   4. Returns a 401 error response on failure (missing, invalid, or conflicting)
//
// This ensures:
//   - Session ID alone is NEVER sufficient authorization
//   - Capability is high-entropy and verified server-side
//   - Cross-session access is impossible without the capability
//   - Capability never enters logs (only hash is stored/logged)

import { NextRequest, NextResponse } from "next/server";
import {
  extractCapability,
  verifySessionCapability,
  ConflictingCapabilityError,
  SESSION_CAPABILITY_COOKIE,
  SessionDbUnconfiguredError,
} from "@/app/lib/session-db";
import { verifySessionCapabilityTmpdir } from "@/app/lib/session";
import { errorResponse, newRequestId } from "@/app/lib/api-errors";

export interface AuthenticatedSession {
  sessionId: string;
  capability: string;
}

/** Result of capability verification. */
export interface CapabilityVerificationResult {
  ok: boolean;
  sessionId?: string;
  errorResponse?: NextResponse;
}

/**
 * Extract and verify the session capability for a given sessionId.
 * Returns the verified sessionId on success, or a 401 error response on failure.
 */
export async function requireSessionCapability(
  request: NextRequest,
  sessionId: string,
): Promise<CapabilityVerificationResult> {
  const requestId = newRequestId();

  // 1. Extract capability from request transports
  let capability: string;
  try {
    const extracted = extractCapability({
      cookies: Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value])),
      headers: request.headers,
    });
    if (extracted === null) {
      return {
        ok: false,
        errorResponse: errorResponse("SESSION_AUTH_REQUIRED", 401, {
          requestId,
          message: "Session capability missing — authenticate via /api/sessions first",
        }),
      };
    }
    capability = extracted;
  } catch (err) {
    if (err instanceof ConflictingCapabilityError) {
      return {
        ok: false,
        errorResponse: errorResponse("SESSION_AUTH_REQUIRED", 401, {
          requestId,
          message: "Conflicting session capability values — request rejected",
        }),
      };
    }
    return {
      ok: false,
      errorResponse: errorResponse("SESSION_AUTH_REQUIRED", 401, { requestId }),
    };
  }

  // 2. Verify capability against stored hash (DB first, tmpdir fallback)
  let verified: boolean;
  try {
    verified = await verifySessionCapability(sessionId, capability);
  } catch (err) {
    if (err instanceof SessionDbUnconfiguredError) {
      // Fallback to tmpdir store for tests and local dev without DB
      verified = verifySessionCapabilityTmpdir(sessionId, capability);
    } else {
      return {
        ok: false,
        errorResponse: errorResponse("INTERNAL_ERROR", 500, { requestId, retryable: true }),
      };
    }
  }

  if (!verified) {
    return {
      ok: false,
      errorResponse: errorResponse("SESSION_AUTH_REQUIRED", 401, {
        requestId,
        message: "Invalid session capability",
      }),
    };
  }

  return { ok: true, sessionId };
}

/**
 * Extract the sessionId from request params and verify capability.
 * Convenience wrapper for route handlers with dynamic params.
 */
export async function requireSessionFromParams(
  request: NextRequest,
  params: Promise<{ sessionId: string }>,
): Promise<CapabilityVerificationResult> {
  const { sessionId } = await params;
  return requireSessionCapability(request, sessionId);
}

/**
 * Check if the request has a valid capability cookie (without full DB verification).
 * Used for lightweight checks where the sessionId isn't known yet.
 * Note: This does NOT verify the capability against the DB — only checks presence.
 */
export function hasCapabilityCookie(request: NextRequest): boolean {
  const cookie = request.cookies.get(SESSION_CAPABILITY_COOKIE)?.value?.trim();
  return Boolean(cookie && cookie.length > 0);
}

/**
 * Get the capability from request without verification (for internal use only).
 * Returns null if absent or conflicting.
 */
export function getCapabilityFromRequest(request: NextRequest): string | null {
  try {
    return extractCapability({
      cookies: Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value])),
      headers: request.headers,
    });
  } catch {
    return null;
  }
}