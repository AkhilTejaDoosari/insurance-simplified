// Shared synthetic fixtures and route helpers for agent-B M7 tests (no real
// PDF text). Not a test file itself.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { POST as extract } from "@/app/api/extract/route";
import { createSession, SESSION_CAPABILITY_COOKIE, type SessionDocument } from "@/app/lib/session";

export const SESSIONS_DIR = join(tmpdir(), "insurance-simplified-sessions");

export const SYNTHETIC_DOCUMENT: SessionDocument = {
  documentId: "doc-m7b",
  filename: "synthetic-plan.pdf",
  pageCount: 2,
  pages: [
    "Plan name: Example Health Silver\nSummary of benefits",
    "Annual deductible: $500 per person\nSpecialist visit: $40 copay\nEmergency room: $250 copay\nCosmetic surgery is not covered.",
  ],
};

export const PROVIDER_ENV = [
  "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY",
  "LLM_BASE_URL", "LLM_API_KEY", "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY",
] as const;

export function blankProviderEnv(): void {
  for (const key of PROVIDER_ENV) process.env[key] = "";
}

export function post(url: string, body: unknown, capability: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
    body: JSON.stringify(body),
  });
}

export async function extractedSession(created: string[], document: SessionDocument = SYNTHETIC_DOCUMENT) {
  const { session, capability } = createSession([structuredClone(document)], {});
  created.push(session.sessionId);
  const res = await extract(post("/api/extract", { sessionId: session.sessionId, engine: "fallback" }, capability));
  if (res.status !== 200) throw new Error(`extract failed: ${res.status}`);
  const table = await res.json();
  return { sessionId: session.sessionId, capability, table };
}

export function selectionFor(table: { resultFingerprint: string; plans?: { planId: string }[]; documents: { documentId: string }[] }) {
  return {
    resultFingerprint: table.resultFingerprint,
    planIds: table.plans?.length ? table.plans.map((p) => p.planId) : table.documents.map((d) => d.documentId),
    tiers: {},
    legacyTiersByDocument: {},
  };
}

export async function pdfText(res: Response): Promise<string> {
  const proxy = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const result = await extractText(proxy, { mergePages: true });
  return Array.isArray(result.text) ? result.text.join(" ") : result.text;
}

/** Simulates an edit to the persisted comparison_results payload (local
 *  store) after the result was issued. The stored fingerprint is left as is. */
export function tamperStoredRow(sessionId: string, factName: string, mutate: (row: Record<string, unknown>) => void): void {
  const path = join(SESSIONS_DIR, `${sessionId}.result.json`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  const row = record.payload.rows.find((r: { factName: string }) => r.factName === factName);
  if (!row) throw new Error(`no stored row ${factName}`);
  mutate(row);
  writeFileSync(path, JSON.stringify(record));
}
