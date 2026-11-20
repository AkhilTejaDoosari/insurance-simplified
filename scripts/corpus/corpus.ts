// Evaluation-corpus manifest model (roadmap M6, quality.md §5).
//
// The TRACKED manifest (evals/manifests/<name>.json) holds only neutral ids,
// sha256, byte size, page count, a generic family and the split. Real
// filenames live in the PRIVATE mapping at
// REAL_FIXTURES_DIR/corpus/<name>.mapping.json (outside git). Nothing here
// reads or stores document text.
//
// Pure functions only; file IO is in scan.ts and the CLIs.

export const MANIFEST_SCHEMA = "corpus-manifest/v1";
export const MAPPING_SCHEMA = "corpus-mapping/v1";

export const SPLITS = ["dev", "validation", "held-out"] as const;
export type Split = (typeof SPLITS)[number];

/** Generic document families. Deliberately a closed list so a source folder
 *  named after an insurer or product can never reach the tracked manifest. */
export const FAMILIES = [
  "sbc",
  "nonstandard",
  "certificate",
  "brochure",
  "rider",
  "rate-sheet",
  "scanned",
  "adversarial",
] as const;
export type Family = (typeof FAMILIES)[number];

export interface ManifestDocument {
  id: string;
  sha256: string;
  bytes: number;
  pages: number;
  family: Family;
  split: Split;
}

export interface SplitState {
  frozen: boolean;
  /** ISO date the split was frozen; null while open. */
  frozenAt: string | null;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  name: string;
  splits: Record<Split, SplitState>;
  documents: ManifestDocument[];
}

export interface MappingEntry {
  id: string;
  /** Path relative to REAL_PDFS_DIR (private: may contain real names). */
  source: string;
  sha256: string;
}

export interface Mapping {
  schema: typeof MAPPING_SCHEMA;
  name: string;
  entries: MappingEntry[];
}

/** One PDF found on disk by the scanner. */
export interface Candidate {
  source: string;
  sha256: string;
  bytes: number;
  pages: number;
  family: Family;
}

export class CorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusError";
  }
}

const ID_RE = /^doc-(\d{3,})$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isSplit(value: string): value is Split {
  return (SPLITS as readonly string[]).includes(value);
}

export function isFamily(value: string): value is Family {
  return (FAMILIES as readonly string[]).includes(value);
}

export function formatId(n: number): string {
  return `doc-${String(n).padStart(3, "0")}`;
}

export function emptyManifest(name: string): Manifest {
  if (!NAME_RE.test(name)) throw new CorpusError(`invalid manifest name "${name}"`);
  return {
    schema: MANIFEST_SCHEMA,
    name,
    splits: {
      dev: { frozen: false, frozenAt: null },
      validation: { frozen: false, frozenAt: null },
      "held-out": { frozen: false, frozenAt: null },
    },
    documents: [],
  };
}

export function emptyMapping(name: string): Mapping {
  return { schema: MAPPING_SCHEMA, name, entries: [] };
}

