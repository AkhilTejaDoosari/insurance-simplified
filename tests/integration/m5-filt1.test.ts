// FILT-1 (docs/quality.md §4, roadmap M5): per-session top-k completeness of
// the pgvector semantic leg with 1,000 seeded sessions.
//
// For a target session, the deployed match_chunks RPC (through the
// PostgresVectorStore adapter) must return exactly the true top-k of THAT
// session's chunks — the same answer an exact per-session cosine scan gives —
// and never a chunk owned by another session. An approximate HNSW scan with a
// post-filter on owner_session fails this: the index returns the globally
// nearest neighbours, the session filter discards most of them, and the
// session's own best chunks never surface (incomplete or empty top-k).
//
// Vectors are synthetic and deterministic (seeded PRNG); no provider is called
// and no document text is real. SKIPS (never fake-passes) without
// SUPABASE_URL / SUPABASE_SECRET_KEY, following postgres-vector.test.ts.
//
// Reproduce: start a local stack (scripts/e2e-local-supabase.sh), source the
// env file it writes, then `npx vitest run tests/integration/m5-filt1.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSION,
  isPostgresConfigured,
  PostgresVectorStore,
  rankByCosine,
  type RankableRecord,
} from "@/app/lib/rag/postgres-vector";

const configured = isPostgresConfigured();

const N_SESSIONS = 1000;
const DOCS_PER_SESSION = 2;
const CHUNKS_PER_DOC = 5;
const CHUNKS_PER_SESSION = DOCS_PER_SESSION * CHUNKS_PER_DOC;
const TARGET_STRIDE = 40; // 25 target sessions spread over the seeded set
const KS = [5, 10, 40];
const SCORE_EPS = 1e-5;

function restConfig(): { url: string; serviceKey: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey)
    throw new Error("FILT-1 requires Supabase credentials");
  return { url, serviceKey };
}

async function rest(path: string, init: RequestInit): Promise<void> {
  const { url, serviceKey } = restConfig();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
  });
  if (!res.ok)
    throw new Error(
      `FILT-1 setup: ${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status}`,
    );
}

// mulberry32: tiny deterministic PRNG so every run seeds identical vectors.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vectorFor(seed: number): number[] {
  const next = prng(seed);
  // 3 decimals keeps the REST payload small; float4 storage is exact enough
  // for the SCORE_EPS tie tolerance below.
  return Array.from(
    { length: EMBEDDING_DIMENSION },
    () => Math.round((next() * 2 - 1) * 1000) / 1000,
  );
}

const RUN = `filt1-${Date.now().toString(36)}`;
const sessionId = (s: number) => `${RUN}-s${String(s).padStart(4, "0")}`;
const documentId = (s: number, d: number) => `${sessionId(s)}-d${d}`;
const chunkId = (s: number, d: number, c: number) =>
  `${documentId(s, d)}-c${c}`;

const recordsBySession = new Map<string, RankableRecord[]>();
const targets = Array.from(
  { length: N_SESSIONS / TARGET_STRIDE },
  (_, i) => i * TARGET_STRIDE + 7,
);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

