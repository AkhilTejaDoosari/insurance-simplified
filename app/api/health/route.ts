import { NextResponse } from "next/server";

type DbStatus = "reachable" | "unconfigured";

async function checkDb(): Promise<DbStatus> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return "unconfigured";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
        headers: { apikey: key },
        signal: controller.signal,
      });
      await res.body?.cancel().catch(() => undefined);
      return "reachable";
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return "unconfigured";
  }
}

export async function GET() {
  const db = await checkDb();
  return NextResponse.json({ ok: true, checks: { db } });
}
