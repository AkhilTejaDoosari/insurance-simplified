// Anonymous session capability primitive (Phase 1).
// Server-generated high-entropy token, hash-only storage contract,
// constant-time verification, dual-transport extraction.
//
// Never log or otherwise emit capability values — only the SHA-256 hash
// (hashCapability output) is persisted (sessions.capability_hash) or logged.
// Pure (node:crypto only, zero dependencies): safe to import from routes,
// session-store (Wave 2), and session-auth (Wave 2).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie carrying the session capability (primary transport). */
export const SESSION_CAPABILITY_COOKIE = "sid_cap";

/** Thrown when two transports carry different capability values — fail closed (401). */
export class ConflictingCapabilityError extends Error {
  readonly statusCode = 401;
  readonly status = 401;
  constructor() {
    super("Conflicting session capability values across transports — request rejected");
    this.name = "ConflictingCapabilityError";
  }
}

/** Minimal request shape for capability extraction (cookie + headers). */
export interface CapabilityTransport {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined> | Headers;
}

/** 256-bit unguessable capability: 32 random bytes as 43-char base64url. */
export function generateCapability(): string {
  return randomBytes(32).toString("base64url");
}

/** Storage contract: deterministic SHA-256 hex digest (64 hex chars). */
export function hashCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

/** Timing-safe verification of a presented capability against a stored hash. Fail-closed. */
export function verifyCapability(presented: unknown, expectedHash: unknown): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  if (typeof expectedHash !== "string" || !HEX_64_PATTERN.test(expectedHash)) return false;
  const presentedHash = Buffer.from(hashCapability(presented), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  if (presentedHash.length !== expected.length) return false;
  return timingSafeEqual(presentedHash, expected);
}

function headerValue(headers: CapabilityTransport["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(name);
    return value === null ? undefined : value;
  }
  const record = headers as Record<string, string | undefined>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === name) return record[key];
  }
  return undefined;
}

/** Parse `Authorization: Bearer <token>`; malformed schemes are absent (fail-closed). */
function parseBearer(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^Bearer (.+)$/i.exec(value);
  if (!match) return undefined;
  const token = match[1].trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Extract the session capability: `sid_cap` cookie first, then
 * `Authorization: Bearer`, then `x-session-capability` header.
 * Returns null when absent. Throws ConflictingCapabilityError (401)
 * when two provided transports carry different values.
 */
export function extractCapability(request: CapabilityTransport): string | null {
  const cookie = request.cookies?.[SESSION_CAPABILITY_COOKIE]?.trim() || undefined;
  const bearer = parseBearer(headerValue(request.headers, "authorization")?.trim() || undefined);
  const fallback = headerValue(request.headers, "x-session-capability")?.trim() || undefined;

  const distinct = new Set([cookie, bearer, fallback].filter((v) => v !== undefined));
  if (distinct.size === 0) return null;
  if (distinct.size > 1) throw new ConflictingCapabilityError();
  return [...distinct][0] as string;
}
