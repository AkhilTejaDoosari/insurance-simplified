// RAG endpoint: session-scoped Q&A with citations or fixed refusal
// (contracts/chat-api.md). Corpus is the session uploads only — never any
// other source (FR-017).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
  answerQuestion,
  answerViaLlm,
  validateChatResponse,
} from "@/app/lib/rag/answer";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    question?: string;
    engine?: string;
  } | null;
  if (!body?.sessionId || typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "sessionId and question required" }, { status: 400 });
  }
  const session = getSession(body.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  }

  try {
    const response =
      body.engine === "llm"
        ? await answerViaLlm(session.documents, body.question)
        : answerQuestion(session.documents, body.question);
    return NextResponse.json(validateChatResponse(response));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 }
    );
  }
}
