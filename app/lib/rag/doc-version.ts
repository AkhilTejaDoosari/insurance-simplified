// Document version / freshness / authority metadata (P2 Todo 61).
//
// Pure helper only — NOT wired into retrieve() ranking. The survivor
// experiment owns ranking; this module only models version relationships
// so future ranking can prefer current documents deterministically.
//
// Hard rules (never violated):
// - NEVER infer versionhood from content similarity.
// - Version preference applies ONLY when the plan_key + version relationship
//   is deterministically known: exact plan_key match PLUS either effective
//   dates or an explicit superseded_by edge.
// - Authority precedence (certificate > SBC > brochure) applies ONLY as an
//   explicit opt-in rule, never as default inference.
// - Cross-plan differences (different plan_key) are normal comparison data,
//   NOT conflicts — preferCurrent() returns them untouched.

export type DocStatus = "current" | "superseded" | "unknown";

export type SourceType = "certificate" | "sbc" | "brochure" | "other";

export interface DocVersionMeta {
  documentId: string;
  source_type: SourceType;
  /** Opaque plan key. Empty means "no plan identity" — never grouped. */
  plan_key: string;
  version_label?: string;
  /** ISO date strings (YYYY-MM-DD). Used only for deterministic ordering. */
  effective_from?: string;
  effective_to?: string;
  /** Explicit authority rank override (higher wins). Optional. */
  authority_rank?: number;
  document_hash?: string;
  status: DocStatus;
  /** Explicit supersession edge: this doc was superseded by that documentId. */
  superseded_by?: string;
}

/** Authority precedence for the explicit opt-in rule ONLY.
 *  certificate (3) > sbc (2) > brochure (1) > other (0). */
export const AUTHORITY_PRECEDENCE: Record<SourceType, number> = {
  certificate: 3,
  sbc: 2,
  brochure: 1,
  other: 0,
};

function authorityScore(doc: DocVersionMeta): number {
  if (typeof doc.authority_rank === "number" && Number.isFinite(doc.authority_rank)) {
    return doc.authority_rank;
  }
  return AUTHORITY_PRECEDENCE[doc.source_type] ?? 0;
}

function hasUsableDate(doc: DocVersionMeta): boolean {
  return (
    (typeof doc.effective_from === "string" && doc.effective_from.trim() !== "") ||
    (typeof doc.effective_to === "string" && doc.effective_to.trim() !== "")
  );
}

function sameKnownPlan(a: DocVersionMeta, b: DocVersionMeta): boolean {
  return (
    a.plan_key.trim() !== "" &&
    b.plan_key.trim() !== "" &&
    a.plan_key === b.plan_key
  );
}

/** True when the version relationship between a and b is deterministically
 *  known: same exact non-empty plan_key AND (explicit superseded_by edge in
 *  either direction OR both sides carry effective dates). Content similarity
 *  is NEVER consulted. */
export function isDeterministicVersionPair(a: DocVersionMeta, b: DocVersionMeta): boolean {
  if (!sameKnownPlan(a, b)) return false;
  if (a.superseded_by === b.documentId || b.superseded_by === a.documentId) return true;
  if (hasUsableDate(a) && hasUsableDate(b)) return true;
  return false;
}

/** Prefer current / non-superseded documents ONLY when the plan_key + version
 *  relationship is deterministically known. Otherwise returns the input
 *  untouched (same members, same order).
 *
 *  Rules:
 *  - Different plan_key (or empty plan_key) → untouched, always.
 *  - status "unknown" docs are always retained (searchable) unless they are
 *    explicitly superseded via superseded_by pointing at a surviving doc.
 *  - A "superseded" doc is dropped ONLY when a "current" doc survives in the
 *    same deterministic group (same plan_key + dates or superseded_by edge).
 *  - Never drops on content similarity (no such input exists on this type). */
export function preferCurrent(docs: DocVersionMeta[]): DocVersionMeta[] {
  if (docs.length <= 1) return [...docs];
  // Group by exact non-empty plan_key; empty keys each form their own group
  // of one (never grouped, never filtered).
  const groups = new Map<string, DocVersionMeta[]>();
  const ungrouped: DocVersionMeta[] = [];
  for (const d of docs) {
    if (d.plan_key.trim() === "") {
      ungrouped.push(d);
    } else {
      const g = groups.get(d.plan_key) ?? [];
      g.push(d);
      groups.set(d.plan_key, g);
    }
  }
  const out: DocVersionMeta[] = [];
  // Preserve original order: walk input, emit survivors.
  const survivors = new Set<DocVersionMeta>(ungrouped);
  for (const [, group] of groups) {
    if (group.length === 1) {
      survivors.add(group[0]);
      continue;
    }
    // Deterministic group only if EVERY superseded doc in the group has a
    // deterministic link to a surviving current doc. Otherwise keep all.
    const currents = group.filter((d) => d.status === "current");
    if (currents.length === 0) {
      for (const d of group) survivors.add(d);
      continue;
    }
    const deterministicCurrents = currents.filter((c) =>
      group.some((other) => other !== c && isDeterministicVersionPair(c, other))
    );
    if (deterministicCurrents.length === 0) {
      for (const d of group) survivors.add(d);
      continue;
    }
    for (const d of group) {
      if (d.status !== "superseded") {
        survivors.add(d);
        continue;
      }
      // Superseded doc: drop ONLY with a deterministic link to a current doc.
      const linked = deterministicCurrents.some((c) => isDeterministicVersionPair(d, c));
      if (!linked) survivors.add(d);
      // else: dropped (not preferred)
    }
  }
  for (const d of docs) if (survivors.has(d)) out.push(d);
  return out;
}

export interface AuthorityOptions {
  /** Opt-in ONLY. Default false → input order preserved, no re-ranking. */
  applyPrecedence?: boolean;
}

/** Order docs by authority (explicit authority_rank, else the
 *  certificate > sbc > brochure precedence) — ONLY when
 *  `applyPrecedence: true` is passed. Default: returns input untouched. */
export function orderByAuthority(docs: DocVersionMeta[], opts: AuthorityOptions = {}): DocVersionMeta[] {
  if (opts.applyPrecedence !== true) return [...docs];
  return [...docs].sort((a, b) => authorityScore(b) - authorityScore(a));
}
