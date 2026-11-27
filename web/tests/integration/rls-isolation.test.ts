// P3 RLS proof test: real Supabase Auth users against live RLS policies
// (db/migrations/0003_rls.sql). SKIPS (never fails, never fake-passes) when
// SUPABASE_URL / secret key / publishable key are absent.
//
// What this proves (with authenticated user JWTs, never the service key):
// owner A reads A-owned rows and zero B-owned rows across documents, pages,
// chunks, match_chunks (vector) and fts_search_chunks (FTS); inserts,
// updates, and deletes across the ownership boundary are blocked; the
// pre-RLS NULL-owner rows stay invisible to authenticated users while the
// service_role server flows keep working (see postgres-vector integration).
//
// The owner_session seam is untouched: RPC calls still bind filter_session,
// so RLS is defense-in-depth on top of the scoped application queries.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

function secretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY;
}

function publishableKey(): string | undefined {
  return process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function baseUrl(): string {
  return (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
}

const configured = Boolean(baseUrl() && secretKey() && publishableKey());

function svcHeaders(): Record<string, string> {
  const key = secretKey()!;
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}

function userHeaders(jwt: string): Record<string, string> {
  return {
    apikey: publishableKey()!,
    authorization: `Bearer ${jwt}`,
    "content-type": "application/json",
  };
}

async function adminCreateUser(email: string, password: string): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`admin create user failed with status ${res.status}`);
  return (await res.json()) as { id: string };
}

