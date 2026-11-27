// Materiality map — the adapter-data contract for the exclusion applicability
// resolver (evidence-core.md §4 C2: "versioned materiality map"; domain parts
// are adapter data kept outside the core).
//
// This module is domain-neutral: it defines the map's shape, validates it,
// and does literal phrase matching. All domain word lists live in adapter
// files (e.g. `health-materiality.ts`) and are passed in by version.

export interface MaterialityConcept {
  /** Service concept id a question asks about (defined by the adapter). */
  id: string;
  /** Literal phrases that name the concept in source text. */
  terms: readonly string[];
}

export interface MaterialityMap {
  /** Versioned so every resolution records which rules produced it. */
  version: string;
  concepts: readonly MaterialityConcept[];
  /** Phrases that open a carve-out inside an exclusion ("except …"). */
  carveOutMarkers: readonly string[];
  /** Phrases that make an exclusion depend on circumstances the resolver
   *  cannot verify ("if …", "when …"). */
  circumstantialMarkers: readonly string[];
  /** Phrases that expressly lift an exclusion for what follows
   *  ("this exclusion does not apply to …"). */
  expressOverrideMarkers: readonly string[];
}

export function checkMaterialityMap(map: MaterialityMap): { ok: true } | { ok: false; reason: string } {
  if (!map || typeof map.version !== "string" || !map.version.trim()) return { ok: false, reason: "version required" };
  const ids = new Set<string>();
  for (const c of map.concepts ?? []) {
    if (!c || typeof c.id !== "string" || !c.id.trim()) return { ok: false, reason: "concept id required" };
    if (ids.has(c.id)) return { ok: false, reason: `duplicate concept ${c.id}` };
    ids.add(c.id);
    if (!Array.isArray(c.terms) || c.terms.length === 0 || c.terms.some((t) => typeof t !== "string" || !t.trim())) {
      return { ok: false, reason: `concept ${c.id} needs terms` };
    }
  }
  for (const key of ["carveOutMarkers", "circumstantialMarkers", "expressOverrideMarkers"] as const) {
    if (!Array.isArray(map[key]) || map[key].some((t) => typeof t !== "string" || !t.trim())) {
      return { ok: false, reason: `${key} malformed` };
    }
  }
  return { ok: true };
}

export interface PhraseHit {
  start: number;
  end: number;
}

export interface ConceptHit extends PhraseHit {
  conceptId: string;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive, whitespace-tolerant, word-bounded literal occurrences. */
export function phraseHits(text: string, phrase: string): PhraseHit[] {
  const words = phrase.trim().split(/\s+/).map(escape);
  if (words.length === 0 || !words[0]) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[\\s-]+")}(?![\\p{L}\\p{N}])`, "giu");
  return [...text.matchAll(re)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

export function firstHit(text: string, phrases: readonly string[]): PhraseHit | undefined {
  let best: PhraseHit | undefined;
  for (const phrase of phrases) {
    for (const hit of phraseHits(text, phrase)) if (!best || hit.start < best.start) best = hit;
  }
  return best;
}

export function containsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => phraseHits(text, p).length > 0);
}

/** Every concept occurrence in `text`, each marked shadowed when it lies
 *  inside a strictly longer occurrence of a DIFFERENT concept (e.g. a
 *  generic term inside a more specific one). */
export function conceptHits(map: MaterialityMap, text: string): (ConceptHit & { shadowed: boolean })[] {
  const hits: ConceptHit[] = [];
  for (const c of map.concepts) {
    for (const term of c.terms) for (const h of phraseHits(text, term)) hits.push({ ...h, conceptId: c.id });
  }
  return hits.map((h) => ({
    ...h,
    shadowed: hits.some((o) =>
      o.conceptId !== h.conceptId && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start),
  }));
}
