import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/ready/route";

const VARS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "EMBEDDING_BASE_URL",
] as const;

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
  it("reports ready with all-unconfigured when no deps are set (temp-only mode is servable)", async () => {
    const prev = snapshot();
    for (const k of VARS) delete process.env[k];
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ready: true,
        checks: { supabase: "unconfigured", storage: "unconfigured", embeddings: "unconfigured" },
      });
    } finally {
      restore(prev);
    }
  });

  it("reports 503 with no secrets or data when configured deps are unreachable", async () => {
    const prev = snapshot();
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sk-test";
    process.env.SUPABASE_STORAGE_BUCKET = "b";
    process.env.EMBEDDING_BASE_URL = "http://ollama:11434";
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      const body = (await res.json()) as { ready: boolean; checks: Record<string, string> };
      expect(body).toEqual({
        ready: false,
        checks: { supabase: "unreachable", storage: "unreachable", embeddings: "unreachable" },
      });
      expect(JSON.stringify(body)).not.toContain("sk-test");
    } finally {
      restore(prev);
    }
  });

  it("reports ready when configured deps answer", async () => {
    const prev = snapshot();
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sk-test";
    process.env.SUPABASE_STORAGE_BUCKET = "b";
    process.env.EMBEDDING_BASE_URL = "http://ollama:11434";
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ready: true,
        checks: { supabase: "reachable", storage: "reachable", embeddings: "reachable" },
      });
    } finally {
      restore(prev);
    }
  });
});
