// M5 task 17: chat validation and scope-before-retrieval.
//
// A selection payload (opaque result fingerprint + plan/tier scope) must be
// validated against the stored validated result BEFORE any retrieval runs,
// and the retrieval corpus must be restricted to the selected scope plus
// evidenced shared policy text. Without a selection, the previous
// whole-session behaviour is unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import {
  createSession,
  deleteSession,
  SESSION_CAPABILITY_COOKIE,
  type SessionDocument,
} from "@/app/lib/session";

const REFUSAL = {
  schemaVersion: "v1" as const,
  kind: "refusal" as const,
  refusalText: "no supporting evidence",
};
vi.mock("@/app/lib/rag/answer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/answer")>()),
  answerViaLlm: vi.fn(async () => REFUSAL),
  answerQuestion: vi.fn(() => REFUSAL),
  answerQuestionSemantic: vi.fn(async () => REFUSAL),
}));

import { POST } from "@/app/api/chat/route";
import { answerQuestionSemantic } from "@/app/lib/rag/answer";
import {
  deleteComparisonResult,
  documentFingerprint,
  saveComparisonResult,
  type PersistedComparisonResultPayload,
} from "@/app/lib/comparison-result-db";

const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");
const created: string[] = [];
const originalEnv = { ...process.env };

// doc-1 mentions BOTH plans (mixed document): selecting WorldTrips must keep
// its WorldTrips and shared lines but drop the Patriot line. doc-2 is pure
// Patriot and disappears entirely unless Patriot is selected or widened.
const documents: SessionDocument[] = [
  {
    documentId: "doc-1",
    filename: "worldtrips.pdf",
    pageCount: 1,
    pages: ["WorldTrips travel plan.\nWorldTrips deductible is $250.\nPatriot rates differ.\nshared: coverage territory worldwide"],
  },
  {
    documentId: "doc-2",
    filename: "patriot.pdf",
    pageCount: 1,
    pages: ["Patriot plan.\nPatriot deductible is $1000."],
  },
];

const plans = [
  {
    planId: "plan-wt",
    name: "WorldTrips",
    sources: [{ documentId: "doc-1", page: 1, quote: "WorldTrips deductible is $250." }],
  },
  {
    planId: "plan-ex",
    name: "Patriot",
    sources: [{ documentId: "doc-2", page: 1, quote: "Patriot deductible is $1000." }],
  },
  // A verified plan whose name never appears in session content: it can never
  // be scoped to a document, but it still competes in mention ambiguity.
  {
    planId: "plan-at",
    name: "Atlas America",
    sources: [{ documentId: "doc-2", page: 1, quote: "Patriot deductible is $1000." }],
  },
];

function payloadWith(resultFingerprint: string): PersistedComparisonResultPayload {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: documents.map(({ documentId, filename, pageCount }) => ({
      documentId, filename, pageCount,
    })),
    plans,
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-wt",
            display: "$250",
            qualifiers: { planTier: "Choice" },
            evidence: [{ documentId: "doc-1", page: 1, quote: "WorldTrips deductible is $250." }],
          },
          {
            documentId: "doc-2",
            planId: "plan-ex",
            display: "$1000",
            qualifiers: {},
            evidence: [{ documentId: "doc-2", page: 1, quote: "Patriot deductible is $1000." }],
          },
        ],
      },
      {
        factName: "coverage-territory",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            display: "worldwide",
            qualifiers: {},
            evidence: [{ documentId: "doc-1", page: 1, quote: "shared: coverage territory worldwide" }],
          },
        ],
      },
    ],
    userContext: {},
    resultFingerprint,
  };
}

function selectionWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resultFingerprint: "fp-1",
    planIds: ["plan-wt"],
    tiers: { "plan-wt": null },
    legacyTiersByDocument: {},
    ...overrides,
  };
}

function seedWithPayload(payload: PersistedComparisonResultPayload) {
  const { session, capability } = createSession(documents, {});
  created.push(session.sessionId);
  process.env.SUPABASE_URL = "";
  void saveComparisonResult({
    sessionId: session.sessionId,
    documentFingerprint: documentFingerprint(session.documents),
    payload,
  });
  return { sessionId: session.sessionId, capability };
}