async function signIn(email: string, password: string): Promise<{ jwt: string; uid: string }> {
  const res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey()!, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign in failed with status ${res.status}`);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { jwt: body.access_token, uid: body.user.id };
}

async function adminDeleteUser(uid: string): Promise<void> {
  await fetch(`${baseUrl()}/auth/v1/admin/users/${uid}`, {
    method: "DELETE",
    headers: svcHeaders(),
  });
}

async function svcRest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...svcHeaders(), ...((init?.headers ?? {}) as Record<string, string>) },
  });
}

function unitVector(seed: number): number[] {
  const v = new Array<number>(1024).fill(0);
  v[seed % 1024] = 1;
  return v;
}

describe.skipIf(!configured)("rls isolation proof (live Auth + RLS)", () => {
  it("User A and User B reach only their own rows (rows, writes, vector, FTS)", async () => {
    const ts = Date.now().toString(36);
    const emailA = `p3rls-a-${ts}@example.com`;
    const emailB = `p3rls-b-${ts}@example.com`;
    const password = `P3rls-${randomUUID()}-x`;
    const scopeA = `p3rlsA${ts}`.slice(0, 32);
    const scopeB = `p3rlsB${ts}`.slice(0, 32);
    const docA = `p3rlsdocA${ts}`;
    const docB = `p3rlsdocB${ts}`;
    const docNull = `p3rlsdocNull${ts}`;

    const createdA = await adminCreateUser(emailA, password);
    const createdB = await adminCreateUser(emailB, password);
    const sessA = await signIn(emailA, password);
    const sessB = await signIn(emailB, password);
    expect(sessA.uid).toBe(createdA.id);
    expect(sessB.uid).toBe(createdB.id);
    const hA = userHeaders(sessA.jwt);
    const hB = userHeaders(sessB.jwt);

    try {
      // Seed as service_role (bypasses RLS): one doc per user + one NULL-owner row.
      for (const [doc, scope, uid] of [
        [docA, scopeA, sessA.uid],
        [docB, scopeB, sessB.uid],
      ] as const) {
        const r = await svcRest("/rest/v1/documents", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            id: doc,
            owner_session: scope,
            owner_user_id: uid,
            filename: `${doc}.pdf`,
            sha256: "1".repeat(64),
            status: "active",
          }),
        });
        expect(r.status).toBe(201);
      }
      const rNull = await svcRest("/rest/v1/documents", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: docNull,
          owner_session: null,
          owner_user_id: null,
          filename: `${docNull}.pdf`,
          sha256: "2".repeat(64),
          status: "active",
        }),
      });
      expect(rNull.status).toBe(201);
      const chunk = async (doc: string, page: number, order: number, text: string, seed: number) => {
        const r = await svcRest("/rest/v1/chunks", {
          method: "POST",
          body: JSON.stringify([
            {
              chunk_id: `p3rls-${doc}-${order}`,
              document_id: doc,
              page_number: page,
              chunk_order: order,
              text,
              token_count: 8,
              char_start: 0,
              char_end: 8,
              text_hash: `h-${doc}`,
              embedding: unitVector(seed),
            },
          ]),
        });
        expect(r.status).toBe(201);
      };
      await chunk(docA, 1, 0, "Alpha deductible schedule", 3);
      await chunk(docB, 1, 0, "Beta deductible schedule", 3);

      const getJson = async (headers: Record<string, string>, path: string) => {
        const r = await fetch(`${baseUrl()}${path}`, { headers });
        expect(r.ok).toBe(true);
        return (await r.json()) as Array<Record<string, unknown>>;
      };

      // Ordinary row reads: each user sees exactly their own document.
      const docsA = await getJson(hA, "/rest/v1/documents?select=id");
      const docsB = await getJson(hB, "/rest/v1/documents?select=id");
      expect(docsA.map((d) => d.id)).toEqual([docA]);
      expect(docsB.map((d) => d.id)).toEqual([docB]);

      // Child rows inherit ownership through the parent: no cross reads.
      const chunksA = await getJson(hA, "/rest/v1/chunks?select=chunk_id,document_id");
      expect(chunksA.map((c) => c.document_id)).toEqual([docA]);
      const chunksBforA = await getJson(
        hA,
        `/rest/v1/chunks?select=chunk_id&document_id=eq.${docB}`,
      );
      expect(chunksBforA).toEqual([]);

      // Cross-boundary writes are blocked.
      const badInsert = await fetch(`${baseUrl()}/rest/v1/documents`, {
        method: "POST",
        headers: { ...hA, Prefer: "return=representation" },
        body: JSON.stringify({
          id: `p3rls-forged${ts}`,
          owner_session: scopeA,
          owner_user_id: sessB.uid,
          filename: "forged.pdf",
          sha256: "3".repeat(64),
          status: "active",
        }),
      });
      expect([401, 403, 404, 409]).toContain(badInsert.status);

      const badUpdate = await fetch(
        `${baseUrl()}/rest/v1/documents?id=eq.${docB}`,
        {
          method: "PATCH",
          headers: { ...hA, Prefer: "return=representation" },
          body: JSON.stringify({ filename: "hijacked.pdf" }),
        },
      );
      expect(badUpdate.ok).toBe(true);
      expect(await badUpdate.json()).toEqual([]);

      const badDelete = await fetch(`${baseUrl()}/rest/v1/documents?id=eq.${docB}`, {
        method: "DELETE",
        headers: { ...hA, Prefer: "return=representation" },
      });
      expect(badDelete.ok).toBe(true);
      expect(await badDelete.json()).toEqual([]);
      // B's row survived A's delete attempt (service_role can still see it).
      const stillThere = await svcRest(`/rest/v1/documents?id=eq.${docB}&select=id`);
      expect(((await stillThere.json()) as unknown[]).length).toBe(1);

      // Own insert/update/delete work for the owner.
      const ownDoc = `p3rlsown${ts}`;
      const ownInsert = await fetch(`${baseUrl()}/rest/v1/documents`, {
        method: "POST",
        headers: { ...hA, Prefer: "return=representation" },
        body: JSON.stringify({
          id: ownDoc,
          owner_session: scopeA,
          owner_user_id: sessA.uid,
          filename: `${ownDoc}.pdf`,
          sha256: "4".repeat(64),
          status: "active",
        }),
      });
      expect(ownInsert.status).toBe(201);
      const ownDelete = await fetch(`${baseUrl()}/rest/v1/documents?id=eq.${ownDoc}`, {
        method: "DELETE",
        headers: { ...hA, Prefer: "return=representation" },
      });
      expect(ownDelete.ok).toBe(true);
      expect(((await ownDelete.json()) as unknown[]).length).toBe(1);

      // Semantic retrieval as A: own rows only; B's scope yields zero rows.
      const rpc = async (
        headers: Record<string, string>,
        fn: string,
        body: Record<string, unknown>,
      ) => {
        const r = await fetch(`${baseUrl()}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        expect(r.ok).toBe(true);
        return (await r.json()) as Array<Record<string, unknown>>;
      };
      const vecA = await rpc(hA, "match_chunks", {
        query_embedding: unitVector(3),
        match_count: 10,
        filter_document_id: null,
        filter_session: scopeA,
      });
      expect(vecA.map((r) => r.document_id)).toEqual([docA]);
      const vecCross = await rpc(hA, "match_chunks", {
        query_embedding: unitVector(3),
        match_count: 10,
        filter_document_id: docB,
        filter_session: scopeB,
      });
      expect(vecCross).toEqual([]);

      // FTS retrieval as A over the shared term: own rows only.
      const ftsA = await rpc(hA, "fts_search_chunks", {
        query_text: "deductible schedule",
        match_count: 10,
        filter_document_id: null,
        filter_session: scopeA,
      });
      expect(ftsA.map((r) => r.document_id)).toEqual([docA]);
      const ftsCross = await rpc(hA, "fts_search_chunks", {
        query_text: "deductible schedule",
        match_count: 10,
        filter_document_id: null,
        filter_session: scopeB,
      });
      expect(ftsCross).toEqual([]);
    } finally {
      // Cleanup (service_role bypasses RLS): rows cascade, then users removed.
      for (const doc of [docA, docB, docNull]) {
        await svcRest(`/rest/v1/documents?id=eq.${doc}`, { method: "DELETE" });
      }
      await adminDeleteUser(sessA.uid);
      await adminDeleteUser(sessB.uid);
    }
  }, 90000);
});

describe.skipIf(configured)("rls isolation proof (no credentials)", () => {
  it("SKIPS honestly without Supabase Auth credentials", () => {
    expect(configured).toBe(false);
  });
});
