// P2 ownership seam (todo 62): every stored chunk/page/document carries an
// owner/scope id, and every retrieval entry point filters by scope.
//
// SCOPE IDS ARE OPAQUE SESSION IDS ONLY (app/lib/session.ts sessionId, e.g.
// `sess-...`). Never store raw user health text, questions, or PII as a
// scope id — the privacy rule from tracing applies here too. Validation
// below rejects anything that does not look like an opaque token (spaces or
// free text fail closed with UnscopedQueryError).
//
// ENFORCEMENT POSTURE (honest): the seam is enforced client-side —
// queryTopK / retrieveFtsCandidate REQUIRE a scope id and throw
// UnscopedQueryError when it is missing/invalid, and the scope id is always
// forwarded as the SQL-level `filter_session` predicate of the match_chunks /
// fts_search_chunks RPCs (db/schema.sql). RLS backs this at the database
// (db/migrations/0003_rls.sql, proven by
// tests/integration/rls-isolation.test.ts) — the seam stays mandatory
// regardless: unscoped calls throw before any client call.

/** Thrown when a persistence/retrieval call lacks a valid owner scope. */
export class UnscopedQueryError extends Error {
  constructor(caller: string) {
    super(
      `${caller}: owner scope (sessionId) is required — unscoped queries ` +
        "never silently search all owners",
    );
    this.name = "UnscopedQueryError";
  }
}

/** Opaque scope ids: short tokens of [A-Za-z0-9-_], no spaces, no sentences. */
const OPAQUE_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_]{0,127}$/;

/** True for opaque session-style scope ids; false for missing/PII-shaped values. */
export function isOpaqueScopeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    OPAQUE_SCOPE_PATTERN.test(value)
  );
}

/**
 * Fail-closed scope gate for every persistence/retrieval entry point. Returns
 * the scope id unchanged when it is an opaque token; throws
 * UnscopedQueryError otherwise (missing, empty, or free-text/PII-shaped).
 */
export function requireScopeId(value: unknown, caller: string): string {
  if (!isOpaqueScopeId(value)) throw new UnscopedQueryError(caller);
  return value;
}
