import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  COMPARISON_RESULT_TTL_MS,
  documentFingerprint,
  loadComparisonResult,
  saveComparisonResult,
  deleteComparisonResult,
  isUsable,
  type PersistedComparisonResultPayload,
} from "@/app/lib/comparison-result-db";
import { createSession, deleteSession } from "@/app/lib/session";

const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");

const payload: PersistedComparisonResultPayload = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 2 }],
  rows: [],
  presentationGroups: [],
  contacts: [],
  userContext: { age: "34" },
};

function docs(pages: string[] = ["page one text"], sha256?: string) {
  return [
    { documentId: "doc-1", filename: "a.pdf", pageCount: pages.length, pages, sha256 },
  ];
}

describe("documentFingerprint", () => {
  it("is deterministic and order-independent", () => {
    const a = docs();
    const b = [...a].reverse();
    expect(documentFingerprint(a)).toBe(documentFingerprint(b));
  });

  it("changes when page text or sha256 changes", () => {
    expect(documentFingerprint(docs(["page one"])))
      .not.toBe(documentFingerprint(docs(["page two"])));
    expect(documentFingerprint(docs(["page one"], "a".repeat(64))))
      .not.toBe(documentFingerprint(docs(["page one"], "b".repeat(64))));
    expect(documentFingerprint(docs(["page one"], "a".repeat(64))))
      .toBe(documentFingerprint(docs(["different"], "a".repeat(64))));
  });
});

describe("comparison result persistence (local fallback)", () => {
  const created: string[] = [];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SECRET_KEY = "";
    process.env.SUPABASE_SERVICE_KEY = "";
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      await deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  function ownSession() {
    const { session } = createSession([], {});
    created.push(session.sessionId);
    return session;
  }

  it("saves and loads a READY result with a 30-day expiry", async () => {
    const session = ownSession();
    const fingerprint = documentFingerprint(docs());
    await saveComparisonResult({ sessionId: session.sessionId, documentFingerprint: fingerprint, payload });
    const record = await loadComparisonResult(session.sessionId);
    expect(record?.status).toBe("READY");
    expect(record?.documentFingerprint).toBe(fingerprint);
    expect(record?.payload.userContext).toEqual({ age: "34" });
    const ttl = Date.parse(record!.expiresAt) - Date.parse(record!.updatedAt);
    expect(ttl).toBe(COMPARISON_RESULT_TTL_MS);
  });

  it("treats an expired result as absent", async () => {
    const session = ownSession();
    await saveComparisonResult({
      sessionId: session.sessionId,
      documentFingerprint: documentFingerprint(docs()),
      payload,
    });
    const future = Date.now() + COMPARISON_RESULT_TTL_MS + 1000;
    expect(await loadComparisonResult(session.sessionId, future)).toBeNull();
    const record = await loadComparisonResult(session.sessionId);
    expect(isUsable(record!, future)).toBe(false);
  });

  it("returns null for a session with no stored result", async () => {
    const session = ownSession();
    expect(await loadComparisonResult(session.sessionId)).toBeNull();
  });

  it("refuses an unsafe session id and an invalid fingerprint", async () => {
    await expect(
      saveComparisonResult({ sessionId: "../etc", documentFingerprint: "a".repeat(64), payload }),
    ).rejects.toThrow();
    const session = ownSession();
    await expect(
      saveComparisonResult({ sessionId: session.sessionId, documentFingerprint: "nope", payload }),
    ).rejects.toThrow(/fingerprint/);
  });

  it("deletes both local and durable copies", async () => {
    const session = ownSession();
    await saveComparisonResult({
      sessionId: session.sessionId,
      documentFingerprint: documentFingerprint(docs()),
      payload,
    });
    expect(await loadComparisonResult(session.sessionId)).not.toBeNull();
    await deleteComparisonResult(session.sessionId);
    expect(await loadComparisonResult(session.sessionId)).toBeNull();
  });
});

describe("comparison result persistence (durable)", () => {
  const created: string[] = [];
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://db.example";
    process.env.SUPABASE_SECRET_KEY = "test-service-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    for (const id of created.splice(0)) {
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  });

  function ownSession() {
    const { session } = createSession([], {});
    created.push(session.sessionId);
    return session;
  }

  it("saves a READY row and sweeps expired rows opportunistically", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = ownSession();

    await saveComparisonResult({
      sessionId: session.sessionId,
      documentFingerprint: documentFingerprint(docs()),
      payload,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [upsertUrl, upsertInit] = fetchMock.mock.calls[0];
    expect(upsertUrl).toBe("https://db.example/rest/v1/comparison_results");
    expect(upsertInit.method).toBe("POST");

    const [sweepUrl, sweepInit] = fetchMock.mock.calls[1];
    expect(sweepUrl).toMatch(
      /^https:\/\/db\.example\/rest\/v1\/comparison_results\?expires_at=lt\.\d{4}-\d{2}-\d{2}T/,
    );
    expect(sweepInit.method).toBe("DELETE");
  });

  it("does not fail the save when the opportunistic sweep fails", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 201 }))
      .mockRejectedValueOnce(new Error("comparison-result network down"));
    const session = ownSession();

    await expect(
      saveComparisonResult({
        sessionId: session.sessionId,
        documentFingerprint: documentFingerprint(docs()),
        payload,
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
