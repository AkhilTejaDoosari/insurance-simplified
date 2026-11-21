// Owner decision 2026-11-21 (1): extraction and plan grouping stay
// deterministic. Configuring LLM_* (the chat model) must never send document
// text to a provider from the extract route — not automatically, and not on a
// client's `engine: "llm"` request. Only the real modules run here; the one
// provider call (`completeJson`) and the network are spied on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/llm/client")>();
  return { ...actual, completeJson: vi.fn(async () => { throw new Error("no provider call expected"); }) };
});

import { POST } from "@/app/api/extract/route";
import { completeJson } from "@/app/lib/llm/client";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";

const created: string[] = [];

function post(body: Record<string, unknown> = {}) {
  const { session, capability } = createSession(
    [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: ["Policy name: Alpha\nAnnual deductible: $250."] }],
    {},
  );
  created.push(session.sessionId);
  return POST(
    new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
      body: JSON.stringify({ sessionId: session.sessionId, ...body }),
    }),
  );
}

describe("extraction makes no LLM call when LLM_* is set", () => {
  const env = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.LLM_BASE_URL = "https://llm.example/v1";
    process.env.LLM_API_KEY = "key";
    process.env.LLM_MODEL = "chat-model";
    delete process.env.EXTRACTION_ENGINE;
    fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
    for (const id of created.splice(0)) deleteSession(id);
    vi.mocked(completeJson).mockClear();
  });

  it("the default engine is deterministic: no completeJson call, no network call to the provider", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(completeJson).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).startsWith("https://llm.example"))).toBe(false);
    const body = await res.json();
    expect(body.rows.find((r: { factName: string }) => r.factName === "annual-deductible")?.values.length).toBeGreaterThan(0);
  });

  it("a client's engine: 'llm' request cannot turn the provider on", async () => {
    const res = await post({ engine: "llm" });
    expect(res.status).toBe(200);
    expect(completeJson).not.toHaveBeenCalled();
  });
});
