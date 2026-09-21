import { NextResponse } from "next/server";

type Check = "reachable" | "unreachable" | "unconfigured";

async function withTimeout(path: string, init: RequestInit, ms = 3000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabase(): Promise<Check> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return "unconfigured";
  try {
    const res = await withTimeout(`${url}/rest/v1/`, { headers: { apikey: key } });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkStorage(): Promise<Check> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!url || !key || !bucket) return "unconfigured";
  try {
    const res = await withTimeout(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkEmbeddings(): Promise<Check> {
  const base = process.env.EMBEDDING_BASE_URL?.replace(/\/$/, "");
  if (!base) return "unconfigured";
  try {
    const res = await withTimeout(`${base}/`, {});
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function GET() {
  const [supabase, storage, embeddings] = await Promise.all([
    checkSupabase(),
    checkStorage(),
    checkEmbeddings(),
  ]);
  const checks = { supabase, storage, embeddings };
  const ready = Object.values(checks).every((c) => c !== "unreachable");
  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
