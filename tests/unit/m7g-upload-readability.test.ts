// M7-G: the upload route copies extraction's per-page readability onto the
// session document (EC-10) without changing the response shape.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PageReadability } from "@/app/lib/pdf/page-readability";

const SID = "sess-m7g-upload-readability-1";
const READABILITY: PageReadability[] = [
  { page: 1, status: "read", textChars: 30, hasImages: false },
  { page: 2, status: "unreadable", textChars: 0, hasImages: true },
];

vi.mock("@/app/lib/session-db", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/session-db")>("@/app/lib/session-db");
  return {
    ...actual,
    createSessionDb: vi.fn(async () => ({ sessionId: SID, capability: "m7g-fixture-not-a-credential", status: "DRAFT" as const })),
    deleteSessionDb: vi.fn(async () => true),
  };
});
vi.mock("@/app/lib/pdf/extract-pages", () => ({
  extractPages: vi.fn(async () => ({
    pageCount: 2,
    pages: ["Annual deductible $250 in-network.", ""],
    tables: [],
    readability: READABILITY,
  })),
}));
vi.mock("@/app/lib/ingestion/quality-gate", () => ({
  checkExtraction: vi.fn(() => ({ ok: true })),
  classifyExtractorError: vi.fn(() => ({ reason: "unreadable" })),
  userVisibleMessage: vi.fn(() => "unreadable"),
}));
vi.mock("@/app/lib/storage/objects", () => ({
  getDefaultObjectStore: vi.fn(() => ({})),
  deleteDocumentObjects: vi.fn(async () => {}),
}));
vi.mock("@/app/lib/rag/persist-session", () => ({
  isDurableConfigured: vi.fn(() => true),
  persistSessionUpload: vi.fn(async (_sid: string, documents: { documentId: string }[]) =>
    documents.map(({ documentId }) => ({ documentId, sha256: "0".repeat(64), objectKey: `obj-${documentId}` }))),
  deleteDurableObjects: vi.fn(async () => {}),
  deleteDurableVectors: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/upload/route";
import { deleteSession, getSession } from "@/app/lib/session";

function uploadRequest(): NextRequest {
  const form = new FormData();
  form.append("documents", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "plan.pdf", { type: "application/pdf" }));
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: form });
}

afterEach(() => deleteSession(SID));

describe("POST /api/upload readability wiring", () => {
  it("stores extraction readability on the session document", async () => {
    const res = await POST(uploadRequest());
    expect(res.status).toBe(201);
    expect(getSession(SID)?.documents[0].readability).toEqual(READABILITY);
  });

  it("keeps the response shape unchanged (no readability in the body)", async () => {
    const res = await POST(uploadRequest());
    const body = await res.json();
    expect(body).toEqual({ sessionId: SID, documents: [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 2 }] });
  });
});
