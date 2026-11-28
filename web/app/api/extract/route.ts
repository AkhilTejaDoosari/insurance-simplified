// Extraction endpoint: session documents + context → comparison table v1.
// Picks the best available engine: the LLM whenever LLM_BASE_URL and
// LLM_API_KEY are set, else the deterministic fallback. `engine` in the body
// ("llm" | "fallback") is an explicit override for testing only.
// Output always validated (contracts/comparison-schema.md).
//
// Requires valid session capability (cookie / Authorization: Bearer / x-session-capability).
// Session ID alone is insufficient for authorization.

import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  readDocumentFile,
  registerEvidence,
  updateSessionContext,
} from "@/app/lib/session";
import { EngineError, ENGINE_LIMIT_S, isEngineConfigured, runEngine, type V2Document } from "@/app/lib/engine/client";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
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

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    engine?: string;
    context?: Record<string, string>;
    /** The user agreed, for this request, that Claude may read pages the engine's own
     *  readers can't settle. Relayed to the engine, whose cloud policy still decides. */
    cloudConsent?: boolean;
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

  // WP5: the Python engine, when configured, unless the caller pins another path.
  const useEngine =
    body.engine !== "llm" && body.engine !== "fallback" && isEngineConfigured();
  const useLlm =
    body.engine === "llm" || (body.engine !== "fallback" && isLlmConfigured());

  let engineDocuments: V2Document[] | null = null;
  try {
    const raw = useEngine
      ? await timeAsync("extract.extractViaEngine", async () => {
          const run = await runEngine(
            session.documents,
            (id) => readDocumentFile(session.sessionId, id),
            { cloudConsent: body.cloudConsent === true },
          );
          engineDocuments = registerEngineEvidence(session.sessionId, run.documents);
          return run.table;
        })
      : useLlm
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
            ...(engineDocuments ? { engine: { documents: engineDocuments } } : {}),
          },
        })
      );
    } catch (err) {
      logFailure(requestId, "extract.persist", err);
    }
    return NextResponse.json({
      ...verified,
      ...(engineDocuments ? { engine: { documents: engineDocuments } } : {}),
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
    });
  } catch (err) {
    logFailure(requestId, "extract", err);
    if (err instanceof EngineError && err.code === "ENGINE_TIMEOUT") {
      // the explicit deadline matching the engine's own limit: say so plainly
      return errorResponse("DEPENDENCY_UNAVAILABLE", 504, {
        requestId,
        retryable: true,
        message: `Reading took longer than ${ENGINE_LIMIT_S / 60} minutes, so it was stopped. Nothing was saved. Please try again, or read fewer or shorter documents at a time.`,
      });
    }
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

/** Register every engine quote as session evidence so the viewer can open the
 *  cited page with the exact printed words highlighted (fail-closed there). */
function registerEngineEvidence(sessionId: string, documents: V2Document[]): V2Document[] {
  const entries = documents.flatMap((d) =>
    d.facts.map((f) => ({ documentId: d.documentId, page: f.page, quote: f.quote })),
  );
  registerEvidence(sessionId, entries);
  return documents.map((d) => ({
    ...d,
    facts: d.facts.map((f) => ({
      ...f,
      evidenceId: evidenceIdFor(d.documentId, f.page, f.quote),
    })),
  }));
}
