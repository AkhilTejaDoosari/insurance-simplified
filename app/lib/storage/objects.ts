// P3-A durable object-storage adapter: persistent PDF bytes behind a
// provider-neutral seam. ADDITIVE ONLY — session-temp files
// (app/lib/session.ts saveDocumentFile/readDocumentFile) are untouched and
// remain the fallback; nothing in the verifier/refusal/provenance path or
// the PDF.js viewer changes.
//
// DURABILITY GAP: session files live under os.tmpdir() and do not survive
// process restarts / tmp eviction. This module stores ORIGINAL bytes in a
// durable object store (local directory by default, Supabase Storage when
// configured) keyed by content hash, while the DB/session metadata stays
// authoritative for object_key + sha256.
//
// TRANSPORT: no new vendor — Supabase is already the chosen platform, so the
// Supabase adapter talks Storage over plain fetch (same pattern as
// app/lib/rag/postgres-vector.ts SupabaseRestVectorClient). No Supabase SDK,
// no `pg` dependency.
//
// LAZINESS: importing this module never touches the network, the filesystem,
// or the environment. Credentials/directories resolve at call time; without
// SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_STORAGE_BUCKET the factory
// falls back to the local store (unit tests assert this). No secrets in code.
//
// BUCKETS ARE NEVER PUBLIC: the Supabase adapter uses the secret key
// server-side only and never generates public URLs — reads go through the
// authenticated app route (app/api/document/...), never a public bucket URL.

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { requireScopeId } from "@/app/lib/rag/ownership";

// ------------------------------------------------------------------ hashing
/** Full lowercase hex sha256 of raw bytes (DB `documents.sha256` format). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** True for a 64-char lowercase hex sha256. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Stable object key derived from the document sha256. Content-addressed, so
 * re-uploads of identical bytes share one object and the key is stable
 * across restarts: `docs/<aa>/<full-hex>.pdf`.
 */
export function objectKeyFor(sha256: string): string {
  if (!isSha256Hex(sha256)) {
    throw new Error("objectKeyFor: sha256 must be 64-char lowercase hex");
  }
  return `docs/${sha256.slice(0, 2)}/${sha256}.pdf`;
}

/** True for keys this module derives (no `..`, no absolute paths, .pdf suffix). */
const OBJECT_KEY_PATTERN = /^docs\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/;
export function isObjectKey(value: unknown): value is string {
  return typeof value === "string" && OBJECT_KEY_PATTERN.test(value);
}

function requireObjectKey(key: unknown, caller: string): string {
  if (!isObjectKey(key)) {
    throw new Error(`${caller}: invalid object key`);
  }
  return key;
}

// -------------------------------------------------------------------- seam
/** Provider-neutral durable byte store for ORIGINAL PDF bytes. */
export interface ObjectStore {
  /** Persist bytes at key (idempotent overwrite of identical bytes). */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Fetch bytes, or undefined when the object does not exist. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** True when the object exists. */
  exists(key: string): Promise<boolean>;
  /** Remove the object; missing keys are a no-op (returns false). */
  delete(key: string): Promise<boolean>;
}

// ------------------------------------------------------- local file store
/**
 * Durable local directory store. Root resolves (in order) from:
 *   1. explicit `dir` constructor option (tests),
 *   2. `OBJECT_STORE_DIR` env (call time, never import time),
 *   3. `<cwd>/data/object-store` (persistent repo data dir).
 *
 * NEVER os.tmpdir(): constructor throws when the resolved root lives inside
 * the system temp directory, so a `/tmp` configuration fails closed instead
 * of silently re-creating the durability gap.
 */
export class LocalFileObjectStore implements ObjectStore {
  private readonly dir: string;

