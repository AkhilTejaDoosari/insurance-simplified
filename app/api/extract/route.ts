// Extraction endpoint: session documents + context → comparison table v1.
// Owner decision 2026-11-21: extraction and plan grouping are DETERMINISTIC.
// LLM_* configures the chat model only and never sends document text from
// here. The LLM extraction path runs only on an explicit server-side opt-in
// (EXTRACTION_ENGINE=llm, for evaluation/tests) with a configured provider;
// a client's `engine` field can only force the deterministic reader.
// Output always validated (contracts/comparison-schema.md).
//
// Requires valid session capability (cookie / Authorization: Bearer / x-session-capability).
// Session ID alone is insufficient for authorization.

import { NextRequest, NextResponse } from "next/server";
import { getSession, registerEvidence, updateSessionContext } from "@/app/lib/session";
import { loadSession } from "@/app/lib/session-store";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import type { ComparisonTable } from "@/app/lib/extraction/types";
import {
  extractFallback,
  extractViaLlm,
} from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { isLlmConfigured } from "@/app/lib/llm/client";
import { extractContacts } from "@/app/lib/extraction/contacts";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";
import { timeAsync, timeSync } from "@/app/lib/observability/timing";
import { proposeGroups, sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import {
  documentFingerprint,
  resultFingerprintFor,
  saveComparisonResult,
} from "@/app/lib/comparison-result-db";
import { sealVerifiedTable } from "@/app/lib/evidence/session-evidence";
import { issueRows, renderIssuedRows } from "@/app/lib/evidence/row-resolution";
import { surfaceQuotes, surfacesFor } from "@/app/lib/evidence/surfaces";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    engine?: string;
    context?: Record<string, string>;
  } | null;
  if (!body?.sessionId) {
    return errorResponse("VALIDATION_ERROR", 400, { requestId, message: "sessionId required" });
  }

  // Verify capability before accessing session data
  const auth = await requireSessionCapability(request, body.sessionId);
  if (!auth.ok) {
    return auth.errorResponse!;
  }

  // Read-through: rebuild the instance cache from durable state if this
  // instance has never seen the session (capability verified above).
  if (!(await loadSession(body.sessionId))) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }

  const CONTEXT_FIELDS = [
    "age",
    "countryOrResidency",
    "visaOrStatus",
    "location",
    "coverageDates",
  ] as const;
  if (body.context && typeof body.context === "object") {
    const patch: Record<string, string> = {};
    for (const field of CONTEXT_FIELDS) {
      const value = body.context[field];
      if (typeof value === "string" && value.trim()) {
        patch[field] = value.trim();
      }
    }
    if (Object.keys(patch).length > 0) {
      const updated = updateSessionContext(body.sessionId, patch);
      if (updated) {
        try {
          const { updateSessionContextDb } = await import("@/app/lib/session-db");
          await updateSessionContextDb(body.sessionId, { context: updated.userContext });
        } catch {
          void 0;
        }
      }
    }
  }

  const session = getSession(body.sessionId);
  if (!session) {
    return errorResponse("NOT_FOUND", 404, { requestId, message: "Unknown session" });
  }

  const useLlm =
    process.env.EXTRACTION_ENGINE === "llm" && body.engine !== "fallback" && isLlmConfigured();

  try {
    const raw = useLlm
      ? await timeAsync("extract.extractViaLlm", () =>
          extractViaLlm(session.documents, session.userContext)
        )
      : timeSync("extract.extractFallback", () =>
          extractFallback(session.documents, session.userContext)
        );
    const table = validateTable(raw);
    // Server/session boundary (shared with the evaluation harness): plan
    // source verification, citation canonicalization, table-anchor
    // re-derivation, display grounding, Stage E attribution, noise filter.
    const verified: ComparisonTable = verifyComparisonTable(table, session.documents);
    // Evidence core (evidence-core.md §4): register the session's documents,
    // seal every provable verified value into a request-scoped
    // ProvisionStore, and issue each row as a resolution. Rows reach the
    // response only through the issued-resolution render gate (TB-3).
    const coverage = verified.coverage;
    const sessionEvidence = timeSync("extract.sealProvisions", () =>
      sealVerifiedTable(session.sessionId, session.documents, verified)
    );
    const issuedRows = issueRows(
      sessionEvidence.authority,
      session.sessionId,
      verified.rows,
      sessionEvidence.provisionIdsByRow,
    );
    const rendered = renderIssuedRows(sessionEvidence.authority, session.sessionId, issuedRows);
    // Exclusion inventories and authority views, issued under the same
    // request authority and passed through their render gate.
    const surfaces = timeSync("extract.surfaces", () => surfacesFor(sessionEvidence, session.sessionId));
    const resultFingerprint = resultFingerprintFor({
      documentFingerprint: documentFingerprint(session.documents),
      table: verified,
      context: session.userContext,
    });
    const contacts = timeSync("extract.extractContacts", () =>
      extractContacts(
        session.documents.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          pages: d.pages,
        }))
      )
    );
    registerEvidence(session.sessionId, [
      ...verified.rows.flatMap((row) =>
        row.values.flatMap((value) => value.evidence)
      ),
      ...contacts.map((c) => ({
        documentId: c.documentId,
        page: c.page,
        quote: c.quote,
      })),
      ...(verified.plans?.flatMap((plan) => plan.sources) ?? []),
      // Every quote a surface shows resolves in the viewer.
      ...surfaceQuotes(surfaces),
      // Withheld source lines are shown verbatim with a page link.
      ...verified.rows.flatMap((row) =>
        (row.withheld ?? []).map(({ documentId, page, quote }) => ({ documentId, page, quote }))
      ),
    ]);
    let presentationGroups = sanitizeGroups(null, verified.rows);
    if (useLlm) {
      try {
        presentationGroups = await proposeGroups({
          rows: verified.rows,
          filenames: session.documents.map((document) => document.filename),
          userContext: session.userContext,
        });
      } catch {
        presentationGroups = sanitizeGroups(null, verified.rows);
      }
    }
    try {
      await timeAsync("extract.saveComparisonResult", () =>
        saveComparisonResult({
          sessionId: session.sessionId,
          documentFingerprint: documentFingerprint(session.documents),
          payload: {
            schemaVersion: verified.schemaVersion,
            factListVersion: verified.factListVersion,
            documents: verified.documents,
            ...(verified.plans ? { plans: verified.plans } : {}),
            ...(coverage !== undefined ? { coverage } : {}),
            rows: verified.rows,
            presentationGroups,
            contacts,
            userContext: session.userContext,
            resultFingerprint,
            surfaces,
          },
        })
      );
    } catch (err) {
      logFailure(requestId, "extract.persist", err);
    }
    return NextResponse.json({
      ...verified,
      resultFingerprint,
      ...(verified.plans ? { plans: verified.plans.map((plan) => ({ ...plan, sources: plan.sources.map(withEvidenceId) })) } : {}),
      presentationGroups,
      ...(coverage ? { coverage } : {}),
      rows: rendered.rows.map((row) => ({
        ...row,
        values: row.values.map((value) => ({
          ...value,
          evidence: value.evidence.map(withEvidenceId),
        })),
        ...(row.withheld ? { withheld: row.withheld.map(withEvidenceId) } : {}),
      })),
      contacts,
      surfaces,
    });
  } catch (err) {
    logFailure(requestId, "extract", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    const status = message.startsWith("LLM") ? 503 : 500;
    // Contract: fixed public message only — raw provider text stays server-side.
    return errorResponse(
      status === 503 ? "PROVIDER_UNAVAILABLE" : "EXTRACTION_FAILED",
      status,
      { requestId, retryable: status === 503 }
    );
  }
}
