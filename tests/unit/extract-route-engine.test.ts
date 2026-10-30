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
    expect(body.resultFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not publish plan identity when its named source quote fails page verification", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{ documentId: "doc-1", filename: "similar.pdf", pageCount: 1, pages: ["Plan name: Alpha; premium: $5"] }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1", documents: [{ documentId: "doc-1", filename: "similar.pdf", pageCount: 1 }],
      plans: [{ planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", planId: "alpha", display: "$5", qualifiers: {}, evidence: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha; premium: $5" }] }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plans).toBeUndefined();
    expect(body.rows[0].values[0].planId).toBeUndefined();
  });

  it("keeps ownership attribution when the labelled plan-binding citation fails verification (unique verified plan)", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{
      documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1,
      pages: ["Policy name: Alpha\nPremium: $5"],
    }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [{ planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{
        documentId: "doc-1", planId: "alpha", display: "$5", qualifiers: {},
        evidence: [
          { documentId: "doc-1", page: 1, quote: "Plan name: Alpha; premium: $5" },
          { documentId: "doc-1", page: 1, quote: "Premium: $5" },
        ],
      }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plans).toHaveLength(1);
    // The labelled binding citation failed verification, so the claimed proof
    // is gone — but the document's unique verified plan identity plus the
    // ownership guards still prove the value's plan scope (P1 ownership).
    expect(body.rows[0].values[0].planId).toBe("alpha");
    expect(body.rows[0].values[0].evidence).toEqual([expect.objectContaining({ quote: "Premium: $5", evidenceId: expect.stringMatching(/^ev-/) })]);
  });

  it("stays unassigned on a multi-plan document when the labelled plan-binding citation fails verification", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{
      documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1,
      pages: ["Policy name: Alpha\nPolicy name: Beta\nPremium: $5"],
    }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [
        { planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] },
        { planId: "beta", name: "Beta", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Beta" }] },
      ],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{
        documentId: "doc-1", planId: "alpha", display: "$5", qualifiers: {},
        evidence: [
          { documentId: "doc-1", page: 1, quote: "Plan name: Alpha; premium: $5" },
          { documentId: "doc-1", page: 1, quote: "Premium: $5" },
        ],
      }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    // Multi-plan documents void the ownership proof — the failed labelled
    // claim leaves the value unassigned (C6 fail-closed preserved).
    expect(body.rows[0].values[0].planId).toBeUndefined();
  });

  it("keeps a verified plan-bound value and its original-page evidence", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{
      documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1,
      pages: ["Policy name: Alpha\nPlan name: Alpha; premium: $5"],
    }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [{ planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", planId: "alpha", display: "$5", qualifiers: {},
        evidence: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha; premium: $5" }],
      }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows[0].values[0].planId).toBe("alpha");
    expect(body.rows[0].values[0].evidence).toEqual([expect.objectContaining({ page: 1, quote: "Plan name: Alpha; premium: $5", evidenceId: expect.stringMatching(/^ev-/) })]);
  });

  it("keeps a server-attributed value under the document-ownership proof without a labelled line", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{
      documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1,
      pages: ["Policy name: Alpha\nAlpha's premium is $5"],
    }], {});
    created.push(session.sessionId);
    // No engine planId at all: the server attributes the value via the
    // deterministic name mention; the document has exactly one verified
    // plan identity, so the P1 ownership proof assigns the same plan.
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [{ planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {},
        evidence: [{ documentId: "doc-1", page: 1, quote: "Alpha's premium is $5" }],
      }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plans).toHaveLength(1);
    expect(body.rows[0].values[0].planId).toBe("alpha");
    expect(body.rows[0].values[0].evidence).toHaveLength(1);
  });

  it("stays unassigned when a server-attributed value's page also declares another plan (ownership void)", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{
      documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1,
      pages: ["Policy name: Alpha\nPolicy name: Beta\nAlpha's premium is $5"],
    }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [
        { planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] },
        { planId: "beta", name: "Beta", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Beta" }] },
      ],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {},
        evidence: [{ documentId: "doc-1", page: 1, quote: "Alpha's premium is $5" }],
      }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    // The cited page declares two plans — unclear section scope; ownership
    // abstains even though the value's own evidence names one plan (C6
    // fail-closed preserved through the page-scope guard).
    expect(body.rows[0].values[0].planId).toBeUndefined();
  });

  it("keeps a server-attributed value when its own quote is the labelled plan/value line", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{
      documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1,
      pages: ["Policy name: Alpha\nPlan name: Alpha; premium: $5"],
    }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [{ planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha" }] }],
      rows: [{ factName: "premium", verdict: "SUPPORTED", values: [{ documentId: "doc-1", display: "$5", qualifiers: {},
        evidence: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha; premium: $5" }],
      }] }],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows[0].values[0].planId).toBe("alpha");
  });

  it("keeps each of a four-document comparison's labelled values attributed to its own plan", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const documents = [
      { documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["Policy name: Alpha\nPlan name: Alpha; premium: $5"] },
      { documentId: "doc-2", filename: "b.pdf", pageCount: 1, pages: ["Policy name: Beta\nPlan name: Beta; premium: $7"] },
      { documentId: "doc-3", filename: "c.pdf", pageCount: 1, pages: ["Policy name: Gamma\nPlan name: Gamma; premium: $9"] },
      { documentId: "doc-4", filename: "d.pdf", pageCount: 1, pages: ["Policy name: Delta\nPlan name: Delta; premium: $11"] },
    ];
    const { session, capability } = createSession(documents, {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1",
      documents: documents.map((d) => ({ documentId: d.documentId, filename: d.filename, pageCount: 1 })),
      rows: [
        { factName: "premium", verdict: "SUPPORTED", values: documents.map((d, i) => ({
          documentId: d.documentId, display: `$${5 + i * 2}`, qualifiers: {},
          evidence: [{ documentId: d.documentId, page: 1, quote: `Plan name: ${["Alpha", "Beta", "Gamma", "Delta"][i]}; premium: $${5 + i * 2}` }],
        })) },
      ],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows[0].values.map((v: { planId?: string }) => v.planId).filter(Boolean)).toHaveLength(4);
  });

  it("publishes a page-verified plan identity with registered evidence", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1, pages: ["Policy name: Alpha covers travel."] }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({
      schemaVersion: "v1", factListVersion: "v1", documents: [{ documentId: "doc-1", filename: "unrelated.pdf", pageCount: 1 }],
      plans: [{ planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Policy name: Alpha…travel." }] }],
      rows: [],
    });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plans[0].sources[0].evidenceId).toMatch(/^ev-/);
    expect(body.plans[0].sources[0].quote).toBe("Policy name: Alpha covers travel.");
  });

  it("derives a stable source-attested identity in normal extraction when the engine returns only v1 rows", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession([{ documentId: "doc-1", filename: "not-the-plan.pdf", pageCount: 1, pages: ["Policy name: Alpha"] }], {});
    created.push(session.sessionId);
    vi.mocked(extractFallback).mockReturnValueOnce({ schemaVersion: "v1", factListVersion: "v1", documents: [{ documentId: "doc-1", filename: "not-the-plan.pdf", pageCount: 1 }], rows: [] });
    const res = await post(session.sessionId, capability);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plans[0].name).toBe("Alpha");
    expect(body.plans[0].sources[0].evidenceId).toMatch(/^ev-/);
  });
});
