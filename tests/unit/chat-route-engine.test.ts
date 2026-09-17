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
}));

import { POST } from "@/app/api/chat/route";
import { answerQuestion, answerViaLlm } from "@/app/lib/rag/answer";

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
    expect(answerQuestion).toHaveBeenCalledTimes(1);
    expect(answerViaLlm).not.toHaveBeenCalled();
  });

  it("honours an explicit engine override in either direction", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    await post({ sessionId: "sess-1", question: "q", engine: "fallback" });
    expect(answerQuestion).toHaveBeenCalledTimes(1);

    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    await post({ sessionId: "sess-1", question: "q", engine: "llm" });
    expect(answerViaLlm).toHaveBeenCalledTimes(1);
  });
});
