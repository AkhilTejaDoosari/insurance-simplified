// M7 (agent I): a chat answer that touches a service keeps its exclusion
// outcomes as they are and additionally links each named plan's inventory
// coverage state when it is partial / unknown / cannot be confirmed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import type { EvidenceSurfaces } from "@/app/lib/evidence/surface-types";
import { complete, partial, surfaces } from "./helpers/m7i-surfaces";

vi.mock("@/app/lib/rag/answer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/answer")>()),
  answerQuestion: vi.fn(),
  answerQuestionSemantic: vi.fn(),
  answerViaLlm: vi.fn(),
}));
const outcomes = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/app/lib/evidence/exclusion-outcomes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/evidence/exclusion-outcomes")>()),
  resolveExclusionOutcomes: vi.fn(() => []),
  exclusionOutcomeViews: vi.fn(() => outcomes.list),
}));
const readBack = vi.hoisted(() => ({ value: null as EvidenceSurfaces | null }));
vi.mock("@/app/lib/evidence/surfaces-consumer/read-back", () => ({
  surfacesForReadBack: vi.fn(() => readBack.value),
}));

import { POST } from "@/app/api/chat/route";
import { answerQuestionSemantic } from "@/app/lib/rag/answer";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE, type SessionDocument } from "@/app/lib/session";
import {
  deleteComparisonResult,
  documentFingerprint,
  resultFingerprintFor,
  saveComparisonResult,
  type PersistedComparisonResultPayload,
} from "@/app/lib/comparison-result-db";

const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");
const originalEnv = { ...process.env };
const created: string[] = [];
const docs: SessionDocument[] = [
  { documentId: "d1", filename: "plan-a.pdf", pageCount: 6, pages: ["Sample acupuncture is limited.", "", "", "", "", ""] },
  { documentId: "d2", filename: "plan-b.pdf", pageCount: 4, pages: ["Sample text", "", "", ""] },
];

async function ask() {
  const { session, capability } = createSession(docs, {});
  created.push(session.sessionId);
  const payload: PersistedComparisonResultPayload = {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: docs.map(({ documentId, filename, pageCount }) => ({ documentId, filename, pageCount })),
    rows: [],
    contacts: [],
    userContext: {},
  };
  const fingerprint = resultFingerprintFor({ documentFingerprint: documentFingerprint(docs), table: payload, context: {} });
  await saveComparisonResult({ sessionId: session.sessionId, documentFingerprint: documentFingerprint(docs), payload: { ...payload, resultFingerprint: fingerprint } });
  vi.mocked(answerQuestionSemantic).mockResolvedValue({
    schemaVersion: "v1",
    kind: "answer",
    answerText: "Acupuncture is limited.",
    citations: [{ documentId: "d1", page: 1, quote: "Sample acupuncture is limited." }],
  } as never);
  const res = await POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
      body: JSON.stringify({ sessionId: session.sessionId, question: "Is acupuncture covered?", engine: "fallback" }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("m7i chat exclusion coverage", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SECRET_KEY = "";
    process.env.SUPABASE_SERVICE_KEY = "";
    process.env.EMBEDDING_BASE_URL = "";
    process.env.EMBEDDING_API_KEY = "";
    process.env.LLM_BASE_URL = "";
    process.env.LLM_API_KEY = "";
  });
  afterEach(async () => {
    outcomes.list = [];
    readBack.value = null;
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      await deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  const outcome = (documentId: string) => ({ documentId, service: "acupuncture", verdict: "NEEDS VERIFICATION", status: "confirmed", citedProvisionIds: [] });

  it("links a partial inventory of the plan the outcome names; outcomes stay unchanged", async () => {
    outcomes.list = [outcome("d2")];
    readBack.value = surfaces([complete, partial]);
    const body = await ask();
    expect(body.kind).toBe("answer");
    expect(body.exclusionOutcomes).toEqual([outcome("d2")]);
    expect(body.exclusionCoverage).toEqual([
      {
        documentId: "d2",
        planName: "Sample Plan B",
        coverage: "partial",
        text: "Sample Plan B (plan-b.pdf): Pages 3 and 4 could not be read fully — exclusions there may be missing.",
      },
    ]);
  });

  it("adds nothing when the named plan's inventory is complete", async () => {
    outcomes.list = [outcome("d1")];
    readBack.value = surfaces([complete, partial]);
    const body = await ask();
    expect(body.exclusionOutcomes).toEqual([outcome("d1")]);
    expect(body.exclusionCoverage).toBeUndefined();
  });

  it("adds nothing when the answer touches no service", async () => {
    readBack.value = surfaces([partial]);
    const body = await ask();
    expect(body.exclusionOutcomes).toBeUndefined();
    expect(body.exclusionCoverage).toBeUndefined();
  });
});
