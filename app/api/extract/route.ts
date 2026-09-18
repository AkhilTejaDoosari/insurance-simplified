// Extraction endpoint: session documents + context → comparison table v1.
// Picks the best available engine: the LLM whenever LLM_BASE_URL and
// LLM_API_KEY are set, else the deterministic fallback. `engine` in the body
// ("llm" | "fallback") is an explicit override for testing only.
// Output always validated (contracts/comparison-schema.md).

import { NextRequest, NextResponse } from "next/server";
import { getSession, registerEvidence } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import { verifyEvidenceCitation, checkDisplayGrounding } from "@/app/lib/evidence-verification";
import type { ComparisonTable } from "@/app/lib/extraction/types";
import {
  extractFallback,
  extractViaLlm,
} from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { isLlmConfigured } from "@/app/lib/llm/client";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    engine?: string;
  } | null;
  if (!body?.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
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
    registerEvidence(
      session.sessionId,
      verified.rows.flatMap((row) =>
        row.values.flatMap((value) => value.evidence)
      )
    );
    return NextResponse.json({
      ...verified,
      rows: verified.rows.map((row) => ({
        ...row,
        values: row.values.map((value) => ({
          ...value,
          evidence: value.evidence.map(withEvidenceId),
        })),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    const status = message.startsWith("LLM") ? 503 : 500;
    return NextResponse.json(
      {
        error: message,
        llmConfigured: isLlmConfigured(),
        hint:
          status === 503
            ? "Set LLM_BASE_URL and LLM_API_KEY, or send engine: \"fallback\" to use the built-in extraction."
            : undefined,
      },
      { status }
    );
  }
}
