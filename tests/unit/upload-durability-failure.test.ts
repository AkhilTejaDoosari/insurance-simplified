import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/session-db", async (original) => ({
  ...(await original<typeof import("@/app/lib/session-db")>()),
  createSessionDb: vi.fn(),
  deleteSessionDb: vi.fn(),
}));
vi.mock("@/app/lib/rag/persist-session", () => ({
  isDurableConfigured: vi.fn(),
  persistSessionUpload: vi.fn(),
}));
vi.mock("@/app/lib/pdf/extract-pages", () => ({
  extractPages: vi.fn(async () => ({
    pageCount: 1,
    pages: ["Annual deductible is $250. ".repeat(20)],
    tables: [],
  })),
}));
vi.mock("@/app/lib/storage/objects", () => ({
  getDefaultObjectStore: vi.fn(() => ({})),
  putDocumentBytes: vi.fn(async () => ({ sha256: "0".repeat(64), objectKey: "test-object" })),
}));

import { POST } from "@/app/api/upload/route";
import { createSessionDb, deleteSessionDb, SessionDbUnconfiguredError } from "@/app/lib/session-db";
import { isDurableConfigured, persistSessionUpload } from "@/app/lib/rag/persist-session";
import * as localSession from "@/app/lib/session";
import { extractPages } from "@/app/lib/pdf/extract-pages";

const SID = "sess-m4-upload-durability";

function request(): NextRequest {
  const form = new FormData();
  form.append("documents", new File(["%PDF-test"], "synthetic-plan.pdf", { type: "application/pdf" }));
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: form });
}

describe("upload requires durable storage, never a tmpdir fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDurableConfigured).mockReturnValue(true);
    vi.mocked(createSessionDb).mockResolvedValue({ sessionId: SID, capability: "test-only-capability", status: "DRAFT" });
    vi.mocked(deleteSessionDb).mockResolvedValue(true);
    vi.mocked(persistSessionUpload).mockResolvedValue([{ documentId: "doc-1", sha256: "0".repeat(64), objectKey: "test-object" }]);
    vi.spyOn(localSession, "createSession");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const result of vi.mocked(localSession.createSession).mock.results) {
      if (result.type === "return") localSession.deleteSession(result.value.session.sessionId);
    }
    vi.restoreAllMocks();
  });

  it("returns retryable 503 before parsing or creating a cache when durability is unconfigured", async () => {
    vi.mocked(isDurableConfigured).mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR", retryable: true } });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(localSession.createSession).not.toHaveBeenCalled();
    expect(createSessionDb).not.toHaveBeenCalled();
    expect(extractPages).not.toHaveBeenCalled();
  });

  it.each([
    ["unconfigured session database", () => new SessionDbUnconfiguredError()],
    ["session database outage", () => new Error("database unavailable")],
  ])("returns retryable 503 without a local session for %s", async (_label, error) => {
    vi.mocked(createSessionDb).mockRejectedValueOnce(error());
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { retryable: true } });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(localSession.createSession).not.toHaveBeenCalled();
    expect(extractPages).not.toHaveBeenCalled();
  });

  it.each([false, true])("returns retryable 503 without writing a cache when persistence fails (cleanup fails: %s)", async (cleanupFails) => {
    vi.mocked(persistSessionUpload).mockRejectedValueOnce(new Error("object storage unavailable"));
    if (cleanupFails) vi.mocked(deleteSessionDb).mockRejectedValueOnce(new Error("cleanup unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { retryable: true } });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(localSession.createSession).not.toHaveBeenCalled();
    expect(localSession.getSession(SID)).toBeUndefined();
    expect(deleteSessionDb).toHaveBeenCalledWith(SID);
  });
});
