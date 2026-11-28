// When a session's background jobs have all ended, their engine results become the
// session's saved result - the same shape /api/extract saves when it reads synchronously,
// so a reload, the V2 screens and their read-back gate work the same either way.

import type { SessionDocument } from "@/app/lib/session";
import { registerEvidence } from "@/app/lib/session";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import { toComparisonTable, toV2Documents, type V2Document } from "@/app/lib/engine/client";
import { documentFingerprint, resultFingerprintFor, saveComparisonResult } from "@/app/lib/comparison-result-db";
import { FINAL, type Extraction, type Job } from "@/app/lib/jobs/store";

/** True when no job of the session is waiting or running. */
export const allEnded = (jobs: Job[]) => jobs.length > 0 && jobs.every((j) => FINAL.includes(j.status));

export async function assembleAndSave(
  sessionId: string,
  documents: SessionDocument[],
  userContext: Record<string, string>,
  jobs: Job[],
): Promise<V2Document[]> {
  const extractions = new Map<string, Extraction>();
  for (const j of jobs) if (j.status === "completed" && j.result) extractions.set(j.documentId, j.result);
  const done = documents.filter((d) => extractions.has(d.documentId));
  const engineDocuments = toV2Documents(done, extractions).map((d) => ({
    ...d,
    facts: d.facts.map((f) => ({ ...f, evidenceId: evidenceIdFor(d.documentId, f.page, f.quote) })),
  }));
  registerEvidence(
    sessionId,
    engineDocuments.flatMap((d) => d.facts.map((f) => ({ documentId: d.documentId, page: f.page, quote: f.quote }))),
  );
  const table = toComparisonTable(documents, extractions);
  await saveComparisonResult({
    sessionId,
    documentFingerprint: documentFingerprint(documents),
    payload: {
      schemaVersion: table.schemaVersion,
      factListVersion: table.factListVersion,
      documents: table.documents,
      rows: table.rows,
      userContext,
      resultFingerprint: resultFingerprintFor({
        documentFingerprint: documentFingerprint(documents),
        table,
        context: userContext,
      }),
      engine: { documents: engineDocuments },
    },
  });
  return engineDocuments;
}
