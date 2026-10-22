import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Real path under test: DELETE /api/upload (session close) with durable
// persistence configured. Retention contract (30-day comparison_results):
// closing a session must also remove its durable + local comparison result,
// and a cleanup failure must return 503 retryable WITHOUT deleting the
// session, so the retry keeps every identifier it needs.
vi.mock("@/app/lib/rag/persist-session", () => ({
  isDurableConfigured: vi.fn(() => true),
  persistSessionUpload: vi.fn(async () => []),
  deleteDurableObjects: vi.fn(async () => {}),
  deleteDurableVectors: vi.fn(async () => {}),
}));
vi.mock("@/app/lib/session-db", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/session-db")>(
    "@/app/lib/session-db",
  );
  return {
    ...actual,
    deleteSessionDb: vi.fn(async () => true),
  };
});
vi.mock("@/app/lib/comparison-result-db", () => ({
  deleteComparisonResult: vi.fn(async () => {}),
  loadComparisonResult: vi.fn(async () => null),
  saveComparisonResult: vi.fn(async () => {}),
}));

import { DELETE } from "@/app/api/upload/route";
import { deleteComparisonResult } from "@/app/lib/comparison-result-db";
import { createSession, deleteSession, getSession } from "@/app/lib/session";

const deleteComparisonResultMock = vi.mocked(deleteComparisonResult);

function closeRequest(sessionId: string, capability: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/upload?sessionId=${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: { "x-session-capability": capability } },
  );
}

describe("DELETE /api/upload session close — comparison result retention", () => {
  let sessionId = "";
  let capability = "";

  beforeEach(() => {
    deleteComparisonResultMock.mockReset().mockResolvedValue();
    const created = createSession([], {});
    sessionId = created.session.sessionId;
    capability = created.capability;
  });

  afterEach(() => {
    if (sessionId) deleteSession(sessionId);
  });

  it("removes the durable comparison result on session close", async () => {
    const res = await DELETE(closeRequest(sessionId, capability));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deleteComparisonResultMock).toHaveBeenCalledTimes(1);
    expect(deleteComparisonResultMock).toHaveBeenCalledWith(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
  });

  it("fails closed 503 retryable and keeps the session when cleanup fails", async () => {
    deleteComparisonResultMock.mockRejectedValueOnce(
      new Error("comparison-result postgrest: DELETE failed"),
    );
    const res = await DELETE(closeRequest(sessionId, capability));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR", retryable: true },
    });
    expect(deleteComparisonResultMock).toHaveBeenCalledTimes(1);
    expect(getSession(sessionId)).toBeDefined();
  });
});
