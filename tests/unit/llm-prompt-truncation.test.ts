// Diagnosed 2026-11-21: a local provider with a small context window
// silently truncated every chat prompt (≈7,500 → 2,050 tokens, keeping the
// END), so the model never saw the trusted instructions or the question,
// only untrusted document text, and every stated fact ended as "cannot be
// confirmed". A truncated prompt is a provider/configuration failure
// (A-026): the adapter fails closed, and the chat route turns it into the
// retryable CHAT_FAILED. Detection uses the provider's own usage report.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "@/app/lib/llm/client";

const reply = (promptTokens?: number) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"answer":1}' }, finish_reason: "stop" }],
      ...(promptTokens === undefined ? {} : { usage: { prompt_tokens: promptTokens, completion_tokens: 5 } }),
    }),
    { status: 200 },
  );

// ~30,000 characters of ordinary English prose (≈7,500 tokens).
const LONG = "The plan pays covered medical expenses after the deductible is met. ".repeat(440);

describe("provider prompt truncation", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.LLM_API_KEY = "local";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("a prompt the provider truncated is a failure, never a reply", async () => {
    fetchMock.mockResolvedValueOnce(reply(2050));
    await expect(completeJson([{ role: "user", content: LONG }], "m")).rejects.toThrow(/truncated/i);
  });

  it("a prompt read in full is accepted", async () => {
    fetchMock.mockResolvedValueOnce(reply(7400));
    await expect(completeJson([{ role: "user", content: LONG }], "m")).resolves.toEqual({ answer: 1 });
  });

  it("a provider that reports no usage is not second-guessed", async () => {
    fetchMock.mockResolvedValueOnce(reply());
    await expect(completeJson([{ role: "user", content: LONG }], "m")).resolves.toEqual({ answer: 1 });
  });

  it("short prompts are not checked (token ratios are noisy there)", async () => {
    fetchMock.mockResolvedValueOnce(reply(3));
    await expect(completeJson([{ role: "user", content: "Return {\"answer\":1}" }], "m")).resolves.toEqual({ answer: 1 });
  });
});
