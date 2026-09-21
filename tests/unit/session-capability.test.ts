import { describe, expect, it, vi } from "vitest";
import {
  ConflictingCapabilityError,
  SESSION_CAPABILITY_COOKIE,
  extractCapability,
  generateCapability,
  hashCapability,
  verifyCapability,
  type CapabilityTransport,
} from "@/app/lib/session-capability";

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function transport(
  cookies: Record<string, string | undefined> = {},
  headers: Record<string, string | undefined> = {},
): CapabilityTransport {
  return { cookies, headers };
}

describe("generateCapability", () => {
  it("returns a 43-char base64url token (32 random bytes, 256-bit)", () => {
    const cap = generateCapability();
    expect(cap).toMatch(BASE64URL_43);
    expect(Buffer.from(cap, "base64url")).toHaveLength(32);
  });

  it("generates a fresh unguessable value on every call", () => {
    expect(generateCapability()).not.toBe(generateCapability());
  });

  it("never emits the capability value to logs", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const cap = generateCapability();
      const hash = hashCapability(cap);
      for (const call of [...logSpy.mock.calls, ...errSpy.mock.calls]) {
        for (const arg of call) {
          if (typeof arg === "string") {
            expect(arg).not.toContain(cap);
            expect(arg).not.toContain(hash);
          }
        }
      }
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

describe("hashCapability", () => {
  it("is a deterministic SHA-256 hex digest that differs from the input", () => {
    const cap = generateCapability();
    const first = hashCapability(cap);
    expect(first).toMatch(HEX_64);
    expect(first).toBe(hashCapability(cap));
    expect(first).not.toBe(cap);
    expect(first).not.toContain(cap.slice(0, 8));
  });

  it("changes when the input changes", () => {
    expect(hashCapability(generateCapability())).not.toBe(hashCapability(generateCapability()));
  });
});

describe("verifyCapability", () => {
  it("accepts the presented capability against its stored hash", () => {
    const cap = generateCapability();
    expect(verifyCapability(cap, hashCapability(cap))).toBe(true);
  });

  it("rejects a wrong capability (timing-safe compare, no throw)", () => {
    const cap = generateCapability();
    const stored = hashCapability(cap);
    expect(verifyCapability(generateCapability(), stored)).toBe(false);
    expect(verifyCapability(cap.slice(0, -1) + (cap.endsWith("A") ? "B" : "A"), stored)).toBe(false);
  });

  it.each([
    ["empty presented", "", hashCapability(generateCapability())],
    ["non-string presented", 42, hashCapability(generateCapability())],
    ["undefined presented", undefined, hashCapability(generateCapability())],
    ["malformed stored hash", generateCapability(), "not-a-hash"],
    ["empty stored hash", generateCapability(), ""],
    ["non-string stored hash", generateCapability(), 42],
    ["both malformed", "!!!", "!!!"],
  ])("fail-closed without throwing (%s)", (_label, presented, stored) => {
    expect(verifyCapability(presented, stored)).toBe(false);
  });
});

describe("extractCapability", () => {
  it("uses the exact sid_cap cookie name", () => {
    expect(SESSION_CAPABILITY_COOKIE).toBe("sid_cap");
  });

  it("reads the capability from the sid_cap cookie first", () => {
    const cap = generateCapability();
    expect(extractCapability(transport({ sid_cap: cap }, {}))).toBe(cap);
  });

  it("falls back to Authorization: Bearer when no cookie is present", () => {
    const cap = generateCapability();
    expect(extractCapability(transport({}, { authorization: `Bearer ${cap}` }))).toBe(cap);
  });

  it("falls back to the x-session-capability header when nothing else is present", () => {
    const cap = generateCapability();
    expect(extractCapability(transport({}, { "x-session-capability": cap }))).toBe(cap);
  });

  it("prefers the cookie when transports agree on the same value", () => {
    const cap = generateCapability();
    expect(
      extractCapability(
        transport({ sid_cap: cap }, { authorization: `Bearer ${cap}` }),
      ),
    ).toBe(cap);
  });

  it("returns null when no capability is provided", () => {
    expect(extractCapability(transport({}, {}))).toBeNull();
    expect(extractCapability(transport({}, { authorization: "" }))).toBeNull();
  });

  it("rejects malformed Bearer schemes fail-closed (treated as absent)", () => {
    // No cookie, malformed auth only -> absent, never accepted as a value.
    expect(extractCapability(transport({}, { authorization: "Bearer" }))).toBeNull();
    expect(extractCapability(transport({}, { authorization: "Token abc123" }))).toBeNull();
    expect(extractCapability(transport({}, { authorization: "Bearer " }))).toBeNull();
    // Malformed auth alongside a valid cookie -> cookie wins, no conflict.
    const cap = generateCapability();
    expect(
      extractCapability(transport({ sid_cap: cap }, { authorization: "Bearer" })),
    ).toBe(cap);
  });

  it("fail-closed (401) on two conflicting provided values", () => {
    const cookieCap = generateCapability();
    const bearerCap = generateCapability();
    expect(cookieCap).not.toBe(bearerCap);

    const attempt = () =>
      extractCapability(
        transport({ sid_cap: cookieCap }, { authorization: `Bearer ${bearerCap}` }),
      );
    expect(attempt).toThrow(ConflictingCapabilityError);
    try {
      attempt();
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictingCapabilityError);
      expect(
        (err as ConflictingCapabilityError).statusCode === 401 ||
          (err as { status?: number }).status === 401,
      ).toBe(true);
    }

    expect(() =>
      extractCapability(
        transport(
          { sid_cap: cookieCap },
          { "x-session-capability": generateCapability() },
        ),
      ),
    ).toThrow(ConflictingCapabilityError);

    expect(() =>
      extractCapability(
        transport(
          {},
          {
            authorization: `Bearer ${cookieCap}`,
            "x-session-capability": bearerCap,
          },
        ),
      ),
    ).toThrow(ConflictingCapabilityError);
  });
});