/** Deterministic serialisation: fixed key order, documents sorted by id. */
export function serializeManifest(m: Manifest): string {
  const out = {
    schema: m.schema,
    name: m.name,
    splits: Object.fromEntries(
      SPLITS.map((s) => [s, { frozen: m.splits[s].frozen, frozenAt: m.splits[s].frozenAt }])
    ),
    documents: [...m.documents]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => ({
        id: d.id,
        sha256: d.sha256,
        bytes: d.bytes,
        pages: d.pages,
        family: d.family,
        split: d.split,
      })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

export function serializeMapping(m: Mapping): string {
  const out = {
    schema: m.schema,
    name: m.name,
    entries: [...m.entries]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, source: e.source, sha256: e.sha256 })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

const DOC_KEYS = ["id", "sha256", "bytes", "pages", "family", "split"];
const TOP_KEYS = ["schema", "name", "splits", "documents"];

function sameKeys(obj: object, keys: string[]): boolean {
  const got = Object.keys(obj).sort();
  return got.length === keys.length && [...keys].sort().every((k, i) => k === got[i]);
}

/**
 * Validates shape and the corpus invariants. Rejects any extra field, so a
 * filename or text field can never be smuggled into the tracked manifest.
 */
export function validateManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== "object") throw new CorpusError("manifest is not an object");
  const m = raw as Manifest;
  if (!sameKeys(m, TOP_KEYS)) throw new CorpusError("manifest has unexpected top-level fields");
  if (m.schema !== MANIFEST_SCHEMA) throw new CorpusError(`unknown manifest schema "${String(m.schema)}"`);
  if (typeof m.name !== "string" || !NAME_RE.test(m.name)) throw new CorpusError("invalid manifest name");
  if (!m.splits || !sameKeys(m.splits, [...SPLITS])) throw new CorpusError("manifest must list exactly the dev, validation and held-out splits");
  for (const s of SPLITS) {
    const st = m.splits[s];
    if (!st || !sameKeys(st, ["frozen", "frozenAt"]) || typeof st.frozen !== "boolean")
      throw new CorpusError(`invalid state for split ${s}`);
    if (st.frozen !== (typeof st.frozenAt === "string")) throw new CorpusError(`split ${s}: frozen and frozenAt disagree`);
  }
  if (!Array.isArray(m.documents)) throw new CorpusError("documents must be an array");
  const ids = new Set<string>();
  const shas = new Map<string, string>();
  for (const d of m.documents) {
    if (!d || typeof d !== "object" || !sameKeys(d, DOC_KEYS)) throw new CorpusError("document entry has unexpected fields");
    if (!ID_RE.test(d.id)) throw new CorpusError(`invalid document id "${String(d.id)}"`);
    if (ids.has(d.id)) throw new CorpusError(`duplicate document id ${d.id}`);
    ids.add(d.id);
    if (!SHA_RE.test(d.sha256)) throw new CorpusError(`${d.id}: invalid sha256`);
    const other = shas.get(d.sha256);
    if (other) throw new CorpusError(`${d.id}: same sha256 as ${other} — identical bytes may not appear twice or across splits`);
    shas.set(d.sha256, d.id);
    if (!Number.isInteger(d.bytes) || d.bytes <= 0) throw new CorpusError(`${d.id}: invalid byte size`);
    if (!Number.isInteger(d.pages) || d.pages <= 0) throw new CorpusError(`${d.id}: invalid page count`);
    if (!isFamily(d.family)) throw new CorpusError(`${d.id}: family must be one of ${FAMILIES.join(", ")}`);
    if (!isSplit(d.split)) throw new CorpusError(`${d.id}: invalid split`);
  }
  return m;
}

export function validateMapping(raw: unknown): Mapping {
  const m = raw as Mapping;
  if (!m || m.schema !== MAPPING_SCHEMA || !Array.isArray(m.entries)) throw new CorpusError("invalid mapping file");
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const e of m.entries) {
    if (!ID_RE.test(e.id) || ids.has(e.id)) throw new CorpusError(`mapping: invalid or duplicate id ${e.id}`);
    if (typeof e.source !== "string" || !e.source || sources.has(e.source)) throw new CorpusError(`mapping: invalid or duplicate source for ${e.id}`);
    if (!SHA_RE.test(e.sha256)) throw new CorpusError(`mapping: invalid sha256 for ${e.id}`);
    ids.add(e.id);
    sources.add(e.source);
  }
  return m;
}

export interface ReconcileResult {
  manifest: Manifest;
  mapping: Mapping;
  added: string[];
  unchanged: string[];
  moved: string[];
  /** Ids whose source file was not found in this scan (kept, never dropped). */
  missing: string[];
}

/**
 * Merge a scan into the existing manifest + mapping.
 *  - Known file, same bytes  → unchanged.
 *  - Known file, new bytes   → CorpusError (never overwritten; re-register deliberately).
 *  - Known bytes, new path   → mapping path updated (file was renamed/moved).
 *  - New bytes               → new neutral id in `newSplit` (must be open).
 *  - Duplicate bytes         → CorpusError.
 *  - Known id not found      → kept; CorpusError if its split is frozen.
 */
