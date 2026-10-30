// Mocked /api/extract responses must model the API's registered evidence shape.
// This is synthetic fixture plumbing, not citation verification or production
// evidence registration. Real-route tests continue to exercise real IDs.
import { evidenceIdFor } from "../../app/lib/evidence-ids";
export function registered<T>(fixture: T): T {
  return JSON.parse(JSON.stringify(fixture), (key, value: unknown) => {
    if (key !== "evidence" || !Array.isArray(value)) return value;
    return value.map((e: { documentId: string; page: number; quote: string; evidenceId?: string }) => ({ ...e, evidenceId: e.evidenceId ?? evidenceIdFor(e.documentId, e.page, e.quote) }));
  }) as T;
}
