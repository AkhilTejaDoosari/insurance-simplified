// Read-back adapter for the evidence surfaces used by export and chat.
//
// The stored comparison payload's `surfaces` field is NEVER trusted: surfaces
// shown after read-back are re-derived from this request's re-sealed evidence
// (ConfirmedResult.evidence, see read-back.ts), through the producer's
// `rederiveSurfaces` in app/lib/evidence/surfaces.ts (agent H).
//
// MERGE POINT (coordinator): `rederive` below is the single call site. Until
// the producer lands it returns null: export and chat never show stored
// values (stored entries become "cannot be confirmed" markers). Replace that
// one line with the producer call, e.g.
//   const rederive: Rederive = (input) => rederiveSurfaces(input);

import type { ConfirmedResult } from "@/app/lib/evidence/read-back";
import { SURFACES_SCHEMA, type EvidenceSurfaces, type SurfaceCannotBeConfirmed } from "@/app/lib/evidence/surface-types";
import type { ComparisonResultRecord } from "@/app/lib/comparison-result-db";
import type { ReadBackDocument } from "@/app/lib/evidence/read-back";

export interface ReadBackSurfacesInput {
  sessionId: string;
  documents: readonly ReadBackDocument[];
  record: ComparisonResultRecord;
  /** The request's re-derived result (rows, registry, store, authority). */
  confirmed: ConfirmedResult;
}

type Rederive = (input: ReadBackSurfacesInput) => EvidenceSurfaces | null;

// >>> coordinator: point this line at H's rederiveSurfaces at merge <<<
const rederive: Rederive = () => null;

/** A stored surface list that cannot be re-derived is shown as one
 *  "cannot be confirmed" marker per stored entry: no stored value is used. */
function unconfirmedFromStored(record: ComparisonResultRecord): EvidenceSurfaces | null {
  const stored = (record.payload as { surfaces?: unknown }).surfaces as Partial<EvidenceSurfaces> | undefined;
  if (!stored || typeof stored !== "object" || stored.schema !== SURFACES_SCHEMA) return null;
  const marker = (of: SurfaceCannotBeConfirmed["of"]): SurfaceCannotBeConfirmed => ({
    kind: "cannot-be-confirmed",
    of,
    label: "cannot be confirmed",
  });
  return {
    schema: SURFACES_SCHEMA,
    exclusions: Array.isArray(stored.exclusions) ? stored.exclusions.map(() => marker("exclusion-inventory")) : [],
    authority: Array.isArray(stored.authority) ? stored.authority.map(() => marker("authority")) : [],
  };
}

/** Surfaces re-derived for this request. When re-derivation is impossible
 *  or fails, any stored surfaces become "cannot be confirmed" markers; with
 *  nothing stored, null (no section). */
export function surfacesForReadBack(input: ReadBackSurfacesInput): EvidenceSurfaces | null {
  let derived: EvidenceSurfaces | null = null;
  try {
    derived = input.confirmed.evidence ? rederive(input) : null;
  } catch {
    derived = null;
  }
  return derived ?? unconfirmedFromStored(input.record);
}
