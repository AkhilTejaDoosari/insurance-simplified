// P3-A unit tests: durable object-storage adapter. No network, no
// credentials — all green without SUPABASE_* set. Uses a temp dir OUTSIDE
// the assertions (LocalFileObjectStore itself always refuses tmp-backed
// roots; tests use mkdtemp under os.tmpdir only as scratch and assert the
// refusal separately with an explicit tmp path).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteDocumentObjects,
  getDocumentBytes,
  isSupabaseStorageConfigured,
  LocalFileObjectStore,
  objectKeyFor,
  putDocumentBytes,
  resolveObjectStore,
  resolveSupabaseStorageConfig,
  sha256Hex,
  SupabaseStorageAdapter,
  SupabaseStorageUnconfiguredError,
} from "@/app/lib/storage/objects";
import { UnscopedQueryError } from "@/app/lib/rag/ownership";

const SCOPE = "sess-unit-test-scope";

function scratchDir(): string {
  // Durable scratch OUTSIDE os.tmpdir (the store refuses tmp-backed roots by
  // design); isolated per test and removed in afterEach.
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  return mkdtempSync(join(process.cwd(), "data", ".test-scratch-"));
}

describe("sha256Hex + objectKeyFor (stable key derivation)", () => {
  it("derives the well-known sha256 for a fixed input", () => {
    expect(sha256Hex(new Uint8Array([104, 105]))).toBe(
      "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
    );
  });

  it("derives a stable content-addressed key", () => {
    const bytes = new TextEncoder().encode("%PDF-original-bytes");
    const key = objectKeyFor(sha256Hex(bytes));
    expect(key).toMatch(/^docs\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/);
    expect(objectKeyFor(sha256Hex(bytes))).toBe(key);
  });

  it("rejects non-hex sha256 input", () => {
    expect(() => objectKeyFor("not-a-hash")).toThrow();
    expect(() => objectKeyFor("")).toThrow();
  });
});

describe("LocalFileObjectStore (default durable store)", () => {
  let dir: string;
  let store: LocalFileObjectStore;

  beforeEach(() => {
    dir = scratchDir();
    store = new LocalFileObjectStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips put/get byte-identically", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 original content");
    const key = objectKeyFor(sha256Hex(bytes));
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    expect(await store.exists(key)).toBe(true);
  });

  it("uses session-specific keys for identical bytes and keeps both references independently deletable", async () => {
    const bytes = new TextEncoder().encode("same source PDF");
    const first = await putDocumentBytes(bytes, SCOPE, "doc-1", store);
    const sameSessionDuplicate = await putDocumentBytes(bytes, SCOPE, "doc-2", store);
    const second = await putDocumentBytes(bytes, "sess-another-owner", "doc-1", store);

    expect(first.sha256).toBe(second.sha256);
    expect(first.objectKey).not.toBe(second.objectKey);
    expect(first.objectKey).not.toBe(sameSessionDuplicate.objectKey);
    expect(await store.get(first.objectKey)).toEqual(bytes);
    expect(await store.get(second.objectKey)).toEqual(bytes);
    await expect(getDocumentBytes(SCOPE, second.objectKey, store)).rejects.toThrow(/outside the authorized session/);
    await expect(deleteDocumentObjects(SCOPE, [second.objectKey], store)).rejects.toThrow(/outside the authorized session/);

    await deleteDocumentObjects(SCOPE, [first.objectKey], store);
    expect(await store.get(first.objectKey)).toBeUndefined();
    expect(await store.get(sameSessionDuplicate.objectKey)).toEqual(bytes);
    expect(await store.get(second.objectKey)).toEqual(bytes);
  });

  it("refuses to reuse a pre-existing key whose bytes do not match the expected hash", async () => {
    const expected = new TextEncoder().encode("expected original PDF");
    const corrupted = new TextEncoder().encode("different bytes");
    const expectedHash = sha256Hex(expected);
    const scopedKey = `sessions/${SCOPE}/documents/doc-1/${expectedHash.slice(0, 2)}/${expectedHash}.pdf`;
    await store.put(scopedKey, corrupted);

    await expect(putDocumentBytes(expected, SCOPE, "doc-1", store)).rejects.toThrow(/integrity/i);
    expect(await store.get(scopedKey)).toEqual(corrupted);
  });

  it("deduplicates concurrent identical writes without overwriting", async () => {
    const bytes = new TextEncoder().encode("concurrent PDF bytes");
    const results = await Promise.all([
      putDocumentBytes(bytes, SCOPE, "doc-1", store),
      putDocumentBytes(bytes, SCOPE, "doc-1", store),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await store.get(results[0].objectKey)).toEqual(bytes);
  });

  it("delete removes the object; second delete is a no-op false", async () => {
    const bytes = new TextEncoder().encode("delete-me");
    const key = objectKeyFor(sha256Hex(bytes));
    await store.put(key, bytes);
    expect(await store.delete(key)).toBe(true);
    expect(await store.get(key)).toBeUndefined();
    expect(await store.exists(key)).toBe(false);
    expect(await store.delete(key)).toBe(false);
  });

  it("get on a missing key returns undefined (never throws)", async () => {
    const key = objectKeyFor(sha256Hex(new TextEncoder().encode("absent")));
    await expect(store.get(key)).resolves.toBeUndefined();
  });

  it("refuses tmp-backed roots (never re-creates the durability gap)", () => {
    expect(() => new LocalFileObjectStore(join(tmpdir(), "p3a-must-fail"))).toThrow(
      /tmp-backed root/,
    );
  });

  it("rejects keys outside the derived shape", async () => {
    await expect(store.put("../escape.pdf", new Uint8Array([1]))).rejects.toThrow();
    await expect(store.get("docs/ok/not-hex.pdf")).rejects.toThrow();
    await expect(store.get("../escape.pdf")).rejects.toThrow();
  });
});

