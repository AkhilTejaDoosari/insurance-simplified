// P3-C ingestion lifecycle: explicit UPLOADING→PROCESSING→READY/FAILED.
//
// Exactly four states — no QUEUED/EMBEDDING states are invented here. All
// transitions go through transition(src, dst), which throws on any illegal
// pair so illegal flows fail loudly in dev/tests instead of silently
// corrupting status.
//
// Legal transitions (and ONLY these):
//   UPLOADING  → PROCESSING | FAILED
//   PROCESSING → READY | FAILED
// READY and FAILED are terminal: re-upload starts a NEW lifecycle at
// UPLOADING (FAILED→READY without re-upload is illegal), and no state may
// return to UPLOADING once PROCESSING has begun.
//
// Persistence mirror: the documents.status column (db/schema.sql) mirrors
// this state via documentStatusFor(). Pre-lifecycle rows use legacy values
// such as 'active'/'current'/'superseded' (versioning); new ingestion writes
// MUST use the mirrored lowercase lifecycle value so status always reflects
// the lifecycle. stateForDocumentStatus() maps back, returning undefined for
// legacy values rather than inventing a mapping.

export type IngestionState = "UPLOADING" | "PROCESSING" | "READY" | "FAILED";

const LEGAL: Readonly<Record<IngestionState, ReadonlySet<IngestionState>>> = {
  UPLOADING: new Set(["PROCESSING", "FAILED"]),
  PROCESSING: new Set(["READY", "FAILED"]),
  READY: new Set(),
  FAILED: new Set(),
};

export class IllegalIngestionTransitionError extends Error {
  readonly from: IngestionState;
  readonly to: IngestionState;
  constructor(from: IngestionState, to: IngestionState) {
    super(`Illegal ingestion transition: ${from} → ${to}`);
    this.name = "IllegalIngestionTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Centralized transition: returns dst when legal, throws
 * IllegalIngestionTransitionError otherwise.
 */
export function transition(from: IngestionState, to: IngestionState): IngestionState {
  if (LEGAL[from]?.has(to)) return to;
  throw new IllegalIngestionTransitionError(from, to);
}

/** Terminal states: no outgoing transitions (re-upload starts fresh). */
export function isTerminalState(state: IngestionState): boolean {
  return state === "READY" || state === "FAILED";
}

/** documents.status mirror value for a lifecycle state (lowercase). */
export function documentStatusFor(state: IngestionState): string {
  return state.toLowerCase();
}

/**
 * Parse a documents.status value back to a lifecycle state.
 * Returns undefined for legacy/non-lifecycle values (e.g. 'active') —
 * callers must not coerce those into the lifecycle.
 */
export function stateForDocumentStatus(status: string): IngestionState | undefined {
  switch (status) {
    case "uploading":
      return "UPLOADING";
    case "processing":
      return "PROCESSING";
    case "ready":
      return "READY";
    case "failed":
      return "FAILED";
    default:
      return undefined;
  }
}
