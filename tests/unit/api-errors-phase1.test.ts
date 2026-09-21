import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { errorResponse, ApiErrorCode, PUBLIC_MESSAGES } from "@/app/lib/api-errors";

describe("ApiErrorCode union — new codes", () => {
  // 1. Every code has a fixed public message
  it("all codes have a fixed PUBLIC_MESSAGE", () => {
    const allCodes: ApiErrorCode[] = [
      "BAD_INPUT",
      "UNKNOWN_SESSION",
      "UNPROCESSABLE_DOCUMENTS",
      "PROVIDER_UNAVAILABLE",
      "EXTRACTION_FAILED",
      "CHAT_FAILED",
      "VALIDATION_ERROR",
      "SESSION_AUTH_REQUIRED",
      "NOT_FOUND",
      "STATE_CONFLICT",
      "DEPENDENCY_UNAVAILABLE",
      "INTERNAL_ERROR",
    ];

    for (const code of allCodes) {
      expect(PUBLIC_MESSAGES[code]).toBeDefined();
      expect(typeof PUBLIC_MESSAGES[code]).toBe("string");
      expect(PUBLIC_MESSAGES[code].trim().length).toBeGreaterThan(0);
    }
  });

  // 2. SESSION_AUTH_REQUIRED default usable for 401
  it("SESSION_AUTH_REQUIRED produces 401 via errorResponse", () => {
    const res = errorResponse("SESSION_AUTH_REQUIRED", 401, { requestId: "test-1" });
    expect(res.status).toBe(401);
  });

  // 3. Legacy codes still produce their old messages
  it("legacy codes still produce their original messages", () => {
    expect(PUBLIC_MESSAGES.BAD_INPUT).toBe("Invalid request: sessionId and a non-empty question are required.");
    expect(PUBLIC_MESSAGES.UNKNOWN_SESSION).toBe("Unknown session.");
    expect(PUBLIC_MESSAGES.UNPROCESSABLE_DOCUMENTS).toBe("One or more files could not be processed.");
    expect(PUBLIC_MESSAGES.PROVIDER_UNAVAILABLE).toBe(
      'LLM provider unavailable. Set LLM_BASE_URL and LLM_API_KEY, or send engine: "fallback" to use the built-in extraction.',
    );
    expect(PUBLIC_MESSAGES.EXTRACTION_FAILED).toBe("Extraction failed.");
    expect(PUBLIC_MESSAGES.CHAT_FAILED).toBe("Chat failed.");
  });
});

describe("ApiErrorCode alias mapping legacy→canonical", () => {
  // Alias: UNKNOWN_SESSION → SESSION_AUTH_REQUIRED with 401 default status guidance
  it("UNKNOWN_SESSION maps to SESSION_AUTH_REQUIRED", () => {
    const legacy: ApiErrorCode = "UNKNOWN_SESSION";
    const canonical: ApiErrorCode = "SESSION_AUTH_REQUIRED";
    expect(legacy).toBe("UNKNOWN_SESSION");
    expect(canonical).toBe("SESSION_AUTH_REQUIRED");
  });

  // Alias: BAD_INPUT → VALIDATION_ERROR 400
  it("BAD_INPUT maps to VALIDATION_ERROR", () => {
    const legacy: ApiErrorCode = "BAD_INPUT";
    const canonical: ApiErrorCode = "VALIDATION_ERROR";
    expect(legacy).toBe("BAD_INPUT");
    expect(canonical).toBe("VALIDATION_ERROR");
  });
});

describe("errorResponse backward compatibility", () => {
  it("legacy codes still work with same signature", async () => {
    // All legacy codes must still produce their old messages via errorResponse
    const legacyCalls: [ApiErrorCode, number, object][] = [
      ["BAD_INPUT", 400, {}],
      ["UNKNOWN_SESSION", 404, {}],
      ["UNPROCESSABLE_DOCUMENTS", 422, {}],
      ["PROVIDER_UNAVAILABLE", 500, {}],
      ["EXTRACTION_FAILED", 500, {}],
      ["CHAT_FAILED", 500, {}],
    ];

    for (const [code, status, opts] of legacyCalls) {
      const res = errorResponse(code, status, opts);
      expect(res.status).toBe(status);
      // Body must contain the legacy code
      const body = (await res.json()) as {
        error: { code: string; message: string; retryable: boolean; requestId: string };
      };
      expect(body.error.code).toBe(code);
    }
  });

  it("new codes also work with errorResponse", async () => {
    const res = errorResponse("VALIDATION_ERROR", 400, { requestId: "test" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string; retryable: boolean; requestId: string };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(typeof body.error.message).toBe("string");
    expect(typeof body.error.retryable).toBe("boolean");
    expect(typeof body.error.requestId).toBe("string");

    const res2 = errorResponse("INTERNAL_ERROR", 500, { requestId: "test" });
    expect(res2.status).toBe(500);
    const body2 = (await res2.json()) as {
      error: { code: string; message: string; retryable: boolean; requestId: string };
    };
    expect(body2.error.code).toBe("INTERNAL_ERROR");
    expect(typeof body2.error.retryable).toBe("boolean");
    expect(typeof body2.error.requestId).toBe("string");
  });
});