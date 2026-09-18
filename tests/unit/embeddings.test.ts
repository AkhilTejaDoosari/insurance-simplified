import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DimensionError,
  embedTexts,
  isEmbeddingConfigured,
} from "@/app/lib/rag/embeddings";

const embedResponse = (vectors: number[][]) =>
  new Response(
    JSON.stringify({ data: vectors.map((embedding) => ({ embedding })) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const errorResponse = (status: number) =>
  new Response(JSON.stringify({ error: `status ${status}` }), { status });

describe("embeddings provider abstraction", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.EMBEDDING_BASE_URL = "https://embeddings.example";
    process.env.EMBEDDING_API_KEY = "test-key";
    process.env.EMBEDDING_MODEL = "test-model";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("batches inputs across multiple POST /embeddings calls in order", async () => {
    fetchMock
      .mockResolvedValueOnce(embedResponse([[1, 0], [0, 1]]))
      .mockResolvedValueOnce(embedResponse([[1, 1]]));
    const vectors = await embedTexts(["a", "b", "c"], { batchSize: 2, baseDelayMs: 1 });
    expect(vectors).toEqual([[1, 0], [0, 1], [1, 1]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    expect(firstUrl).toBe("https://embeddings.example/embeddings");
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(firstBody).toMatchObject({ model: "test-model", input: ["a", "b"] });
  });

  it("retries a transient 500 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(embedResponse([[1, 0]]));
    await expect(embedTexts(["a"], { baseDelayMs: 1 })).resolves.toEqual([[1, 0]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws DimensionError naming expected vs received dims", async () => {
    fetchMock.mockResolvedValueOnce(embedResponse([[1, 0, 0], [1, 0]]));
    const err = await embedTexts(["a", "b"], { baseDelayMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DimensionError);
    expect(String((err as Error).message)).toMatch(/expected 3.*received 2/s);
  });

  it("skips cleanly when EMBEDDING_* is unconfigured", async () => {
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_MODEL;
    expect(isEmbeddingConfigured()).toBe(false);
    await expect(embedTexts(["a"], { baseDelayMs: 1 })).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry a bad key (401) — deterministic fallback signal", async () => {
    fetchMock.mockResolvedValue(errorResponse(401));
    await expect(embedTexts(["a"], { baseDelayMs: 1 })).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget on persistent 500", async () => {
    fetchMock.mockResolvedValue(errorResponse(500));
    await expect(embedTexts(["a"], { baseDelayMs: 1 })).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