  constructor(dir?: string) {
    const root = resolve(dir ?? process.env.OBJECT_STORE_DIR ?? join(process.cwd(), "data", "object-store"));
    const tmp = resolve(tmpdir());
    if (root === tmp || root.startsWith(tmp + sep)) {
      throw new Error(
        `LocalFileObjectStore: refusing tmp-backed root ${root} — ` +
          "object storage must be durable (outside os.tmpdir())",
      );
    }
    this.dir = root;
  }

  /** Resolved root (tests / diagnostics; no secrets). */
  get rootDir(): string {
    return this.dir;
  }

  private pathFor(key: string, caller: string): string {
    const valid = requireObjectKey(key, caller);
    const full = resolve(join(this.dir, ...valid.split("/")));
    const rel = relative(this.dir, full);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`${caller}: object key escapes store root`);
    }
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const full = this.pathFor(key, "LocalFileObjectStore.put");
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const { readFile } = await import("node:fs/promises");
    let buf: Buffer;
    try {
      buf = await readFile(this.pathFor(key, "LocalFileObjectStore.get"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw err;
    }
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<boolean> {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(this.pathFor(key, "LocalFileObjectStore.delete"));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw err;
    }
  }
}

// ------------------------------------------------- supabase storage adapter
/** Thrown when Supabase Storage is invoked without full configuration. */
export class SupabaseStorageUnconfiguredError extends Error {
  constructor() {
    super(
      "SupabaseStorageAdapter: SUPABASE_URL, SUPABASE_SECRET_KEY and " +
        "SUPABASE_STORAGE_BUCKET are all required — falling back to local storage",
    );
    this.name = "SupabaseStorageUnconfiguredError";
  }
}

export interface SupabaseStorageConfig {
  url: string;
  serviceKey: string;
  bucket: string;
}

/** Null when unconfigured — the honest-skip/fallback signal. Lazy: call, don't cache at import. */
export function resolveSupabaseStorageConfig(env: NodeJS.ProcessEnv = process.env): SupabaseStorageConfig | null {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  if (!url || !serviceKey || !bucket) return null;
  return { url: url.replace(/\/$/, ""), serviceKey, bucket };
}

export function isSupabaseStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSupabaseStorageConfig(env) !== null;
}

function storageHeaders(config: SupabaseStorageConfig): Record<string, string> {
  return {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
  };
}

/**
 * Supabase Storage reports a missing object as HTTP 400 with a
 * `NoSuchKey` payload (not HTTP 404) on the download endpoint. Treat only
 * that precise shape as "missing" — any other 400 still throws.
 */
async function isMissingObject(res: Response): Promise<boolean> {
  try {
    const body = await res.clone().text();
    return body.includes("NoSuchKey");
  } catch {
    return false;
  }
}

/**
 * Supabase Storage adapter over plain fetch (no SDK). Bucket MUST stay
 * private — this adapter never creates public URLs or signed-URL redirects;
 * bytes are served to authorized callers only via the app document route.
 * Importing this module never throws when unconfigured; methods throw
 * SupabaseStorageUnconfiguredError (callers treat that as local-fallback).
 */