export function reconcile(
  manifestIn: Manifest,
  mappingIn: Mapping,
  candidates: Candidate[],
  newSplit: Split | undefined
): ReconcileResult {
  const manifest = validateManifest(structuredClone(manifestIn));
  const mapping = validateMapping(structuredClone(mappingIn));
  if (mapping.name !== manifest.name) throw new CorpusError("mapping and manifest names differ");

  const docs = new Map(manifest.documents.map((d) => [d.id, d]));
  const bySource = new Map(mapping.entries.map((e) => [e.source, e]));
  const byId = new Map(mapping.entries.map((e) => [e.id, e]));
  for (const d of manifest.documents) {
    const e = byId.get(d.id);
    if (!e) throw new CorpusError(`${d.id} has no private mapping entry — mapping and manifest are out of sync`);
    if (e.sha256 !== d.sha256) throw new CorpusError(`${d.id}: mapping and manifest sha256 differ`);
  }
  if (mapping.entries.length !== manifest.documents.length)
    throw new CorpusError("mapping lists ids that are not in the manifest");

  const seenSha = new Map<string, string>();
  for (const c of candidates) {
    if (!SHA_RE.test(c.sha256)) throw new CorpusError("candidate with invalid sha256");
    if (!isFamily(c.family)) throw new CorpusError(`family must be one of ${FAMILIES.join(", ")}`);
    const dup = seenSha.get(c.sha256);
    if (dup !== undefined) throw new CorpusError(`two scanned files have identical bytes (sha256 ${c.sha256.slice(0, 12)}…)`);
    seenSha.set(c.sha256, c.source);
  }

  const shaToId = new Map(manifest.documents.map((d) => [d.sha256, d.id]));
  const scannedSources = new Set(candidates.map((c) => c.source));
  const added: string[] = [];
  const unchanged: string[] = [];
  const moved: string[] = [];
  const fresh: Candidate[] = [];

  for (const c of candidates) {
    const known = bySource.get(c.source);
    if (known) {
      const d = docs.get(known.id)!;
      if (d.sha256 !== c.sha256)
        throw new CorpusError(`${d.id}: bytes changed (sha256 mismatch) — refusing to overwrite; register the new file deliberately`);
      if (d.family !== c.family) throw new CorpusError(`${d.id}: family changed from ${d.family} to ${c.family}`);
      if (d.bytes !== c.bytes || d.pages !== c.pages) throw new CorpusError(`${d.id}: size or page count changed for identical sha256`);
      unchanged.push(d.id);
      continue;
    }
    const idForSha = shaToId.get(c.sha256);
    if (idForSha) {
      const e = byId.get(idForSha)!;
      if (scannedSources.has(e.source))
        throw new CorpusError(`a scanned file duplicates the bytes of ${idForSha}`);
      const d = docs.get(idForSha)!;
      if (d.family !== c.family) throw new CorpusError(`${d.id}: family changed from ${d.family} to ${c.family}`);
      e.source = c.source; // renamed or moved on disk; same bytes
      moved.push(idForSha);
      continue;
    }
    fresh.push(c);
  }

  if (fresh.length > 0) {
    if (!newSplit) throw new CorpusError(`${fresh.length} new document(s) found; pass --split to register them`);
    if (manifest.splits[newSplit].frozen) throw new CorpusError(`split ${newSplit} is frozen; new documents cannot be added to it`);
  }
  let next =
    manifest.documents.reduce((max, d) => Math.max(max, Number(ID_RE.exec(d.id)![1])), 0) + 1;
  // Order by sha256: deterministic and independent of real filenames.
  for (const c of [...fresh].sort((a, b) => a.sha256.localeCompare(b.sha256))) {
    const id = formatId(next++);
    manifest.documents.push({ id, sha256: c.sha256, bytes: c.bytes, pages: c.pages, family: c.family, split: newSplit! });
    mapping.entries.push({ id, source: c.source, sha256: c.sha256 });
    added.push(id);
  }

  const present = new Set([...unchanged, ...moved]);
  const missing = manifestIn.documents.map((d) => d.id).filter((id) => !present.has(id));
  for (const id of missing) {
    const d = docs.get(id)!;
    if (manifest.splits[d.split].frozen) throw new CorpusError(`${id} (frozen split ${d.split}) was not found in this scan`);
  }

  manifest.documents.sort((a, b) => a.id.localeCompare(b.id));
  validateManifest(manifest);
  validateMapping(mapping);
  return { manifest, mapping, added, unchanged, moved, missing };
}

