import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createSession,
  deleteSession,
  SESSION_CAPABILITY_COOKIE,
} from "@/app/lib/session";

const TABLE = { schemaVersion: "v1", factListVersion: "v1", documents: [], rows: [] };
vi.mock("@/app/lib/extraction/extract", () => ({
  extractViaLlm: vi.fn(async () => ({ ...TABLE, factListVersion: "llm" })),
  extractFallback: vi.fn(() => ({ ...TABLE, factListVersion: "fallback" })),
}));
vi.mock("@/app/lib/llm/client", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/llm/client")>("@/app/lib/llm/client");
  return {
    ...actual,
    completeJson: vi.fn(async () => ({
      groups: [{ title: "Cost choices", factNames: ["annual-deductible", "invented-benefit"] }],
    })),
  };
});

import { POST } from "@/app/api/extract/route";
import { extractFallback, extractViaLlm } from "@/app/lib/extraction/extract";

const created: string[] = [];

function seedSession() {
  const { session, capability } = createSession([], {});
  created.push(session.sessionId);
  return { session, capability };
}

function post(sessionId: string, capability: string, body: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}`,
      },
      body: JSON.stringify({ sessionId, ...body }),
    }),
  );
}

describe("POST /api/extract engine selection", () => {
  const env = { ...process.env };
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...env };
    for (const id of created.splice(0)) deleteSession(id);
  });

  it("uses the LLM engine automatically when configured, with no engine field", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    const { session, capability } = seedSession();
    const res = await post(session.sessionId, capability);
    expect(res.status).toBe(200);
    expect((await res.json()).factListVersion).toBe("llm");
    expect(extractViaLlm).toHaveBeenCalledTimes(1);
    expect(extractFallback).not.toHaveBeenCalled();
  });

  it("falls back to the deterministic engine only when no LLM is configured", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = seedSession();
    const res = await post(session.sessionId, capability);
    expect((await res.json()).factListVersion).toBe("fallback");
    expect(extractViaLlm).not.toHaveBeenCalled();
  });

  it("honours an explicit engine override in either direction", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    const first = seedSession();
    expect((await (await post(first.session.sessionId, first.capability, { engine: "fallback" })).json()).factListVersion).toBe("fallback");

    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const second = seedSession();
    expect((await (await post(second.session.sessionId, second.capability, { engine: "llm" })).json()).factListVersion).toBe("llm");
  });

  it("organizes only verified facts while preserving citations in the response", async () => {
    process.env.LLM_BASE_URL = "https://llm.example";
    process.env.LLM_API_KEY = "key";
    const document = {
      documentId: "doc-1",
      filename: "plan.pdf",
      pageCount: 1,
      pages: ["Annual deductible $250."],
    };
    const { session, capability } = createSession([document], {});
    created.push(session.sessionId);
    vi.mocked(extractViaLlm).mockResolvedValueOnce({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1 }],
      rows: [{
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [{
          documentId: "doc-1",
          display: "$250",
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible $250." }],
        }],
      }],
    });
    const response = await post(session.sessionId, capability);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.presentationGroups).toEqual([{ title: "Cost choices", factNames: ["annual-deductible"] }]);
    expect(body.rows[0].values[0].evidence[0].evidenceId).toMatch(/^ev-/);
  });
});
