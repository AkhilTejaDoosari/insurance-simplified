// Owner decision 2026-11-21: the local qwen3 model's reasoning step can be
// turned off in the adapter for chat speed. Opt-in only: with
// LLM_REASONING_EFFORT unset the request body is exactly as before, so no
// other provider sees a new field. The value is a closed set; anything else
// is a configuration error, never forwarded.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "@/app/lib/llm/client";

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":1}' } }] }), { status: 200 });

describe("LLM_REASONING_EFFORT", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.LLM_API_KEY = "local";
    delete process.env.LLM_REASONING_EFFORT;
    fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it("unset: the request has no reasoning field", async () => {
    await completeJson([{ role: "user", content: "hi" }], "m");
    expect(body()).not.toHaveProperty("reasoning_effort");
  });

  it.each(["none", "low", "medium", "high"])("%s is sent as reasoning_effort", async (value) => {
    process.env.LLM_REASONING_EFFORT = value;
    await completeJson([{ role: "user", content: "hi" }], "m");
    expect(body().reasoning_effort).toBe(value);
  });

  it("an unknown value is a configuration error and is never sent", async () => {
    process.env.LLM_REASONING_EFFORT = "off; drop";
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).rejects.toThrow(/LLM_REASONING_EFFORT/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
