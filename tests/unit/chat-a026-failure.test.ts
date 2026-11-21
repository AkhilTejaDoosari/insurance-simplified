// A-026 regression (owner decision 2026-11-21): the two chat outcomes that
// used to look alike are kept apart.
// - The model or provider failed (timeout, HTTP error, unparseable output):
//   the route returns the retryable CHAT_FAILED error. It never degrades to
//   the retrieval engine, which would look like a "documents don't say"
//   answer for a technical fault.
// - The model answered but verifyAnswerClaims rejected it: "cannot be
//   confirmed" with the cited passages; the unverified text is never shown.
// Only the model call (completeJson) is mocked; retrieval, verification and
// the route are real. Synthetic text only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/llm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/llm/client")>()),
  completeJson: vi.fn(),
  isLlmConfigured: vi.fn(() => true),
}));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/rag/embeddings")>();
  return { ...actual, isEmbeddingConfigured: vi.fn(() => false), embedTexts: vi.fn(async () => []) };
});

import { POST } from "@/app/api/chat/route";
import { completeJson } from "@/app/lib/llm/client";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { UNCERTAIN_TEXT } from "@/app/lib/rag/answer";

const BENEFITS = [
  "SCHEDULE OF BENEFITS",
  "Deductible at the student health center $50",
  "Deductible elsewhere $100",
].join("\n");

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
  vi.mocked(completeJson).mockReset();
});

function ask(question = "What is the deductible?") {
  const { session, capability } = createSession(
    [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [BENEFITS] }],
    {},
  );
  created.push(session.sessionId);
  return POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
      body: JSON.stringify({ sessionId: session.sessionId, question }),
    }),
  );
}

describe("A-026: model or provider failure is a retryable technical error", () => {
  it.each([
    ["timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })],
    ["provider HTTP error", new Error("LLM request failed with status 503")],
    ["unparseable output", new Error("LLM returned malformed JSON")],
    ["prompt truncated by the provider", new Error("LLM prompt truncated by provider: context window smaller than the prompt")],
  ])("%s → CHAT_FAILED, retryable, no passages", async (_case, err) => {
    vi.mocked(completeJson).mockRejectedValueOnce(err);
    const res = await ask();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("CHAT_FAILED");
    expect(body.error.retryable).toBe(true);
    expect(body.kind).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Deductible");
  });

  it("output that is valid JSON but not a chat answer → CHAT_FAILED", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ cantAnswer: false, answerText: 42, citations: "none" });
    const res = await ask();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("CHAT_FAILED");
  });
});

describe("A-026: an answer rejected by verifyAnswerClaims is 'cannot be confirmed' with passages", () => {
  it("unsupported figure → 200 refusal with the cited passage, never the model text", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({
      cantAnswer: false,
      answerText: "The deductible elsewhere is $250.",
      citations: [{ documentId: "doc-1", page: 1, quote: "Deductible elsewhere $100" }],
    });
    const res = await ask();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("refusal");
    expect(body.refusalText).toBe(UNCERTAIN_TEXT);
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations[0].page).toBe(1);
    expect(body.citations[0].evidenceId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("$250");
  });
});
