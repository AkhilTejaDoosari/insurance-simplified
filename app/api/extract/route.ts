// Extraction endpoint: session documents + context → comparison table v1.
// Picks the best available engine: the LLM whenever LLM_BASE_URL and
// LLM_API_KEY are set, else the deterministic fallback. `engine` in the body
// ("llm" | "fallback") is an explicit override for testing only.
// Output always validated (contracts/comparison-schema.md).
//
// Requires valid session capability (cookie / Authorization: Bearer / x-session-capability).
// Session ID alone is insufficient for authorization.

import { NextRequest, NextResponse } from "next/server";
import { getSession, registerEvidence, updateSessionContext } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import { verifyEvidenceCitation, checkDisplayGrounding } from "@/app/lib/evidence-verification";
import type { ComparisonTable } from "@/app/lib/extraction/types";
import {
  extractFallback,
  extractViaLlm,
} from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { isLlmConfigured } from "@/app/lib/llm/client";
import { extractContacts } from "@/app/lib/extraction/contacts";
import { requireSessionCapability } from "@/app/lib/session-auth";
import { errorResponse, logFailure, newRequestId } from "@/app/lib/api-errors";

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
    body.engine === "llm" || (body.engine !== "fallback" && isLlmConfigured());

  try {
    const raw = useLlm
      ? await extractViaLlm(session.documents, session.userContext)
      : extractFallback(session.documents, session.userContext);
    const table = validateTable(raw);
    // Server/session boundary: verify every cited passage against the
    // session documents and canonicalize to verbatim source spans.
    // Fail closed per value — drop unverifiable evidence, drop values left
    // with none, flip emptied rows to NOT STATED. Extraction itself stays
    // session-agnostic and never mints evidence IDs.
    const verifiedRows: ComparisonTable["rows"] = [];
    for (const row of table.rows) {
      const values = [];
      const groundingRationales: string[] = [];
      for (const value of row.values) {
        const evidence = [];
        for (const entry of value.evidence) {
          const verified = verifyEvidenceCitation(session.documents, entry);
          if (verified.ok) evidence.push({ ...entry, quote: verified.quote });
        }
        if (evidence.length === 0) continue;
        const grounding = checkDisplayGrounding(
          value.display,
          row.factName,
          evidence.map((e) => e.quote)
        );
        if (!grounding.supported && grounding.rationale) {
          groundingRationales.push(grounding.rationale);
        }
        values.push({ ...value, evidence });
      }
      if (values.length === 0) {
        const flipped: ComparisonTable["rows"][number] = {
          factName: row.factName,
          verdict: "NOT STATED",
          values: [],
        };
        verifiedRows.push(flipped);
      } else if (groundingRationales.length > 0) {
        const prior = typeof row.rationale === "string" ? `${row.rationale} ` : "";
        verifiedRows.push({
          ...row,
          verdict: "NEEDS VERIFICATION",
          rationale: `${prior}${[...new Set(groundingRationales)].join(" ")}`.trim(),
          values,
        });
      } else {
        verifiedRows.push({ ...row, values });
      }
    }
    const verified: ComparisonTable = { ...table, rows: verifiedRows };
    const contacts = extractContacts(
      session.documents.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        pages: d.pages,
      })),
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
    ]);
    return NextResponse.json({
      ...verified,
      rows: verified.rows.map((row) => ({
        ...row,
        values: row.values.map((value) => ({
          ...value,
          evidence: value.evidence.map(withEvidenceId),
        })),
      })),
      contacts,
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