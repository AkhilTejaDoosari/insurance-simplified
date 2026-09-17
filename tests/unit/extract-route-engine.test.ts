import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(() => ({
    sessionId: "sess-1",
    createdAt: "",
    documents: [],
    userContext: {},
  })),
}));

const TABLE = { schemaVersion: "v1", factListVersion: "v1", documents: [], rows: [] };
vi.mock("@/app/lib/extraction/extract", () => ({
  extractViaLlm: vi.fn(async () => ({ ...TABLE, factListVersion: "llm" })),
  extractFallback: vi.fn(() => ({ ...TABLE, factListVersion: "fallback" })),
}));

import { POST } from "@/app/api/extract/route";
import { extractFallback, extractViaLlm } from "@/app/lib/extraction/extract";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/extract engine selection", () => {
  const env = { ...process.env };
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...env };
  });

  it("uses the LLM engine automatically when configured, with no engine field", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    const res = await post({ sessionId: "sess-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).factListVersion).toBe("llm");
    expect(extractViaLlm).toHaveBeenCalledTimes(1);
    expect(extractFallback).not.toHaveBeenCalled();
  });

  it("falls back to the deterministic engine only when no LLM is configured", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const res = await post({ sessionId: "sess-1" });
    expect((await res.json()).factListVersion).toBe("fallback");
    expect(extractViaLlm).not.toHaveBeenCalled();
  });

  it("honours an explicit engine override in either direction", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    expect((await (await post({ sessionId: "sess-1", engine: "fallback" })).json()).factListVersion).toBe("fallback");

    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    expect((await (await post({ sessionId: "sess-1", engine: "llm" })).json()).factListVersion).toBe("llm");
  });
});
