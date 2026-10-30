// Export endpoint: serves the authoritative validated comparison as a PDF.
// Reads the result persisted by /api/extract (comparison_results) and refuses
// stale or missing results with 409 instead of regenerating a different table.
//
// M5 task 19: the export is a same-origin POST carrying the SAME validated
// selection payload as chat (one shared contract, selection-request.ts). The
// selection is validated against the stored result BEFORE anything is built,
// and exactly ONE immutable snapshot (validated table + user context +
// validated selection) is frozen per request; the report is generated from
// that snapshot via the same pure builders the UI uses (buildOverview). The
// UI selection is never persisted and nothing is ever re-extracted.
//
// Requires the existing session capability before any read
// (app/lib/session-auth.ts). Session ID alone is insufficient.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { errorResponse, newRequestId } from "@/app/lib/api-errors";
import {
  comparisonTableFromPayload,
  documentFingerprint,
  loadComparisonResult,
} from "@/app/lib/comparison-result-db";
import {
  buildOverview,
  type OverviewScope,
} from "@/app/lib/extraction/overview";
import {
  parseSelectionRequest,
  selectionMatchesResultFingerprint,
  validateSelectionScope,
} from "@/app/lib/extraction/selection-request";
import { buildReportPdf } from "@/app/lib/report/pdf";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Overview scopes mirror the workspace view exactly: one scope per selected
 *  plan with its tier (null = All tiers). Legacy tables without proven plans
 *  keep the shared document view with a single tier filter when every
 *  selected document shares one tier (their tier keys live in the legacy
 *  map; see selectDocumentTier). */
function overviewScopes(
  table: ReturnType<typeof comparisonTableFromPayload>,
  planIds: string[],
  tiers: Record<string, string | null>,
  legacyTiersByDocument: Record<string, string>,
): OverviewScope[] {
  const tierOf = (planId: string): string | null =>
    tiers[planId] ?? legacyTiersByDocument[planId] ?? null;
  if ((table.plans ?? []).length > 0) {
    return planIds.map((planId) => ({ planId, tier: tierOf(planId) }));
  }
  const tierFilters = planIds.map(tierOf);
  const legacies = new Set(tierFilters.map((t) => t ?? ""));
  return [
    { tier: legacies.size === 1 && tierFilters[0] ? tierFilters[0] : null },
  ];
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    selection?: unknown;
  } | null;
  if (!body?.sessionId) {
    return errorResponse("VALIDATION_ERROR", 400, {
      requestId,
      message: "sessionId required",
    });
  }
  const sessionId = body.sessionId;
  const auth = await requireSessionCapability(request, sessionId);
  if (!auth.ok)
    return auth.errorResponse ?? errorResponse("SESSION_AUTH_REQUIRED", 401);
  const session = getSession(sessionId);
  if (!session) {
    return errorResponse("NOT_FOUND", 404, {
      requestId,
      message: "Unknown session",
    });
  }
  const createdAt = Date.parse(session.createdAt);
  if (
    !Number.isFinite(createdAt) ||
    createdAt > Date.now() ||
    Date.now() - createdAt >= SESSION_LIFETIME_MS
  ) {
    return errorResponse("SESSION_AUTH_REQUIRED", 401);
  }

  // The selection payload uses the SAME contract as chat: opaque fingerprint
  // + plan/tier scope, structurally validated first, then against the stored
  // result BEFORE any report content is derived.
  const selection = parseSelectionRequest(body.selection);
  if (!selection) {
    return errorResponse("VALIDATION_ERROR", 400, {
      requestId,
      message: "Malformed selection payload",
    });
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
      message:
        "Stored result does not match the current documents. Re-run the comparison.",
    });
  }
  if (
    !selectionMatchesResultFingerprint(
      selection,
      record.payload.resultFingerprint,
    )
  ) {
    return errorResponse("STATE_CONFLICT", 409, {
      requestId,
      message:
        "Selection is stale: a newer comparison result exists. Re-run the comparison.",
    });
  }
  const table = comparisonTableFromPayload(record);
  const scopeError = validateSelectionScope(selection, table);
  if (scopeError) {
    if (scopeError === "foreign-plan" || scopeError === "too-many-plans") {
      return errorResponse("BAD_INPUT", 400, {
        requestId,
        message:
          scopeError === "too-many-plans"
            ? "At most three plans can be selected at once."
            : "Selection names a plan outside the verified result.",
      });
    }
    return errorResponse("BAD_INPUT", 400, {
      requestId,
      message:
        scopeError === "unsupported-tier"
          ? "Selection names a tier without verified evidence."
          : "Invalid selection payload.",
    });
  }

  // ONE immutable snapshot per request: the validated table, the stored user
  // context and the validated selection. Overview derivation and the report
  // builder both read this snapshot — no interleaved state can change it
  // mid-build, and nothing here re-extracts or persists UI state.
  const scopes = overviewScopes(
    table,
    selection.planIds,
    selection.tiers,
    selection.legacyTiersByDocument,
  );
  const snapshot = structuredClone({
    table,
    userContext: record.payload.userContext,
    selection,
    contacts: record.payload.contacts,
  });
  const overview = selection.viewMode
    ? undefined
    : buildOverview(snapshot.table, snapshot.userContext, scopes);
  const pdf = await buildReportPdf({ ...snapshot, overview });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="insurance-comparison-${date}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
