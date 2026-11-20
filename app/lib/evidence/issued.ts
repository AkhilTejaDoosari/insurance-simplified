// Issued<Resolution> — evidence-core.md §4 "Issued resolutions", AT-PERSIST.
//
// Only an assessment issued by the resolver through an `EvidenceAuthority`,
// and unaltered since, carries authority. Every rendering surface (comparison
// view-model, chat answer, export) must pass what it renders through
// `checkIssued`; anything altered, issued for another session, issued under
// another authority (e.g. read back from the database), or not issued at all
// is shown as "cannot be confirmed" — never as a conclusion.

import type { EvidenceAuthority, Seal } from "@/app/lib/evidence/canonical";

/** The exact user-facing text for an assessment that cannot be confirmed. */
export const CANNOT_BE_CONFIRMED = "cannot be confirmed" as const;

export interface IssueMeta {
  sessionId: string;
  /** Name/version of the issuing resolver, e.g. "exclusion-resolver@1". */
  issuer: string;
}

export interface Issued<R> {
  readonly resolution: R;
  readonly meta: Readonly<IssueMeta>;
  readonly seal: Seal;
}

export type IssuedCheck<R> =
  | { status: "confirmed"; resolution: R; meta: Readonly<IssueMeta> }
  | { status: "cannot_be_confirmed"; label: typeof CANNOT_BE_CONFIRMED; reason: string };

/** Issue a resolution. Resolver-only: callers outside the resolver must not
 *  issue (they hold no authority object for it). The resolution must be
 *  plain JSON data; it is copied so later caller mutation cannot alter it. */
export function issueResolution<R>(authority: EvidenceAuthority, resolution: R, meta: IssueMeta): Issued<R> {
  if (!meta || typeof meta.sessionId !== "string" || !meta.sessionId.trim()) throw new Error("issueResolution: sessionId required");
  if (typeof meta.issuer !== "string" || !meta.issuer.trim()) throw new Error("issueResolution: issuer required");
  const copy = structuredClone(resolution);
  const frozenMeta = Object.freeze({ sessionId: meta.sessionId, issuer: meta.issuer });
  return Object.freeze({
    resolution: copy,
    meta: frozenMeta,
    seal: authority.seal("resolution", { resolution: copy, meta: frozenMeta }),
  });
}

/** Re-check an issued resolution before rendering it. Accepts `unknown` so
 *  values read back from JSON go through the same gate. */
export function checkIssued<R>(authority: EvidenceAuthority, sessionId: string, candidate: unknown): IssuedCheck<R> {
  const refuse = (reason: string): IssuedCheck<R> => ({ status: "cannot_be_confirmed", label: CANNOT_BE_CONFIRMED, reason });
  if (!candidate || typeof candidate !== "object") return refuse("not an issued resolution");
  const c = candidate as Partial<Issued<R>> & Record<string, unknown>;
  const keys = Object.keys(c).sort().join(",");
  if (keys !== "meta,resolution,seal") return refuse("unexpected fields");
  if (!c.meta || typeof c.meta !== "object") return refuse("missing issue metadata");
  if (c.meta.sessionId !== sessionId) return refuse("issued for another session");
  if (!authority.verify("resolution", { resolution: c.resolution, meta: c.meta }, c.seal)) {
    return refuse("altered after issue or not issued by this authority");
  }
  return { status: "confirmed", resolution: c.resolution as R, meta: c.meta };
}
