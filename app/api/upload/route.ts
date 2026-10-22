// PDF intake + validation (FR-001, FR-018, FR-019).
// Accepts 2–4 English PDFs per set; rejects anything else per-file with a
// stated reason. Creates a durable session in the database with a high-entropy
// capability cookie (see app/lib/session-db.ts, app/lib/session-auth.ts).

import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import {
  attachDocumentObjectMetadata,
  createSession,
  deleteSession,
  getSession,
  saveDocumentFile,
} from "@/app/lib/session";
import {
  deleteDocumentObjects,
  getDefaultObjectStore,
  putDocumentBytes,
} from "@/app/lib/storage/objects";
import {
  checkExtraction,
  classifyExtractorError,
  userVisibleMessage,
} from "@/app/lib/ingestion/quality-gate";
import { transition, type IngestionState } from "@/app/lib/ingestion/lifecycle";
import {
  createSessionDb,
  SessionDbUnconfiguredError,
  SESSION_CAPABILITY_COOKIE,
} from "@/app/lib/session-db";
import { errorResponse, newRequestId } from "@/app/lib/api-errors";
import { recordTiming, timeAsync, timeSync } from "@/app/lib/observability/timing";

const MIN_FILES = 1;
const MAX_FILES = 4;

const CONTEXT_FIELDS = [
  "age",
  "countryOrResidency",
  "visaOrStatus",
  "location",
  "coverageDates",
] as const;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const form = await request.formData();
  const files = form.getAll("documents").filter(
    (f): f is File => f instanceof File
  );

  if (files.length < MIN_FILES || files.length > MAX_FILES) {
    return errorResponse("VALIDATION_ERROR", 400, {
      requestId,
      message: `Upload 1–4 PDF documents (received ${files.length}).`,
    });
  }

  const userContext: Record<string, string> = {};
  for (const field of CONTEXT_FIELDS) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim()) {
      userContext[field] = value.trim();
    }
  }

  // 1. Create durable session FIRST (gets sessionId + capability)
  // Falls back to tmpdir-only mode if durable store is unavailable.
  let sessionId: string;
  let capability: string;
  let durableSession = true;
  try {
    const created = await timeAsync("upload.createSessionDb", () =>
      createSessionDb({ context: userContext })
    );
    sessionId = created.sessionId;
    capability = created.capability;
  } catch (err) {
    if (err instanceof SessionDbUnconfiguredError) {
      durableSession = false;
      const { session, capability: cap, capabilityHash } = createSession([], userContext);
      sessionId = session.sessionId;
      capability = cap;
      // The tmpdir session was created empty; documents will be added after extraction
    } else {
      console.error("[UPLOAD] createSessionDb failed:", err);
      return errorResponse("INTERNAL_ERROR", 500, { requestId, retryable: true });
    }
  }

  // 2. Process files and extract pages
  const documents: {
    documentId: string;
    filename: string;
    pageCount: number;
    pages: string[];
  }[] = [];
  const rawFiles = new Map<string, Uint8Array>();
  const failures: { filename: string; reason: string }[] = [];

  await Promise.all(
    files.map(async (file, i) => {
      const documentId = `doc-${i + 1}`;
      let state: IngestionState = "UPLOADING";
      try {
        state = transition(state, "PROCESSING");
        const buffer = await file.arrayBuffer();
        const { pageCount, pages } = await timeAsync("upload.extractPages", () =>
          extractPages(buffer, file.name),
          { pageCount: 0, filename: file.name }
        );
        const gate = timeSync("upload.checkExtraction", () => checkExtraction(pages));
        if (!gate.ok) {
          state = transition(state, "FAILED");
          failures.push({ filename: file.name, reason: userVisibleMessage(gate.reason) });
          return;
        }
        state = transition(state, "READY");
        documents.push({ documentId, filename: file.name, pageCount, pages });
        rawFiles.set(documentId, new Uint8Array(buffer));
      } catch (err) {
        try {
          state = transition(state, "FAILED");
        } catch {
          // Already terminal
        }
        void state;
        console.error("[UPLOAD] file processing failed:", file.name, err);
        const classified = classifyExtractorError(err);
        failures.push({ filename: file.name, reason: userVisibleMessage(classified.reason) });
      }
    })
  );

  // Never produce a silent partial comparison: any failure fails the set.
  if (failures.length > 0) {
    // Clean up the session we created
    if (durableSession) {
      try {
        await deleteSessionDb(sessionId);
      } catch {
        // Best effort
      }
    } else {
      await deleteSession(sessionId);
    }
    failures.sort((a, b) => a.filename.localeCompare(b.filename));
    return errorResponse("UNPROCESSABLE_DOCUMENTS", 422, {
      requestId,
      message: "One or more files could not be processed.",
      extra: {
        failures: failures.map(({ filename, reason }) => ({ filename, reason })),
      },
    });
  }

  documents.sort((a, b) => a.documentId.localeCompare(b.documentId));

  // 3. Store raw bytes in tmpdir for legacy document route + viewer fallback
  // In durable mode, create tmpdir session with the SAME capability AND sessionId as the DB session.
  // In fallback mode, update the existing empty session.
  let session;
  if (durableSession) {
    const created = createSession(documents, userContext, capability, sessionId);
    session = created.session;
  } else {
    // Update the existing empty tmpdir session with extracted documents
    const existing = getSession(sessionId);
    if (existing) {
      existing.documents = documents;
      existing.userContext = userContext;
      writeFileSync(join(tmpdir(), "insurance-simplified-sessions", `${sessionId}.json`), JSON.stringify(existing));
    }
    session = getSession(sessionId)!;
  }
  const store = getDefaultObjectStore();
  for (const [documentId, bytes] of rawFiles) {
    try {
      const metadata = await timeAsync("upload.putDocumentBytes", () =>
        putDocumentBytes(bytes, store));
      attachDocumentObjectMetadata(session.sessionId, documentId, metadata);
    } catch (err) {
      console.error("[UPLOAD] putDocumentBytes failed:", documentId, err);
      // Durability upgrade is best-effort per file; temp fallback below.
    }
    saveDocumentFile(session.sessionId, documentId, bytes);
  }

  // 4. Persist to durable storage (documents, pages, chunks, vectors)
  if (durableSession) {
    const { isDurableConfigured, persistSessionUpload } = await import(
      "@/app/lib/rag/persist-session"
    );
    if (isDurableConfigured()) {
      try {
        const persisted = await timeAsync("upload.persistSessionUpload", () =>
          persistSessionUpload(
            sessionId,
            documents.map((d) => ({
              documentId: d.documentId,
              filename: d.filename,
              pages: d.pages,
              bytes: rawFiles.get(d.documentId) ?? new Uint8Array(),
            }))
          )
        );
        for (const meta of persisted) {
          attachDocumentObjectMetadata(session.sessionId, meta.documentId, meta);
        }
      } catch (err) {
        console.error("[UPLOAD] persistSessionUpload failed:", err);
        await deleteSessionDb(sessionId);
        await deleteSession(session.sessionId);
        return errorResponse("INTERNAL_ERROR", 503, {
          requestId,
          retryable: true,
          message: "Durable persistence failed; upload was not saved.",
        });
      }
    }
  }

  // 5. Return response with capability cookie
  const response = NextResponse.json(
    {
      sessionId,
      documents: documents.map(({ documentId, filename, pageCount }) => ({
        documentId,
        filename,
        pageCount,
      })),
    },
    { status: 201 },
  );

  response.cookies.set(SESSION_CAPABILITY_COOKIE, capability, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

// Import deleteSessionDb for the error cleanup path
import { deleteSessionDb } from "@/app/lib/session-db";

export async function DELETE(request: NextRequest) {
  const requestId = newRequestId();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "sessionId required" });
  }

  // Verify capability before allowing deletion
  const { requireSessionCapability } = await import("@/app/lib/session-auth");
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok) {
    return auth.errorResponse!;
  }

  const { deleteSession } = await import("@/app/lib/session");
  // Snapshot object keys BEFORE metadata removal so every durable object is
  // cleaned up alongside metadata + chunks/vectors (existing seam below).
  const snapshot = getSession(sessionId)?.documents ?? [];
  const objectKeys = snapshot
    .map((d) => d.objectKey)
    .filter((k): k is string => typeof k === "string");

  // Runtime persistence cutover: durable cleanup runs BEFORE metadata
  // removal so a failed step keeps every identifier needed for retry.
  const { isDurableConfigured, deleteDurableObjects, deleteDurableVectors } = await import(
    "@/app/lib/rag/persist-session"
  );
  if (isDurableConfigured()) {
    try {
      await deleteDurableVectors(sessionId);
    } catch {
      return errorResponse("INTERNAL_ERROR", 503, {
        requestId,
        retryable: true,
        message: "Durable vector cleanup failed.",
      });
    }
    try {
      await deleteDurableObjects(sessionId, objectKeys);
    } catch {
      return errorResponse("INTERNAL_ERROR", 503, {
        requestId,
        retryable: true,
        message: "Durable object cleanup failed.",
      });
    }
    try {
      await deleteSessionDb(sessionId);
    } catch {
      return errorResponse("INTERNAL_ERROR", 503, {
        requestId,
        retryable: true,
        message: "Durable session cleanup failed.",
      });
    }
    try {
      const { deleteComparisonResult } = await import(
        "@/app/lib/comparison-result-db"
      );
      await deleteComparisonResult(sessionId);
    } catch {
      return errorResponse("INTERNAL_ERROR", 503, {
        requestId,
        retryable: true,
        message: "Comparison result cleanup failed.",
      });
    }
  }

  if (!deleteSession(sessionId)) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }

  if (isDurableConfigured()) {
    return NextResponse.json({ deleted: true });
  }

  // Legacy temp-only path: object + vector deletes stay best-effort so a
  // store outage never masks the authoritative metadata delete above.
  try {
    await deleteDocumentObjects(sessionId, objectKeys, getDefaultObjectStore());
  } catch {
    // Authoritative metadata delete above already succeeded.
  }
  try {
    const { PostgresVectorStore, isPostgresConfigured } = await import(
      "@/app/lib/rag/postgres-vector"
    );
    if (isPostgresConfigured()) {
      await new PostgresVectorStore().deleteSession(sessionId);
    }
  } catch {
    // Vector cleanup is best-effort; session metadata is already gone.
  }
  return NextResponse.json({ deleted: true });
}