describe.skipIf(!configured)(
  "FILT-1 per-session top-k completeness (1,000 seeded sessions)",
  () => {
    beforeAll(async () => {
      const docs: object[] = [];
      const rows: object[] = [];
      for (let s = 0; s < N_SESSIONS; s++) {
        const records: RankableRecord[] = [];
        for (let d = 0; d < DOCS_PER_SESSION; d++) {
          docs.push({
            id: documentId(s, d),
            owner_session: sessionId(s),
            filename: `synthetic-${s}-${d}.pdf`,
            sha256: "0".repeat(64),
            status: "active",
          });
          for (let c = 0; c < CHUNKS_PER_DOC; c++) {
            const vector = vectorFor(
              1 + s * CHUNKS_PER_SESSION + d * CHUNKS_PER_DOC + c,
            );
            const id = chunkId(s, d, c);
            const text = `synthetic chunk ${s}.${d}.${c}`;
            records.push({
              chunkId: id,
              documentId: documentId(s, d),
              page: 1,
              quote: text,
              vector,
            });
            rows.push({
              chunk_id: id,
              document_id: documentId(s, d),
              page_number: 1,
              chunk_order: c,
              text,
              token_count: 3,
              char_start: 0,
              char_end: text.length,
              section: null,
              text_hash: "0".repeat(16),
              embedding: `[${vector.join(",")}]`,
            });
          }
        }
        recordsBySession.set(sessionId(s), records);
      }
      for (let i = 0; i < docs.length; i += 1000) {
        await rest("/rest/v1/documents", {
          method: "POST",
          body: JSON.stringify(docs.slice(i, i + 1000)),
        });
      }
      for (let i = 0; i < rows.length; i += 500) {
        await rest("/rest/v1/chunks", {
          method: "POST",
          body: JSON.stringify(rows.slice(i, i + 500)),
        });
      }
    }, 600_000);

    afterAll(async () => {
      // ON DELETE CASCADE removes the chunks; the run leaves no rows behind.
      await rest(
        `/rest/v1/documents?owner_session=like.${encodeURIComponent(RUN)}*`,
        { method: "DELETE" },
      );
    }, 120_000);

    it.each(KS)(
      "match_chunks returns the exact session top-%i and only that session's chunks",
      async (k) => {
        const store = new PostgresVectorStore();
        let expected = 0;
        let found = 0;
        let foreign = 0;
        const latencies: number[] = [];
        const failures: string[] = [];
        for (const s of targets) {
          const scope = sessionId(s);
          const query = vectorFor(10_000_000 + s);
          const truth = rankByCosine(
            recordsBySession.get(scope) ?? [],
            query,
            k,
          );
          const started = performance.now();
          const hits = await store.queryTopK(query, k, { sessionId: scope });
          latencies.push(performance.now() - started);

          const own = new Set(
            (recordsBySession.get(scope) ?? []).map((r) => r.chunkId),
          );
          foreign += hits.filter(
            (h) => !own.has(h.chunkId) || !h.documentId.startsWith(`${scope}-`),
          ).length;
          const hitIds = new Set(hits.map((h) => h.chunkId));
          expected += truth.length;
          found += truth.filter((t) => hitIds.has(t.chunkId)).length;

          // Same length, same ids (counted above) and the same score at every
          // rank; the epsilon only absorbs float4-vs-float64 rounding.
          const sameOrder =
            hits.length === truth.length &&
            truth.every((t) => hitIds.has(t.chunkId)) &&
            hits.every(
              (h, i) => Math.abs(h.score - truth[i].score) < SCORE_EPS,
            );
          if (!sameOrder)
            failures.push(
              `session#${s}: returned ${hits.length}/${truth.length}`,
            );
        }
        console.log(
          `FILT-1 k=${k} sessions=${N_SESSIONS} chunks=${N_SESSIONS * CHUNKS_PER_SESSION} targets=${targets.length} ` +
            `completeness=${found}/${expected} (${((100 * found) / expected).toFixed(1)}%) foreign=${foreign} ` +
            `mismatched-targets=${failures.length} p50=${percentile(latencies, 50).toFixed(1)}ms p95=${percentile(latencies, 95).toFixed(1)}ms`,
        );
        expect(foreign).toBe(0);
        expect(found).toBe(expected);
        expect(failures).toEqual([]);
      },
      300_000,
    );

    it("a session with no documents gets nothing, never another session's chunks", async () => {
      const hits = await new PostgresVectorStore().queryTopK(
        vectorFor(42),
        40,
        { sessionId: `${RUN}-absent` },
      );
      expect(hits).toEqual([]);
    });
  },
);

describe.skipIf(configured)(
  "FILT-1 per-session top-k completeness (no credentials)",
  () => {
    it("SKIPS honestly without SUPABASE_URL/SUPABASE_SECRET_KEY", () => {
      expect(configured).toBe(false);
    });
  },
);
