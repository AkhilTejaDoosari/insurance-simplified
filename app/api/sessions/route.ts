// Session creation endpoint: creates an anonymous comparison session with a
// high-entropy capability. The capability is returned via a Secure, HttpOnly,
// SameSite cookie (primary transport) and never in the response body.
//
// Request:
//   POST /api/sessions
//   { "context": { "age": "...", "countryOrResidency": "...", ... } }
//
// Response:
//   { "sessionId": "...", "status": "DRAFT" }
//
// The capability cookie (`sid_cap`) must be included on all subsequent
// protected requests. A caller-supplied sessionId without the corresponding
// capability is insufficient for authorization (401).

import { NextRequest, NextResponse } from "next/server";
import {
  createSessionDb,
  SessionDbUnconfiguredError,
  SESSION_CAPABILITY_COOKIE,
} from "@/app/lib/session-db";
import { errorResponse, newRequestId } from "@/app/lib/api-errors";

const CONTEXT_FIELDS = [
  "age",
  "countryOrResidency",
  "state",
  "city",
  "zip",
  "visaOrStatus",
  "coverageStart",
  "coverageEnd",
] as const;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const body = (await request.json().catch(() => null)) as {
    context?: Record<string, string>;
  } | null;

  if (!body) {
    return errorResponse("BAD_INPUT", 400, { requestId });
  }

  const context: Record<string, string> = {};
  for (const field of CONTEXT_FIELDS) {
    const value = body.context?.[field];
    if (typeof value === "string" && value.trim()) {
      context[field] = value.trim();
    }
  }

  let sessionId: string;
  let capability: string;

  try {
    const created = await createSessionDb({ context });
    sessionId = created.sessionId;
    capability = created.capability;
  } catch (err) {
    if (err instanceof SessionDbUnconfiguredError) {
      // Durable persistence not configured — this is a configuration error,
      // not a transient failure. The caller cannot proceed without durable sessions.
      return errorResponse("DEPENDENCY_UNAVAILABLE", 503, {
        requestId,
        retryable: false,
        message: "Durable session store is not configured",
      });
    }
    return errorResponse("INTERNAL_ERROR", 500, { requestId, retryable: true });
  }

  const response = NextResponse.json(
    { sessionId, status: "DRAFT" },
    { status: 201 },
  );

  // Set the capability cookie: Secure, HttpOnly, SameSite=Lax (default for cross-site safety)
  // Path=/ so it's sent with all requests to the application.
  // Max-Age: 30 days (session lifetime bound by explicit deletion, not cookie expiry).
  response.cookies.set(SESSION_CAPABILITY_COOKIE, capability, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}