/** Move whole documents between open splits. Pages are never assigned separately. */
export function assignSplit(manifestIn: Manifest, ids: string[], target: Split): Manifest {
  const manifest = validateManifest(structuredClone(manifestIn));
  if (manifest.splits[target].frozen) throw new CorpusError(`split ${target} is frozen; documents cannot be added to it`);
  if (new Set(ids).size !== ids.length) throw new CorpusError("an id is listed twice");
  const docs = new Map(manifest.documents.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = docs.get(id);
    if (!d) throw new CorpusError(`unknown document id ${id}`);
    if (d.split !== target && manifest.splits[d.split].frozen)
      throw new CorpusError(`${id} is in frozen split ${d.split} and cannot be moved`);
  }
  for (const id of ids) docs.get(id)!.split = target;
  return validateManifest(manifest);
}

/** Freeze a split. A frozen split is immutable: no additions, removals or byte changes. */
export function freezeSplit(manifestIn: Manifest, split: Split, date: string): Manifest {
  const manifest = validateManifest(structuredClone(manifestIn));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CorpusError("freeze date must be YYYY-MM-DD");
  if (manifest.splits[split].frozen) throw new CorpusError(`split ${split} is already frozen`);
  if (!manifest.documents.some((d) => d.split === split)) throw new CorpusError(`split ${split} is empty; refusing to freeze`);
  manifest.splits[split] = { frozen: true, frozenAt: date };
  return validateManifest(manifest);
}

/** Every split frozen in `before` must be byte-identical in `after`. */
export function assertFrozenUnchanged(before: Manifest, after: Manifest): void {
  for (const s of SPLITS) {
    if (!before.splits[s].frozen) continue;
    if (!after.splits[s].frozen || after.splits[s].frozenAt !== before.splits[s].frozenAt)
      throw new CorpusError(`split ${s} was frozen and may not be unfrozen`);
    const key = (m: Manifest) =>
      JSON.stringify(m.documents.filter((d) => d.split === s).sort((a, b) => a.id.localeCompare(b.id)));
    if (key(before) !== key(after)) throw new CorpusError(`frozen split ${s} changed`);
  }
}

/** Words the tracked manifest legitimately contains. */
const MANIFEST_VOCAB = new Set(
  [
    ...MANIFEST_SCHEMA.split(/[^a-z0-9]+/),
    ...TOP_KEYS,
    ...DOC_KEYS,
    ...SPLITS.flatMap((s) => s.split("-")),
    ...FAMILIES.flatMap((f) => [f, ...f.split("-")]),
    "frozen",
    "frozenat",
    "true",
    "false",
    "null",
    "doc",
  ].map((w) => w.toLowerCase())
);

/**
 * Count filename fragments (alphanumeric runs of ≥4 characters, excluding
 * the manifest's own vocabulary and pure digits) that occur in the tracked
 * manifest text. sha256 values are removed first so hex runs cannot match.
 * Returns the count only, so callers never print the fragments.
 */
export function countFilenameLeaks(manifestText: string, sources: string[]): number {
  const text = manifestText.toLowerCase().replace(/[0-9a-f]{64}/g, " ");
  const tokens = new Set<string>();
  for (const s of sources) {
    for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 4 && !/^\d+$/.test(t) && !MANIFEST_VOCAB.has(t) && t !== "pdf") tokens.add(t);
    }
  }
  let leaks = 0;
  for (const t of tokens) if (text.includes(t)) leaks++;
  return leaks;
}
