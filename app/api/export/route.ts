// Export endpoint: the SOLE save mechanism (contracts/export-file.md v1).
// Regenerates the comparison + insurer questions for a live session and
// returns them as a downloadable JSON file. No server-side saved state.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { extractFallback } from "@/app/lib/extraction/extract";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  }

  const comparisonTable = extractFallback(session.documents, session.userContext);
  const insurerQuestions = suggestQuestions(comparisonTable);

  const body = {
    schemaVersion: "v1",
    exportedAt: new Date().toISOString(),
    factListVersion: comparisonTable.factListVersion,
    userContext: session.userContext,
    comparisonTable,
    insurerQuestions: insurerQuestions.map((q) => ({
      questionText: q.questionText,
      motivatingFact: q.motivatingFact,
      triggeringVerdict: q.triggeringVerdict,
      documentIds: q.documentIds,
    })),
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="insurance-comparison-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
