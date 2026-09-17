import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "@/app/lib/llm/client";

const ok = { choices: [{ message: { content: '{"answer":1}' } }] };
const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("LLM client retries", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("retries a 429 with backoff and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(response(429, { error: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(response(200, ok));
    await expect(completeJson([{ role: "user", content: "hi" }], "m", { baseDelayMs: 1 })).resolves.toEqual({ answer: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient 5xx but gives up after the retry budget", async () => {
    fetchMock.mockResolvedValue(response(503, { error: "down" }));
    await expect(completeJson([{ role: "user", content: "hi" }], "m", { baseDelayMs: 1 })).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 4xx that will not change (e.g. 401)", async () => {
    fetchMock.mockResolvedValue(response(401, { error: "bad key" }));
    await expect(completeJson([{ role: "user", content: "hi" }], "m", { baseDelayMs: 1 })).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
