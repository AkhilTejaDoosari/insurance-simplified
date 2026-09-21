// P3-A integration test: SupabaseStorageAdapter round-trip against live
// Supabase Storage. SKIPS (never fails, never fake-passes) when
// SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_STORAGE_BUCKET are absent.
import { describe, expect, it } from "vitest";
import {
  isSupabaseStorageConfigured,
  objectKeyFor,
  sha256Hex,
  SupabaseStorageAdapter,
} from "@/app/lib/storage/objects";

const configured = isSupabaseStorageConfigured();

describe.skipIf(!configured)("supabase storage round-trip (live bucket, private)", () => {
  it("puts, gets byte-identically, and deletes the object", async () => {
    const store = new SupabaseStorageAdapter();
    const bytes = new TextEncoder().encode(
      `%PDF-it-object-${Date.now().toString(36)} original bytes`,
    );
    const key = objectKeyFor(sha256Hex(bytes));
    try {
      await store.put(key, bytes);
      expect(await store.get(key)).toEqual(bytes);
      expect(await store.exists(key)).toBe(true);
    } finally {
      await store.delete(key);
    }
    expect(await store.get(key)).toBeUndefined();
  });
});
