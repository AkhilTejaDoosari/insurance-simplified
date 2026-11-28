// The engine worker's credential for the internal job API: the shared service token the
// web app already sends to the engine (ENGINE_SERVICE_TOKEN), here in the other direction.
// Compared in constant time; never logged. A caller-supplied worker name is never
// authorization on its own: every job call also checks that this worker holds the lease.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { errorResponse } from "@/app/lib/api-errors";

export function serviceTokenError(request: NextRequest) {
  const expected = process.env.ENGINE_SERVICE_TOKEN ?? "";
  if (!expected) return errorResponse("DEPENDENCY_UNAVAILABLE", 503, { message: "Job API not configured." });
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return errorResponse("SESSION_AUTH_REQUIRED", 401, { message: "Service token required." });
  return null;
}

/** A worker name: short, printable, no spaces (it is only compared, never trusted). */
export const WORKER = /^[A-Za-z0-9._:-]{1,80}$/;
