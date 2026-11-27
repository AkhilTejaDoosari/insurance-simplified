import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSession, deleteSession, getEvidenceRecord, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { REFUSAL_TEXT } from "@/app/lib/rag/answer";

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
  vi.resetAllMocks();
});

vi.mock("@/app/lib/rag/answer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/answer")>()),
  answerQuestion: vi.fn(),
  answerQuestionSemantic: vi.fn(),
  answerViaLlm: vi.fn(),
}));

import { POST } from "@/app/api/chat/route";
import { answerQuestion, answerQuestionSemantic } from "@/app/lib/rag/answer";

const mockedAnswer = vi.mocked(answerQuestionSemantic);

function seedSession() {
  const { session, capability } = createSession(
    [
      {
        documentId: "doc-1",
        filename: "a.pdf",
        pageCount: 1,
        pages: ["Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000."],
      },
    ],
    {}
  );
  created.push(session.sessionId);
  return { session, capability };
}

function post(sessionId: string, capability: string) {
  return POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}`,
      },
      body: JSON.stringify({ sessionId, question: "What is the deductible?", engine: "fallback" }),
    })
  );
}

function answer(citations: unknown[]) {
  return {
    schemaVersion: "v1",
    kind: "answer",
    answerText: "The deductible is $250.",
    citations,
  };
}

describe("POST /api/chat evidence verification boundary", () => {
  it("15. fails a partially unsupported answer closed with the existing refusal", async () => {
    const { session, capability } = seedSession();
    mockedAnswer.mockReturnValue(
      answer([
        { documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." },
        { documentId: "doc-1", page: 1, quote: "Fabricated passage here." },
      ]) as never
    );
    const res = await post(session.sessionId, capability);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });

  it("16+17. returns canonical verbatim quotes and registers them", async () => {
    const { session, capability } = seedSession();
    mockedAnswer.mockReturnValue(
      answer([{ documentId: "doc-1", page: 1, quote: "Annual deductible ... $250 in-network." }]) as never
    );
    const res = await post(session.sessionId, capability);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("answer");
    const canonical = "Annual deductible: $250 in-network.";
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].quote).toBe(canonical);
    expect(body.citations[0].evidenceId).toMatch(/^ev-[0-9a-f]{16}$/);
    expect(getEvidenceRecord(session.sessionId, body.citations[0].evidenceId)).toEqual({
      documentId: "doc-1",
      page: 1,
      quote: canonical,
    });
  });
});