describe("Supabase adapter configuration (lazy, import never throws)", () => {
  it("resolves null without credentials (honest fallback signal)", () => {
    expect(
      resolveSupabaseStorageConfig({} as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(isSupabaseStorageConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("requires ALL of URL + SECRET_KEY + BUCKET", () => {
    const partial = {
      SUPABASE_URL: "https://xyz.supabase.co",
      SUPABASE_SECRET_KEY: "sk",
    } as unknown as NodeJS.ProcessEnv;
    expect(resolveSupabaseStorageConfig(partial)).toBeNull();
  });

  it("accepts the legacy SERVICE_KEY fallback", () => {
    const legacy = {
      SUPABASE_URL: "https://xyz.supabase.co",
      SUPABASE_SERVICE_KEY: "sk-legacy",
      SUPABASE_STORAGE_BUCKET: "b",
    } as unknown as NodeJS.ProcessEnv;
    expect(resolveSupabaseStorageConfig(legacy)).not.toBeNull();
  });

  it("unconfigured adapter throws SupabaseStorageUnconfiguredError on use (never at import)", async () => {
    const adapter = new SupabaseStorageAdapter({
      fetchImpl: (async () => {
        throw new Error("must not reach network");
      }) as unknown as typeof fetch,
    });
    const key = objectKeyFor(sha256Hex(new TextEncoder().encode("x")));
    const prev = {
      url: process.env.SUPABASE_URL,
      secret: process.env.SUPABASE_SECRET_KEY,
      legacy: process.env.SUPABASE_SERVICE_KEY,
      bucket: process.env.SUPABASE_STORAGE_BUCKET,
    };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    try {
      await expect(adapter.get(key)).rejects.toBeInstanceOf(
        SupabaseStorageUnconfiguredError,
      );
    } finally {
      if (prev.url !== undefined) process.env.SUPABASE_URL = prev.url;
      if (prev.secret !== undefined) process.env.SUPABASE_SECRET_KEY = prev.secret;
      if (prev.legacy !== undefined) process.env.SUPABASE_SERVICE_KEY = prev.legacy;
      if (prev.bucket !== undefined) process.env.SUPABASE_STORAGE_BUCKET = prev.bucket;
    }
  });

  it("fetch-based adapter round-trips against a mocked Storage REST surface (private bucket, no public URLs)", async () => {
    const mem = new Map<string, Uint8Array>();
    const seen: { urls: string[]; auth: Array<string | null> } = { urls: [], auth: [] };
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      seen.urls.push(u);
      const headers = new Headers(init?.headers);
      seen.auth.push(headers.get("authorization"));
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const body = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
        if (mem.has(u)) return new Response("already exists", { status: 409 });
        mem.set(u, body);
        return new Response("{}", { status: 200 });
      }
      if (method === "DELETE") {
        const had = mem.delete(u);
        return new Response("{}", { status: had ? 200 : 404 });
      }
      const hit = mem.get(u);
      if (!hit) return new Response("not found", { status: 404 });
      return new Response(hit as unknown as BodyInit, { status: 200 });
    }) as unknown as typeof fetch;
    const adapter = new SupabaseStorageAdapter({
      config: { url: "https://xyz.supabase.co", serviceKey: "service-key", bucket: "private-docs" },
      fetchImpl,
    });
    const bytes = new TextEncoder().encode("%PDF-supabase-bytes");
    const key = objectKeyFor(sha256Hex(bytes));
    await adapter.put(key, bytes);
    expect(await adapter.get(key)).toEqual(bytes);
    // Private REST object path only — never a public URL.
    expect(seen.urls.every((u) => u.includes("/storage/v1/object/private-docs/"))).toBe(true);
    expect(seen.urls.some((u) => u.includes("/public/"))).toBe(false);
    expect(seen.auth.every((a) => a === "Bearer service-key")).toBe(true);
    expect(await adapter.delete(key)).toBe(true);
    expect(await adapter.get(key)).toBeUndefined();
  });

  it("treats Supabase 400/NoSuchKey as missing (undefined/false), other 400s still throw", async () => {
    const missing = (async () =>
      new Response('{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}', {
        status: 400,
      })) as unknown as typeof fetch;
    const other = (async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;
    const key = objectKeyFor(sha256Hex(new TextEncoder().encode("missing")));
    const missAdapter = new SupabaseStorageAdapter({
      config: { url: "https://xyz.supabase.co", serviceKey: "service-key", bucket: "private-docs" },
      fetchImpl: missing,
    });
    await expect(missAdapter.get(key)).resolves.toBeUndefined();
    await expect(missAdapter.delete(key)).resolves.toBe(false);
    const otherAdapter = new SupabaseStorageAdapter({
      config: { url: "https://xyz.supabase.co", serviceKey: "service-key", bucket: "private-docs" },
      fetchImpl: other,
    });
    await expect(otherAdapter.get(key)).rejects.toThrow("failed with status 400");
  });
});

describe("factory fallback + scoped helpers", () => {
  it("falls back to the local store without Supabase creds", () => {
    const prev = {
      url: process.env.SUPABASE_URL,
      secret: process.env.SUPABASE_SECRET_KEY,
      legacy: process.env.SUPABASE_SERVICE_KEY,
      bucket: process.env.SUPABASE_STORAGE_BUCKET,
    };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    try {
      expect(resolveObjectStore()).toBeInstanceOf(LocalFileObjectStore);
    } finally {
      if (prev.url !== undefined) process.env.SUPABASE_URL = prev.url;
      if (prev.secret !== undefined) process.env.SUPABASE_SECRET_KEY = prev.secret;
      if (prev.legacy !== undefined) process.env.SUPABASE_SERVICE_KEY = prev.legacy;
      if (prev.bucket !== undefined) process.env.SUPABASE_STORAGE_BUCKET = prev.bucket;
    }
  });

  it("putDocumentBytes returns session-scoped sha256+objectKey metadata; get round-trips scoped", async () => {
    const dir = scratchDir();
    try {
      const store = new LocalFileObjectStore(dir);
      const bytes = new TextEncoder().encode("%PDF-scoped-doc");
      const meta = await putDocumentBytes(bytes, SCOPE, "doc-1", store);
      expect(meta.objectKey).toBe(
        `sessions/${SCOPE}/documents/doc-1/${meta.sha256.slice(0, 2)}/${meta.sha256}.pdf`,
      );
      expect(await getDocumentBytes(SCOPE, meta.objectKey, store)).toEqual(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reuses a matching existing private object after a create-only collision", async () => {
    const mem = new Map<string, Uint8Array>();
    let posts = 0;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") {
        posts++;
        const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
        if (mem.has(u)) return new Response("already exists", { status: 409 });
        mem.set(u, body);
        return new Response("{}", { status: 200 });
      }
      const existing = mem.get(u);
      return existing ? new Response(existing as unknown as BodyInit) : new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
    const adapter = new SupabaseStorageAdapter({
      config: { url: "https://xyz.supabase.co", serviceKey: "service-key", bucket: "private-docs" },
      fetchImpl,
    });
    const bytes = new TextEncoder().encode("existing same-session object");
    const [first, second] = await Promise.all([
      putDocumentBytes(bytes, SCOPE, "doc-1", adapter),
      putDocumentBytes(bytes, SCOPE, "doc-1", adapter),
    ]);
    expect(second).toEqual(first);
    expect(posts).toBe(2);
    expect(mem.size).toBe(1);
    expect(mem.values().next().value).toEqual(bytes);
  });

  it("scoped helpers fail closed without a scope id (auth before retrieval/deletion)", async () => {
    const dir = scratchDir();
    try {
      const store = new LocalFileObjectStore(dir);
      const key = objectKeyFor(sha256Hex(new TextEncoder().encode("scoped")));
      await expect(getDocumentBytes("", key, store)).rejects.toBeInstanceOf(UnscopedQueryError);
      await expect(getDocumentBytes("free text PII shaped scope", key, store)).rejects.toBeInstanceOf(
        UnscopedQueryError,
      );
      await expect(deleteDocumentObjects(undefined, [key], store)).rejects.toBeInstanceOf(
        UnscopedQueryError,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deleteDocumentObjects removes listed keys and skips nulls", async () => {
    const dir = scratchDir();
    try {
      const store = new LocalFileObjectStore(dir);
      const a = new TextEncoder().encode("doc-a");
      const b = new TextEncoder().encode("doc-b");
      const ka = objectKeyFor(sha256Hex(a));
      const kb = objectKeyFor(sha256Hex(b));
      await store.put(ka, a);
      await store.put(kb, b);
      expect(await deleteDocumentObjects(SCOPE, [ka, null, undefined, kb], store)).toEqual({
        deleted: 2,
      });
      expect(await store.exists(ka)).toBe(false);
      expect(await store.exists(kb)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no secrets in code: source contains no service keys or bucket URLs", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/lib/storage/objects.ts", "utf8");
    expect(src).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10}/);
    expect(src).not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/);
    // Only env-var reads, never literals. Canonical modern name first
    // (resolver reads env.SUPABASE_SECRET_KEY via injectable env).
    expect(src).toContain("SUPABASE_SECRET_KEY");
  });
});
