import { NextResponse } from "next/server";

type Check = "reachable" | "unreachable" | "unconfigured";

async function withTimeout(path: string, init: RequestInit, ms = 3000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(path, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function supabaseHeaders(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}` };
}

async function checkSupabase(): Promise<Check> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return "unconfigured";
  try {
    const res = await withTimeout(`${url}/rest/v1/`, { headers: supabaseHeaders(key) });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkPgvector(): Promise<Check> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return "unconfigured";
  try {
    // limit=0 returns no chunk data; selecting the vector column verifies the
    // existing pgvector-backed schema without mutating or reading documents.
    const res = await withTimeout(
      `${url}/rest/v1/chunks?select=embedding&limit=0`,
      { headers: supabaseHeaders(key) },
    );
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
      headers: supabaseHeaders(key),
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkEmbeddings(): Promise<Check> {
  const base = process.env.EMBEDDING_BASE_URL?.replace(/\/$/, "");
  const key = process.env.EMBEDDING_API_KEY;
  if (!base || !key) return "unconfigured";
  try {
    // OpenAI-compatible providers expose an authenticated, non-inference
    // models endpoint. The actual embeddings operation is covered by the
    // provider integration probe, not repeated on every readiness request.
    const res = await withTimeout(`${base}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkLlm(): Promise<Check> {
  const base = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const key = process.env.LLM_API_KEY;
  if (!base || !key) return "unconfigured";
  try {
    // Authenticated model listing checks endpoint reachability without
    // generating text or incurring inference work.
    const res = await withTimeout(`${base}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function GET() {
  const [supabase, storage, pgvector, embeddings, llm] = await Promise.all([
    checkSupabase(),
    checkStorage(),
    checkPgvector(),
    checkEmbeddings(),
    checkLlm(),
  ]);
  const checks = { supabase, storage, pgvector, embeddings, llm };
  const ready = Object.values(checks).every((c) => c === "reachable");
  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
