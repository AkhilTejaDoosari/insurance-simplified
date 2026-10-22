// Export endpoint: serves the authoritative validated comparison as a PDF.
// Reads the result persisted by /api/extract (comparison_results) and refuses
// stale or missing results with 409 instead of regenerating a different table.
// Requires the existing session capability before any read (app/lib/session-auth.ts).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { errorResponse, newRequestId } from "@/app/lib/api-errors";
import {
  documentFingerprint,
  loadComparisonResult,
  type ComparisonResultRecord,
} from "@/app/lib/comparison-result-db";
import { buildReportPdf } from "@/app/lib/report/pdf";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import type {
  ComparisonTable,
  RegisteredComparisonTable,
} from "@/app/lib/extraction/types";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function registerEvidenceIds(record: ComparisonResultRecord): RegisteredComparisonTable {
  const payload = record.payload;
  return {
    schemaVersion: payload.schemaVersion as "v1",
    factListVersion: payload.factListVersion,
    documents: payload.documents,
    presentationGroups: (payload.presentationGroups ?? []) as RegisteredComparisonTable["presentationGroups"],
    rows: (payload.rows as ComparisonTable["rows"]).map((row) => ({
      ...row,
      values: row.values.map((value) => ({
        ...value,
        evidence: value.evidence.map((e) => withEvidenceId(e)),
      })),
    })),
  };
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "sessionId required" });
  }
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok) return auth.errorResponse ?? errorResponse("SESSION_AUTH_REQUIRED", 401);
  const session = getSession(sessionId);
  if (!session) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }
  const createdAt = Date.parse(session.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > Date.now() || Date.now() - createdAt >= SESSION_LIFETIME_MS) {
    return errorResponse("SESSION_AUTH_REQUIRED", 401);
  }

  const record = await loadComparisonResult(sessionId);
  if (!record) {
    return errorResponse("STATE_CONFLICT", 409, {
      requestId,
      message: "No exportable result for this session. Re-run the comparison.",
    });
  }
  if (record.documentFingerprint !== documentFingerprint(session.documents)) {
    return errorResponse("STATE_CONFLICT", 409, {
      requestId,
      message: "Stored result does not match the current documents. Re-run the comparison.",
    });
  }

  const table = registerEvidenceIds(record);
  const pdf = await buildReportPdf({ table, userContext: record.payload.userContext });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="insurance-comparison-${date}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
