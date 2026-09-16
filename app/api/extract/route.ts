// Extraction endpoint: session documents + context → comparison table v1.
// Uses the LLM engine when configured (and ?engine=llm), else the
// deterministic fallback. Output always validated (contracts/comparison-schema.md).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
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

  try {
    const table =
      body.engine === "llm"
        ? await extractViaLlm(session.documents, session.userContext)
        : extractFallback(session.documents, session.userContext);
    return NextResponse.json(validateTable(table));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    const status = message.startsWith("LLM") ? 503 : 500;
    return NextResponse.json(
      {
        error: message,
        llmConfigured: isLlmConfigured(),
        hint:
          status === 503
            ? "Set LLM_BASE_URL and LLM_API_KEY, or omit engine to use the built-in extraction."
            : undefined,
      },
      { status }
    );
  }
}
