// PDF intake + validation (FR-001, FR-018, FR-019).
// Accepts 2–4 English PDFs per set; rejects anything else per-file with a
// stated reason. Creates a memory-only session (see app/lib/session.ts).

import { NextRequest, NextResponse } from "next/server";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { createSession } from "@/app/lib/session";

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
  const failures: { filename: string; reason: string }[] = [];

  await Promise.all(
    files.map(async (file, i) => {
      const documentId = `doc-${i + 1}`;
      try {
        const buffer = await file.arrayBuffer();
        const { pageCount, pages } = await extractPages(buffer, file.name);
        documents.push({ documentId, filename: file.name, pageCount, pages });
      } catch (err) {
        failures.push({
          filename: file.name,
          reason: err instanceof Error ? err.message : "Could not be read",
        });
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
  if (!deleteSession(sessionId)) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
