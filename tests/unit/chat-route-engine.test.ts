import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(() => ({ sessionId: "sess-1", createdAt: "", documents: [], userContext: {} })),
}));

const REFUSAL = {
  schemaVersion: "v1",
  kind: "refusal",
  refusalText: "The uploaded documents contain no supporting evidence for this question.",
};
vi.mock("@/app/lib/rag/answer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/answer")>()),
  answerViaLlm: vi.fn(async () => ({ ...REFUSAL, refusalText: `llm: ${REFUSAL.refusalText}` })),
  answerQuestion: vi.fn(() => REFUSAL),
  answerQuestionSemantic: vi.fn(async () => REFUSAL),
}));

import { POST } from "@/app/api/chat/route";
import { answerQuestion, answerQuestionSemantic, answerViaLlm } from "@/app/lib/rag/answer";
import { resolveEmbeddingConfig } from "@/app/lib/rag/embeddings";
import { REFUSAL_TEXT, validateChatResponse } from "@/app/lib/rag/answer";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/chat engine selection", () => {
  const env = { ...process.env };
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...env };
  });

  it("uses the LLM engine automatically when configured, with no engine field", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    const res = await post({ sessionId: "sess-1", question: "What is the deductible?" });
    expect(res.status).toBe(200);
    expect((await res.json()).refusalText).toMatch(/^llm:/);
    expect(answerViaLlm).toHaveBeenCalledTimes(1);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it("falls back to the deterministic engine only when no LLM is configured", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    await post({ sessionId: "sess-1", question: "What is the deductible?" });
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
    expect(answerViaLlm).not.toHaveBeenCalled();
  });

  it("honours an explicit engine override in either direction", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    await post({ sessionId: "sess-1", question: "q", engine: "fallback" });
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);

    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    await post({ sessionId: "sess-1", question: "q", engine: "llm" });
    expect(answerViaLlm).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/chat embedding degradation (todo 23)", () => {
  const env = { ...process.env };
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...env };
  });

  function clearAllEngineEnv() {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_MODEL;
  }

  it("unset EMBEDDING_* env reports the clean-skip signal and serves the lexical path", async () => {
    clearAllEngineEnv();
    expect(resolveEmbeddingConfig()).toBeNull();
    const res = await post({ sessionId: "sess-1", question: "What is the deductible?" });
    expect(res.status).toBe(200);
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
    expect(answerViaLlm).not.toHaveBeenCalled();
  });

  it("unset-env lexical response keeps the identical ChatResponse contract + refusal text", async () => {
    clearAllEngineEnv();
    const res = await post({ sessionId: "sess-1", question: "What is the deductible?" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(() => validateChatResponse(body)).not.toThrow();
    expect(body).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });

  it("bad-key provider failure degrades to lexical, never a 500", async () => {
    clearAllEngineEnv();
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "bad-key";
    vi.mocked(answerViaLlm).mockRejectedValueOnce(
      new Error("LLM request failed with status 401"),
    );
    const res = await post({ sessionId: "sess-1", question: "What is the deductible?" });
    expect(res.status).toBe(200);
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as unknown;
    expect(() => validateChatResponse(body)).not.toThrow();
    expect(body).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });

  it("explicit engine llm with an unhealthy provider still degrades to lexical, not 500", async () => {
    clearAllEngineEnv();
    vi.mocked(answerViaLlm).mockRejectedValueOnce(
      new Error("LLM not configured (set LLM_BASE_URL and LLM_API_KEY)"),
    );
    const res = await post({ sessionId: "sess-1", question: "q", engine: "llm" });
    expect(res.status).toBe(200);
    expect(answerViaLlm).toHaveBeenCalledTimes(1);
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as unknown;
    expect(() => validateChatResponse(body)).not.toThrow();
  });
});
