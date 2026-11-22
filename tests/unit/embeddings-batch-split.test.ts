// Cloudflare Workers AI (D-012) rejects some 32-text batches as a whole with
// HTTP 400 "input too big" (code 3030) although every text fits the model
// context (observed on a 36-page brochure, 2026-11-22). The adapter splits a
// rejected multi-text batch in half and retries; a single text that is still
// rejected fails as before (the caller logs the keyword fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embedTexts } from "@/app/lib/rag/embeddings";

const ok = (n: number, start: number) =>
  new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ embedding: [start + i, 1] })) }), { status: 200 });
const tooBig = () =>
  new Response(JSON.stringify({ errors: [{ message: "AiError: input too big", code: 3030 }], success: false }), { status: 400 });

describe("embedding batch split on a whole-batch 400", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.EMBEDDING_BASE_URL = "https://embeddings.example";
    process.env.EMBEDDING_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("a rejected batch of 4 is retried as two batches of 2, order kept", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const input = (JSON.parse(String(init.body)) as { input: string[] }).input;
      if (input.length > 2) return tooBig();
      return ok(input.length, Number(input[0]));
    });
    const vectors = await embedTexts(["0", "1", "2", "3"], { batchSize: 4, baseDelayMs: 1 });
    expect(vectors).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a single text that is rejected still throws (no silent drop)", async () => {
    fetchMock.mockResolvedValue(tooBig());
    await expect(embedTexts(["only"], { baseDelayMs: 1 })).rejects.toThrow(/status 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 401 is never split (bad key is not a size problem)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(embedTexts(["a", "b"], { baseDelayMs: 1 })).rejects.toThrow(/status 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
