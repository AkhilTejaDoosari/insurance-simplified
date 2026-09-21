// PDF intake + validation (FR-001, FR-018, FR-019).
// Accepts 2–4 English PDFs per set; rejects anything else per-file with a
// stated reason. Creates a memory-only session (see app/lib/session.ts).

import { NextRequest, NextResponse } from "next/server";
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

const MIN_FILES = 2;
const MAX_FILES = 4;

const CONTEXT_FIELDS = [
  "age",
  "countryOrResidency",
  "visaOrStatus",
  "location",
  "coverageDates",
] as const;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const files = form.getAll("documents").filter(
    (f): f is File => f instanceof File
  );

  if (files.length < MIN_FILES || files.length > MAX_FILES) {
    return NextResponse.json(
      {
        error: `Upload 2–4 PDF documents per comparison set (received ${files.length}).`,
      },
      { status: 400 }
    );
  }

  const userContext: Record<string, string> = {};
  for (const field of CONTEXT_FIELDS) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim()) {
      userContext[field] = value.trim();
    }
  }

  const documents: {
    documentId: string;
    filename: string;
    pageCount: number;
    pages: string[];
  }[] = [];
  // Raw bytes are kept with the session so citations can open the PDF at a page.
  const rawFiles = new Map<string, Uint8Array>();
  const failures: { filename: string; reason: string }[] = [];

  await Promise.all(
    files.map(async (file, i) => {
      const documentId = `doc-${i + 1}`;
      // P3-B/C: explicit per-file lifecycle (UPLOADING→PROCESSING→READY/FAILED)
      // with the quality gate enforced before anything becomes searchable.
      let state: IngestionState = "UPLOADING";
      try {
        state = transition(state, "PROCESSING");
        const buffer = await file.arrayBuffer();
        const { pageCount, pages } = await extractPages(buffer, file.name);
        const gate = checkExtraction(pages);
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
          // Already terminal — the failure below is what matters.
        }
        void state;
        const classified = classifyExtractorError(err);
        failures.push({ filename: file.name, reason: userVisibleMessage(classified.reason) });
      }
    })
  );

  // Never produce a silent partial comparison: any failure fails the set.
  if (failures.length > 0) {
    return NextResponse.json(
      { error: "One or more files could not be processed.", failures },
      { status: 422 }
    );
  }

  documents.sort((a, b) => a.documentId.localeCompare(b.documentId));
  const session = createSession(documents, userContext);
  // P3-A: durable write first (object store survives restarts), legacy
  // session-temp second (unchanged fallback for the document route + viewer).
  // Object-store failure never fails the upload — temp bytes keep the
  // existing behavior, metadata is recorded only for successful puts.
  const store = getDefaultObjectStore();
  for (const [documentId, bytes] of rawFiles) {
    try {
      const metadata = await putDocumentBytes(bytes, store);
      attachDocumentObjectMetadata(session.sessionId, documentId, metadata);
    } catch {
      // Durability upgrade is best-effort per file; temp fallback below.
    }
    saveDocumentFile(session.sessionId, documentId, bytes);
  }
  // Runtime persistence cutover: when the durable stack is configured the
  // session must NOT become READY until storage + documents/pages/chunks
  // rows all succeed. Durable failure deletes the session and fails
  // explicitly — never a silent temp-only fallback.
  const { isDurableConfigured, persistSessionUpload } = await import(
    "@/app/lib/rag/persist-session"
  );
  if (isDurableConfigured()) {
    try {
      const persisted = await persistSessionUpload(
        session.sessionId,
        documents.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          pages: d.pages,
          bytes: rawFiles.get(d.documentId) ?? new Uint8Array(),
        })),
      );
      for (const meta of persisted) {
        attachDocumentObjectMetadata(session.sessionId, meta.documentId, meta);
      }
    } catch (err) {
      deleteSession(session.sessionId);
      return NextResponse.json(
        {
          error: "Durable persistence failed; upload was not saved.",
          retryable: true,
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json(
    {
      sessionId: session.sessionId,
      documents: documents.map(({ documentId, filename, pageCount }) => ({
        documentId,
        filename,
        pageCount,
      })),
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
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
      return NextResponse.json(
        { error: "Durable vector cleanup failed.", retryable: true, sessionId, pending: ["vectors"] },
        { status: 503 },
      );
    }
    try {
      await deleteDurableObjects(sessionId, objectKeys);
    } catch {
      return NextResponse.json(
        { error: "Durable object cleanup failed.", retryable: true, sessionId, pending: ["objects"] },
        { status: 503 },
      );
    }
  }
  if (!deleteSession(sessionId)) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
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
