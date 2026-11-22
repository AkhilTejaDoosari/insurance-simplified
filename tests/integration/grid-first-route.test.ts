// Grid-first chat at the route (owner decision 2026-11-21 (5)): a fact
// question answers from the stored result re-derived under this request
// (TB-3 still holds: an altered stored row is not an answer source), without
// a model call; other questions take the retrieval path. Synthetic text only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/app/lib/rag/answer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/rag/answer")>();
  return { ...actual, answerViaLlm: vi.fn(actual.answerViaLlm), answerQuestionSemantic: vi.fn(actual.answerQuestionSemantic) };
});

import { POST as chat } from "@/app/api/chat/route";
import { answerQuestionSemantic, answerViaLlm, UNCERTAIN_TEXT } from "@/app/lib/rag/answer";
import { deleteComparisonResult } from "@/app/lib/comparison-result-db";
import { deleteSession } from "@/app/lib/session";
import { SESSIONS_DIR, blankProviderEnv, extractedSession, post, selectionFor, tamperStoredRow } from "./m7b-fixtures";

const originalEnv = { ...process.env };
const created: string[] = [];
beforeEach(() => {
  blankProviderEnv();
  vi.mocked(answerViaLlm).mockClear();
  vi.mocked(answerQuestionSemantic).mockClear();
});
afterEach(async () => {
  process.env = { ...originalEnv };
  for (const id of created.splice(0)) {
    await deleteComparisonResult(id);
    rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
    deleteSession(id);
  }
});

describe("grid-first chat route", () => {
  it("a fact question answers from the verified comparison, with registered citations and no retrieval engine", async () => {
    const { sessionId, capability } = await extractedSession(created);
    const res = await chat(post("/api/chat", { sessionId, question: "What is the deductible?" }, capability));
    const body = await res.json();
    expect(body.kind).toBe("answer");
    expect(body.answerText).toContain("Annual deductible: $500 per person");
    expect(body.citations[0].evidenceId).toEqual(expect.any(String));
    expect(body.citations[0].page).toBe(2);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
    expect(answerViaLlm).not.toHaveBeenCalled();
  });

  it("an altered stored row is never an answer source (TB-3): the retrieval path answers instead", async () => {
    const { sessionId, capability } = await extractedSession(created);
    tamperStoredRow(sessionId, "annual-deductible", (row) => {
      (row.values as { display: string }[])[0].display = "Annual deductible: $5 per person";
    });
    const res = await chat(post("/api/chat", { sessionId, question: "What is the deductible?" }, capability));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("$5 per person");
    expect(body.kind).toBe("refusal");
    expect(body.refusalText).toBe(UNCERTAIN_TEXT);
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
  });

  it("a stored result for different documents (stale fingerprint) is not an answer source", async () => {
    const { sessionId, capability } = await extractedSession(created);
    const path = join(SESSIONS_DIR, `${sessionId}.result.json`);
    const record = JSON.parse(readFileSync(path, "utf8"));
    record.documentFingerprint = "stale-fingerprint";
    writeFileSync(path, JSON.stringify(record));
    const res = await chat(post("/api/chat", { sessionId, question: "What is the deductible?" }, capability));
    expect((await res.json()).kind).toBe("refusal");
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
  });

  it("with a selection, the answer comes from the selected plan", async () => {
    const { sessionId, capability, table } = await extractedSession(created);
    const res = await chat(post("/api/chat", { sessionId, question: "What is the deductible?", selection: selectionFor(table) }, capability));
    const body = await res.json();
    expect(body.kind).toBe("answer");
    expect(body.answerText).toContain("Annual deductible: $500 per person");
  });

  it("a question that names no fact takes the retrieval path", async () => {
    const { sessionId, capability } = await extractedSession(created);
    await chat(post("/api/chat", { sessionId, question: "Does this cover space tourism?" }, capability));
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
  });
});

// Owner decision 2026-11-22: plan-name header lines are stripped server-side.
// The model path receives exactly the names of the plans re-verified under
// this request whose sources are in the chat scope.
describe("model path receives the verified in-scope plan names", () => {
  it("passes the stored result's re-verified plan names to answerViaLlm", async () => {
    process.env.LLM_BASE_URL = "https://llm.test/v1";
    process.env.LLM_API_KEY = "test-key";
    vi.mocked(answerViaLlm).mockResolvedValueOnce({ schemaVersion: "v1", kind: "refusal", refusalText: "x" } as never);
    const { sessionId, capability, table } = await extractedSession(created);
    const names = (table.plans ?? []).map((p: { name: string }) => p.name);
    expect(names.length).toBeGreaterThan(0);
    await chat(post("/api/chat", { sessionId, question: "Tell me about travel abroad?" }, capability));
    expect(vi.mocked(answerViaLlm).mock.calls[0][2]).toMatchObject({ planNames: names });
  });
});
