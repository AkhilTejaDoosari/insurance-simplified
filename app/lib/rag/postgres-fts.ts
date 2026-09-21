// P2 FTS candidate leg (todo 58): EVALUATION CANDIDATE ONLY.
// Postgres to_tsvector/to_tsquery + ts_rank over the chunks.fts column
// (db/schema.sql fts_search_chunks RPC).
//
// NOT wired into answerQuestionSemantic/answerViaLlm or any production
// retrieval path — it exists so evals/run.mjs (--leg=fts / --retriever=fts)
// can MEASURE exact-term recall against the lexical/semantic legs. The
// production answer path is untouched by construction (this module's only
// consumer is the eval runner + its unit tests).
//
// WHY a separate leg: stemming/tokenizing rankers can mangle the surface
// forms this corpus is graded on — F-1, OPT, PPO, precertification,
// amounts ($250, 6-month), %, plan names, visa codes, dates. The RPC uses
// websearch_to_tsquery (no app-side tsquery escaping to get wrong) while
// still ranking exact surface matches via ts_rank.
//
// HONEST SKIP: without SUPABASE_URL / SUPABASE_SECRET_KEY,
// retrieveFtsCandidate() resolves [] (the zero-evidence contract —
// refusal gating depends on empty arrays, never null/throws for "no hits").
// DB errors propagate (never swallowed into fake zeros).

import type { RankedPassage } from "@/app/lib/rag/embeddings";
import { requireScopeId } from "@/app/lib/rag/ownership";

export interface FtsRow {
  chunk_id: string;
  document_id: string;
  page_number: number;
  quote: string;
  rank: number;
}

// OWNERSHIP SEAM (todo 62): sessionId is REQUIRED — same opaque-token rule
// as the pgvector leg (see app/lib/rag/ownership.ts). Unscoped calls throw
// UnscopedQueryError; the scope id rides the SQL-level `filter_session`
// predicate of fts_search_chunks. RLS additionally backs this at the
// database (db/migrations/0003_rls.sql); the seam stays mandatory regardless.
export interface FtsQueryFilters {
  documentId?: string;
  sessionId: string;
}

export interface FtsClient {
  searchFts(
    queryText: string,
    topK: number,
    filters?: FtsQueryFilters,
  ): Promise<FtsRow[]>;
}

export interface FtsCandidateOptions extends FtsQueryFilters {
  topK?: number;
  /** Injected client (unit tests / eval harness). */
  client?: FtsClient;
}

/** Same env contract as the pgvector adapter (db/README.md). Lazy: call, don't cache at import. */
export function isFtsConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY));
}

/**
 * Normalize raw question text for the fts_search_chunks RPC. The server
 * parses with websearch_to_tsquery, so the client only trims/collapses and
 * caps length — no operator escaping that could mangle F-1/OPT/PPO/%.
 * Empty queries yield "" (callers treat that as zero evidence).
 */
export function buildFtsQuery(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, 500);
}

/**
 * Map RPC rows to RankedPassage with full provenance
 * (chunk -> document -> page -> source quote), ordered rank DESC with the
 * deterministic tie-break chunkId ASC, sliced to topK.
 */
export function rankFtsRows(rows: FtsRow[], topK: number): RankedPassage[] {
  const mapped: RankedPassage[] = rows.map((row) => ({
    documentId: row.document_id,
    page: row.page_number,
    chunkId: row.chunk_id,
    quote: row.quote,
    score: row.rank,
  }));
  mapped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.chunkId !== b.chunkId) return a.chunkId < b.chunkId ? -1 : 1;
    if (a.documentId !== b.documentId) {
      return a.documentId < b.documentId ? -1 : 1;
    }
    return a.page - b.page;
  });
  const k = Math.max(0, Math.min(topK, mapped.length));
  return mapped.slice(0, k);
}

/** Fetch-based fts_search_chunks RPC call. Created lazily — never at import. */
export function createRestFtsClient(): FtsClient {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "retrieveFtsCandidate: SUPABASE_URL and SUPABASE_SECRET_KEY are unset — skipping FTS leg",
    );
  }
  return {
    async searchFts(queryText: string, topK: number, filters: FtsQueryFilters): Promise<FtsRow[]> {
      const scope = requireScopeId(filters?.sessionId, "RestFtsClient.searchFts");
      const res = await fetch(`${url}/rest/v1/rpc/fts_search_chunks`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query_text: queryText,
          match_count: topK,
          filter_document_id: filters.documentId ?? null,
          filter_session: scope,
        }),
      });
      if (!res.ok) {
        throw new Error(`FTS RPC failed with status ${res.status}`);
      }
      return (await res.json()) as FtsRow[];
    },
  };
}

/**
 * Evaluation-only FTS candidate retrieval. sessionId is REQUIRED (unscoped
 * calls throw UnscopedQueryError, never silently search all owners). []
 * when unconfigured or on empty queries; DB errors throw.
 */
export async function retrieveFtsCandidate(
  question: string,
  opts: FtsCandidateOptions & { sessionId: string },
): Promise<RankedPassage[]> {
  requireScopeId(opts?.sessionId, "retrieveFtsCandidate");
  const topK = opts.topK ?? 5;
  const queryText = buildFtsQuery(question);
  if (queryText === "") return [];
  const client = opts.client ?? (isFtsConfigured() ? createRestFtsClient() : null);
  if (!client) return [];
  const rows = await client.searchFts(queryText, topK, {
    documentId: opts.documentId,
    sessionId: opts.sessionId,
  });
  return rankFtsRows(rows, topK);
}
