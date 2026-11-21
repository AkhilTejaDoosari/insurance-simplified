// Owner decision 2026-11-21: per-request token limits and a usage log for
// the cloud chat model. The log carries counts and timings only — never the
// prompt, the document text or the model output — and the chat request
// always carries an output-token cap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "@/app/lib/llm/client";

const SECRET_TEXT = "Deductible elsewhere $100 — document text must never be logged";
const reply = () =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: '{"answer":1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 5 } }),
    { status: 200 },
  );

describe("LLM usage log", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.LLM_BASE_URL = "https://llm.example/v1";
    process.env.LLM_API_KEY = "secret-key-value";
    fetchMock = vi.fn(async () => reply());
    vi.stubGlobal("fetch", fetchMock);
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    info.mockRestore();
    process.env = { ...env };
  });

  it("logs one line per call with model, status, tokens and latency only", async () => {
    await completeJson([{ role: "user", content: SECRET_TEXT }], "chat-model");
    const lines = info.mock.calls.map((c) => c.join(" ")).filter((l) => l.startsWith("[llm-usage]"));
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0].replace("[llm-usage] ", ""));
    expect(record).toMatchObject({ model: "chat-model", status: 200, promptTokens: 12, completionTokens: 5, attempt: 1 });
    expect(typeof record.ms).toBe("number");
    expect(lines[0]).not.toContain("Deductible");
    expect(lines[0]).not.toContain("secret-key-value");
    expect(lines[0]).not.toContain("answer");
  });

  it("logs a failed attempt too (status only)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(completeJson([{ role: "user", content: SECRET_TEXT }], "chat-model")).rejects.toThrow();
    const lines = info.mock.calls.map((c) => c.join(" ")).filter((l) => l.startsWith("[llm-usage]"));
    expect(JSON.parse(lines[0].replace("[llm-usage] ", ""))).toMatchObject({ status: 400, attempt: 1 });
  });
});

describe("chat output-token cap", () => {
  const env = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("every chat request carries max_tokens = CHAT_MAX_OUTPUT_TOKENS", async () => {
    process.env.LLM_BASE_URL = "https://llm.example/v1";
    process.env.LLM_API_KEY = "key";
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_API_KEY;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"cantAnswer":true,"answerText":null,"citations":null}' }, finish_reason: "stop" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { answerViaLlm, CHAT_MAX_OUTPUT_TOKENS } = await import("@/app/lib/rag/answer");
    await answerViaLlm([{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: ["SCHEDULE OF BENEFITS\nDeductible elsewhere $100"] }], "What is the deductible?");
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/chat/completions"));
    expect(JSON.parse(String(chatCall?.[1]?.body)).max_tokens).toBe(CHAT_MAX_OUTPUT_TOKENS);
  });
});