function post(sessionId: string, capability: string, body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}`,
      },
      body: JSON.stringify({ sessionId, ...body }),
    }),
  );
}

function askedDocuments(): unknown {
  return vi.mocked(answerQuestionSemantic).mock.calls[0]?.[0];
}

describe("POST /api/chat selected-scope validation (task 17)", () => {
  it("keeps explicit individual reading within the active document even when the question names another plan", async () => {
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, { question: "Compare WorldTrips", engine: "fallback", selection: selectionWith({ viewMode: "understand", documentId: "doc-2", planIds: ["plan-ex"] }) });
    expect(res.status).toBe(200);
    const docs = askedDocuments() as { documentId: string; pages: string[] }[];
    expect(docs.map((d) => d.documentId)).toEqual(["doc-2"]);
    expect(JSON.stringify(docs)).not.toContain("WorldTrips");
  });
  it("refuses a foreign active document before invoking retrieval", async () => {
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, { question: "deductible", engine: "fallback", selection: selectionWith({ viewMode: "understand", documentId: "foreign", planIds: [] }) });
    expect(res.status).toBe(400);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });
  it("rejects a returned citation that is session-owned but outside the active view", async () => {
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    vi.mocked(answerQuestionSemantic).mockResolvedValueOnce({ schemaVersion: "v1", kind: "answer", answerText: "WorldTrips deductible is $250.", citations: [{ documentId: "doc-1", page: 1, quote: "WorldTrips deductible is $250." }] });
    const res = await post(sessionId, capability, { question: "deductible", engine: "fallback", selection: selectionWith({ viewMode: "understand", documentId: "doc-2", planIds: ["plan-ex"] }) });
    expect((await res.json()).kind).toBe("refusal");
  });
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      void deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  it("keeps the whole-document behaviour when no selection is sent", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
    });
    expect(res.status).toBe(200);
    const docs = askedDocuments() as { documentId: string }[];
    expect(docs.map((d) => d.documentId)).toEqual(["doc-1", "doc-2"]);
  });

  it("scopes the retrieval corpus to the selected plan before answering", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: selectionWith(),
    });
    expect(res.status).toBe(200);
    const docs = askedDocuments() as { documentId: string; pages: string[] }[];
    // The non-selected Patriot document is out of scope entirely.
    expect(docs.map((d) => d.documentId)).toEqual(["doc-1"]);
    // Within the mixed document, only selected-scope and shared lines remain
    // (verbatim, never rewritten), so citations still verify byte-for-byte.
    expect(docs[0].pages.join("\n")).toContain("WorldTrips deductible is $250.");
    expect(docs[0].pages.join("\n")).toContain("shared: coverage territory worldwide");
    expect(docs[0].pages.join("\n")).not.toContain("Patriot rates differ.");
  });

  it("rejects a selection naming a plan outside the verified result", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: selectionWith({ planIds: ["plan-other"] }),
    });
    expect(res.status).toBe(400);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });

  it("rejects a tier without verified evidence in the stored result", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: selectionWith({ tiers: { "plan-wt": "Platinum" } }),
    });
    expect(res.status).toBe(400);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });

  it("accepts a tier that the stored rows evidence", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "deductible",
      engine: "fallback",
      selection: selectionWith({ tiers: { "plan-wt": "Choice" } }),
    });
    expect(res.status).toBe(200);
    expect(answerQuestionSemantic).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale fingerprint for a replaced result with 409", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-2"));
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: selectionWith({ resultFingerprint: "fp-1" }),
    });
    expect(res.status).toBe(409);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });

  it("rejects a malformed selection payload with 400", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: { planIds: [] },
    });
    expect(res.status).toBe(400);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });

  it("rejects a selection when no stored result exists with 409", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { session, capability } = createSession(documents, {});
    created.push(session.sessionId);
    const res = await post(session.sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: selectionWith(),
    });
    expect(res.status).toBe(409);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });

  it("still requires the session capability before any scope validation", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, "wrong-capability", {
      question: "What is the deductible?",
      engine: "fallback",
      selection: selectionWith(),
    });
    expect(res.status).toBe(401);
    expect(answerQuestionSemantic).not.toHaveBeenCalled();
  });

  it("restricts a legacy (unproven-plan) table to the selected documents", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const legacy: PersistedComparisonResultPayload = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: documents.map(({ documentId, filename, pageCount }) => ({
        documentId, filename, pageCount,
      })),
      rows: [
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250",
              qualifiers: { planTier: "Basic" },
              evidence: [{ documentId: "doc-1", page: 1, quote: "deductible $250" }],
            },
            {
              documentId: "doc-2",
              display: "$1000",
              qualifiers: { planTier: "Standard" },
              evidence: [{ documentId: "doc-2", page: 1, quote: "deductible $1000" }],
            },
          ],
        },
      ],
      userContext: {},
    };
    const { sessionId, capability } = seedWithPayload(legacy);
    const res = await post(sessionId, capability, {
      question: "What is the deductible?",
      engine: "fallback",
      selection: {
        ...selectionWith({ planIds: ["doc-1"] }),
        tiers: {},
        legacyTiersByDocument: { "doc-1": "Basic" },
      },
    });
    expect(res.status).toBe(200);
    const docs = askedDocuments() as { documentId: string }[];
    expect(docs.map((d) => d.documentId)).toEqual(["doc-1"]);
  });

  it("widens scope only when the question explicitly names exactly one other verified plan", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "How does the Patriot compare on deductible?",
      engine: "fallback",
      selection: selectionWith(),
    });
    expect(res.status).toBe(200);
    const docs = askedDocuments() as { documentId: string }[];
    expect(docs.map((d) => d.documentId).sort()).toEqual(["doc-1", "doc-2"]);
  });

  it("never widens for an ambiguous question naming several unselected plans", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const { sessionId, capability } = seedWithPayload(payloadWith("fp-1"));
    const res = await post(sessionId, capability, {
      question: "Compare WorldTrips with Atlas America.",
      engine: "fallback",
      selection: selectionWith({ planIds: ["plan-ex"] }),
    });
    expect(res.status).toBe(200);
    const docs = askedDocuments() as { documentId: string; pages: string[] }[];
    // Two other verified plans are explicitly named, so the widening is
    // ambiguous and stays inside the selected Patriot scope: doc-1 survives
    // only its Patriot/shared lines, never the unselected WorldTrips ones.
    expect(docs.map((d) => d.documentId)).toEqual(["doc-1", "doc-2"]);
    expect(docs[0].pages.join("\n")).not.toContain("WorldTrips deductible is $250.");
    expect(docs[0].pages.join("\n")).toContain("Patriot rates differ.");
  });
});
