import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "@/app/lib/llm/client";

const ok = { choices: [{ message: { content: '{"answer":1}' } }] };
const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const answer = {
  answerText: "Covered.",
  citations: [{ documentId: "doc-1", page: 1, quote: "Covered." }],
};
const completion = (payload: unknown) =>
  response(200, { choices: [{ message: { content: JSON.stringify(payload) } }] });
const contentCompletion = (content: string, finish_reason = "stop") =>
  response(200, { choices: [{ message: { content }, finish_reason }] });
const envelope = (content: unknown) => ({ name: "answer", type: "json_object", content });

describe("LLM client responses and retries", () => {
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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("max_tokens");
  });

  it("allows a diagnostic to stop after one retryable failure", async () => {
    fetchMock.mockResolvedValue(response(503, { error: "down" }));
    await expect(completeJson([{ role: "user", content: "hi" }], "m", { maxAttempts: 1 }))
      .rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a diagnostic output-token limit as max_tokens", async () => {
    fetchMock.mockResolvedValue(completion(answer));
    await completeJson([{ role: "user", content: "hi" }], "m", { maxTokens: 1234 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ max_tokens: 1234 });
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

  it("preserves a standard JSON answer", async () => {
    fetchMock.mockResolvedValue(completion(answer));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).resolves.toEqual(answer);
  });

  it("accepts one complete Markdown-fenced JSON object", async () => {
    fetchMock.mockResolvedValue(contentCompletion(`\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\n`));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).resolves.toEqual(answer);
  });

  it.each([
    ["surrounding commentary", `Here is the result:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``],
    ["a second fenced payload", `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``],
    ["a truncated fenced object", `\`\`\`json\n{"answerText":"Covered."\n\`\`\``],
    ["a non-JSON fence", `\`\`\`text\n${JSON.stringify(answer)}\n\`\`\``],
  ])("rejects fenced response with %s", async (_, content) => {
    fetchMock.mockResolvedValue(contentCompletion(content));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).rejects.toThrow();
  });

  it("reports provider-declared length termination as incomplete generation", async () => {
    fetchMock.mockResolvedValue(contentCompletion('{"answerText":"Covered."', "length"));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).rejects.toThrow(/incomplete generation/i);
  });

  it("classifies malformed JSON with a normal stop reason as malformed rather than truncated", async () => {
    fetchMock.mockResolvedValue(contentCompletion('{"answerText":', "stop"));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).rejects.toThrow(/malformed JSON/i);
  });

  it("preserves a standard refusal", async () => {
    fetchMock.mockResolvedValue(completion({ cantAnswer: true }));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).resolves.toEqual({ cantAnswer: true });
  });

  it("unwraps the exact provider answer envelope once", async () => {
    fetchMock.mockResolvedValue(completion(envelope(JSON.stringify(answer))));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).resolves.toEqual(answer);
  });

  it.each([
    ["an unsupported name", { ...envelope(JSON.stringify(answer)), name: "other" }],
    ["an unsupported type", { ...envelope(JSON.stringify(answer)), type: "text" }],
    ["an extra field", { ...envelope(JSON.stringify(answer)), extra: true }],
    ["missing content", { name: "answer", type: "json_object" }],
    ["non-string content", envelope(answer)],
    ["invalid inner JSON", envelope('{"answerText":')],
    ["missing inner citations", envelope('{"answerText":"Covered."}')],
    ["an empty inner citation list", envelope(JSON.stringify({ ...answer, citations: [] }))],
    ["a malformed inner citation", envelope(JSON.stringify({ ...answer, citations: [{}] }))],
    ["ambiguous inner fields", envelope(JSON.stringify({ ...answer, kind: "refusal" }))],
    ["an excessively nested envelope", envelope(JSON.stringify(envelope(JSON.stringify(answer))))],
  ])("rejects %s rather than passing an unsupported envelope through", async (_, payload) => {
    fetchMock.mockResolvedValue(completion(payload));
    await expect(completeJson([{ role: "user", content: "hi" }], "m")).rejects.toThrow();
  });
});
