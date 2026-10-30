import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/ready/route";

const VARS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_API_KEY",
  "LLM_BASE_URL",
  "LLM_API_KEY",
] as const;

const CONFIG = {
  SUPABASE_URL: "https://xyz.supabase.co",
  SUPABASE_SECRET_KEY: "sk-test",
  SUPABASE_STORAGE_BUCKET: "b",
  EMBEDDING_BASE_URL: "https://embedding.test/v1",
  EMBEDDING_API_KEY: "embedding-test",
  LLM_BASE_URL: "https://llm.test/v1",
  LLM_API_KEY: "llm-test",
} as const;

function snapshot(): Record<string, string | undefined> {
  return Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
}

function restore(prev: Record<string, string | undefined>): void {
  for (const k of VARS) {
    delete process.env[k];
    if (prev[k] !== undefined) process.env[k] = prev[k];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/ready", () => {
  it("fails closed when required dependencies are unconfigured", async () => {
    const prev = snapshot();
    for (const k of VARS) delete process.env[k];
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        ready: false,
        checks: {
          supabase: "unconfigured",
          storage: "unconfigured",
          pgvector: "unconfigured",
          embeddings: "unconfigured",
          llm: "unconfigured",
        },
      });
    } finally {
      restore(prev);
    }
  });

  it("reports 503 with no secrets or data when configured dependencies are unreachable", async () => {
    const prev = snapshot();
    Object.assign(process.env, CONFIG);
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      const body = (await res.json()) as { ready: boolean; checks: Record<string, string> };
      expect(body).toEqual({
        ready: false,
        checks: {
          supabase: "unreachable",
          storage: "unreachable",
          pgvector: "unreachable",
          embeddings: "unreachable",
          llm: "unreachable",
        },
      });
      expect(JSON.stringify(body)).not.toContain("sk-test");
    } finally {
      restore(prev);
    }
  });

  it("reports ready only when every authenticated, non-mutating dependency probe succeeds", async () => {
    const prev = snapshot();
    Object.assign(process.env, CONFIG);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("[]", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ready: true,
        checks: {
          supabase: "reachable",
          storage: "reachable",
          pgvector: "reachable",
          embeddings: "reachable",
          llm: "reachable",
        },
      });
      const requests = fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method ?? "GET",
      }));
      expect(requests.some(({ url }) => url.includes("/rest/v1/chunks?select=embedding&limit=0"))).toBe(true);
      expect(requests.some(({ url }) => url === "https://embedding.test/v1/models")).toBe(true);
      expect(requests.some(({ url }) => url === "https://llm.test/v1/models")).toBe(true);
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
    } finally {
      restore(prev);
    }
  });

  it("does not report ready when one required provider credential is missing", async () => {
    const prev = snapshot();
    Object.assign(process.env, CONFIG);
    delete process.env.LLM_API_KEY;
    vi.stubGlobal("fetch", async () => new Response("[]", { status: 200 }));
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        ready: false,
        checks: {
          supabase: "reachable",
          storage: "reachable",
          pgvector: "reachable",
          embeddings: "reachable",
          llm: "unconfigured",
        },
      });
    } finally {
      restore(prev);
    }
  });
});
