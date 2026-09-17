// Extraction endpoint: session documents + context → comparison table v1.
// Picks the best available engine: the LLM whenever LLM_BASE_URL and
// LLM_API_KEY are set, else the deterministic fallback. `engine` in the body
// ("llm" | "fallback") is an explicit override for testing only.
// Output always validated (contracts/comparison-schema.md).

import { NextRequest, NextResponse } from "next/server";
import { getSession, registerEvidence } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
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
    // Server/session boundary: register every cited passage, then return
    // the enriched presentation table. Extraction itself stays
    // session-agnostic and never mints evidence IDs.
    registerEvidence(
      session.sessionId,
      table.rows.flatMap((row) =>
        row.values.flatMap((value) => value.evidence)
      )
    );
    return NextResponse.json({
      ...table,
      rows: table.rows.map((row) => ({
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