export class SupabaseStorageAdapter implements ObjectStore {
  private readonly injectedConfig?: SupabaseStorageConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { config?: SupabaseStorageConfig; fetchImpl?: typeof fetch } = {}) {
    this.injectedConfig = opts.config;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private config(): SupabaseStorageConfig {
    if (this.injectedConfig) return this.injectedConfig;
    const resolved = resolveSupabaseStorageConfig();
    if (!resolved) throw new SupabaseStorageUnconfiguredError();
    return resolved;
  }

  private objectPath(key: string): { config: SupabaseStorageConfig; path: string } {
    const valid = requireObjectKey(key, "SupabaseStorageAdapter");
    const config = this.config();
    return {
      config,
      path: `/storage/v1/object/${encodeURIComponent(config.bucket)}/${valid
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    };
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const { config, path } = this.objectPath(key);
    const body = new Uint8Array(bytes);
    const res = await this.fetchImpl(`${config.url}${path}`, {
      method: "POST",
      headers: {
        ...storageHeaders(config),
        "content-type": "application/pdf",
        "x-upsert": "true",
      },
      body: body as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new Error(`SupabaseStorageAdapter.put ${key} failed with status ${res.status}`);
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const { config, path } = this.objectPath(key);
    const res = await this.fetchImpl(`${config.url}${path}`, {
      headers: storageHeaders(config),
    });
    if (res.status === 404) return undefined;
    if (res.status === 400 && (await isMissingObject(res))) return undefined;
    if (!res.ok) {
      throw new Error(`SupabaseStorageAdapter.get ${key} failed with status ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<boolean> {
    const { config, path } = this.objectPath(key);
    const res = await this.fetchImpl(`${config.url}${path}`, {
      method: "DELETE",
      headers: storageHeaders(config),
    });
    if (res.status === 404) return false;
    if (res.status === 400 && (await isMissingObject(res))) return false;
    if (!res.ok) {
      throw new Error(`SupabaseStorageAdapter.delete ${key} failed with status ${res.status}`);
    }
    return true;
  }
}

// ---------------------------------------------------------------- factory
let defaultStore: ObjectStore | undefined;

/**
 * Default store: Supabase Storage ONLY when SUPABASE_URL + SERVICE_KEY +
 * SUPABASE_STORAGE_BUCKET are all set, otherwise the durable local store.
 * Auth-before-retrieval and scope gating live with the callers (routes pass
 * requireScopeId-checked session ids before touching bytes).
 */
export function resolveObjectStore(): ObjectStore {
  if (isSupabaseStorageConfigured()) return new SupabaseStorageAdapter();
  return new LocalFileObjectStore();
}

/** Lazy singleton for route handlers (resettable in tests). */
export function getDefaultObjectStore(): ObjectStore {
  if (!defaultStore) defaultStore = resolveObjectStore();
  return defaultStore;
}

/** Test seam: clear the cached singleton (no production effect). */
export function resetDefaultObjectStore(): void {
  defaultStore = undefined;
}

/** Test seam: inject a fake store (no production effect). */
export function setDefaultObjectStore(store: ObjectStore | undefined): void {
  defaultStore = store;
}

/**
 * Store ORIGINAL bytes durably and return the stable metadata the DB/session
 * stays authoritative for: content sha256 + derived object key.
 */
export async function putDocumentBytes(
  bytes: Uint8Array,
  store: ObjectStore = getDefaultObjectStore(),
): Promise<{ sha256: string; objectKey: string }> {
  const sha256 = sha256Hex(bytes);
  const objectKey = objectKeyFor(sha256);
  await store.put(objectKey, bytes);
  return { sha256, objectKey };
}

/**
 * Fetch ORIGINAL bytes by metadata. Scope (opaque session id) is validated
 * BEFORE any byte fetch — unscoped callers throw UnscopedQueryError and never
 * reach the store. Returns undefined when the object is missing.
 */
export async function getDocumentBytes(
  scopeId: unknown,
  objectKey: string,
  store: ObjectStore = getDefaultObjectStore(),
): Promise<Uint8Array | undefined> {
  requireScopeId(scopeId, "getDocumentBytes");
  return store.get(requireObjectKey(objectKey, "getDocumentBytes"));
}

/**
 * Delete every object key in the list (missing keys are no-ops). Scope is
 * validated BEFORE any delete — unscoped callers throw and delete nothing.
 */
export async function deleteDocumentObjects(
  scopeId: unknown,
  objectKeys: Array<string | null | undefined>,
  store: ObjectStore = getDefaultObjectStore(),
): Promise<{ deleted: number }> {
  requireScopeId(scopeId, "deleteDocumentObjects");
  let deleted = 0;
  for (const key of objectKeys) {
    if (!key) continue;
    if (await store.delete(requireObjectKey(key, "deleteDocumentObjects"))) deleted++;
  }
  return { deleted };
}
