import {
  chunkDocument,
  countTokens,
  normalizeChunkText,
  sha16,
} from "@/app/lib/rag/chunks";
import {
  embedTexts,
  isEmbeddingConfigured,
  type RankedPassage,
} from "@/app/lib/rag/embeddings";
import { requireScopeId } from "@/app/lib/rag/ownership";
import {
  EMBEDDING_DIMENSION,
  PostgresVectorStore,
  isPostgresConfigured,
  resolvePostgresConfig,
  validateDimension,
} from "@/app/lib/rag/postgres-vector";
import {
  deleteDocumentObjects,
  getDefaultObjectStore,
  isSupabaseStorageConfigured,
  putDocumentBytes,
} from "@/app/lib/storage/objects";

export interface PersistInputDocument {
  documentId: string;
  filename: string;
  pages: string[];
  bytes: Uint8Array;
}

export interface PersistedDocumentMeta {
  documentId: string;
  sha256: string;
  objectKey: string;
}

export class PersistenceError extends Error {
  readonly step: string;
  readonly documentId?: string;
  constructor(step: string, message: string, documentId?: string) {
    super(`persist-session ${step}: ${message}`);
    this.name = "PersistenceError";
    this.step = step;
    this.documentId = documentId;
  }
}

export function isDurableConfigured(): boolean {
  return isPostgresConfigured() && isSupabaseStorageConfigured();
}

export function durableDocumentId(
  sessionId: string,
  documentId: string,
): string {
  const scope = requireScopeId(sessionId, "durableDocumentId");
  if (!/^[A-Za-z0-9][A-Za-z0-9-_]{0,127}$/.test(documentId)) {
    throw new PersistenceError("ids", "invalid documentId", documentId);
  }
  return `${scope}--${documentId}`;
}

export function shortDocumentId(sessionId: string, durableId: string): string {
  const prefix = `${requireScopeId(sessionId, "shortDocumentId")}--`;
  return durableId.startsWith(prefix)
    ? durableId.slice(prefix.length)
    : durableId;
}

function restHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

async function restPostgrest(path: string, init: RequestInit): Promise<void> {
  const config = resolvePostgresConfig();
  if (!config)
    throw new PersistenceError(
      "config",
      "Supabase persistence is not configured",
    );
  const res = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      ...restHeaders(config.serviceKey),
      ...((init.headers ?? {}) as Record<string, string>),
    },
  });
  if (!res.ok) {
    throw new PersistenceError(
      "postgrest",
      `${init.method ?? "GET"} ${path} failed with status ${res.status}`,
    );
  }
}

async function rollbackDocument(
  durableId: string,
  objectKey: string | null,
): Promise<void> {
  try {
    await restPostgrest(
      `/rest/v1/documents?id=eq.${encodeURIComponent(durableId)}`,
      {
        method: "DELETE",
      },
    );
  } catch {
    // Rollback is best-effort; the original error below is what matters.
  }
  if (objectKey) {
    try {
      await getDefaultObjectStore().delete(objectKey);
    } catch {
      // Same: best-effort only.
    }
  }
}

export async function persistSessionUpload(
  sessionId: string,
  docs: PersistInputDocument[],
): Promise<PersistedDocumentMeta[]> {
  const scope = requireScopeId(sessionId, "persistSessionUpload");
  if (!isDurableConfigured()) {
    throw new PersistenceError(
      "config",
      "durable persistence is not configured",
    );
  }
  const embedConfigured = isEmbeddingConfigured();
  const out: PersistedDocumentMeta[] = [];
  for (const doc of docs) {
    const durableId = durableDocumentId(scope, doc.documentId);
    let objectKey: string | null = null;
    try {
      const stored = await putDocumentBytes(doc.bytes, scope, doc.documentId, getDefaultObjectStore());
      objectKey = stored.objectKey;
      await restPostgrest("/rest/v1/documents", {
        method: "POST",
        body: JSON.stringify([
          {
            id: durableId,
            owner_session: scope,
            filename: doc.filename,
            sha256: stored.sha256,
            object_key: stored.objectKey,
            status: "active",
          },
        ]),
      });
      await restPostgrest("/rest/v1/pages", {
        method: "POST",
        body: JSON.stringify(
          doc.pages.map((text, i) => ({
            document_id: durableId,
            page_number: i + 1,
            text,
            text_hash: sha16(normalizeChunkText(text)),
          })),
        ),
      });
      const chunks = chunkDocument(durableId, doc.pages);
      let vectors: Map<string, number[]> | null = null;
      if (embedConfigured) {
        const texts = chunks.map((c) => c.text);
        const embedded = await embedTexts(texts);
        vectors = new Map();
        for (let i = 0; i < chunks.length; i++) {
          validateDimension(embedded[i], EMBEDDING_DIMENSION);
          vectors.set(chunks[i].chunkId, embedded[i]);
        }
      }
      await restPostgrest("/rest/v1/chunks", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(
          chunks.map((c) => ({
            chunk_id: c.chunkId,
            document_id: durableId,
            page_number: c.page,
            chunk_order: c.order,
            text: c.text,
            token_count: countTokens(c.text),
            char_start: c.charOffsets.start,
            char_end: c.charOffsets.end,
            section: c.section ?? null,
            text_hash: sha16(normalizeChunkText(c.text)),
            embedding: vectors?.get(c.chunkId) ?? null,
          })),
        ),
      });
      out.push({
        documentId: doc.documentId,
        sha256: stored.sha256,
        objectKey: stored.objectKey,
      });
    } catch (err) {
      await rollbackDocument(durableId, objectKey);
      if (err instanceof PersistenceError) throw err;
      throw new PersistenceError(
        "persist",
        err instanceof Error ? err.message : "unknown persistence failure",
        doc.documentId,
      );
    }
  }
  return out;
}

export async function retrievePersistentSemantic(
  question: string,
  sessionId: string,
  topK = 10,
  documentIds?: string[],
): Promise<RankedPassage[] | null> {
  const scope = requireScopeId(sessionId, "retrievePersistentSemantic");
  if (!isDurableConfigured() || !isEmbeddingConfigured()) return null;
  const [qVec] = await embedTexts([question]);
  validateDimension(qVec, EMBEDDING_DIMENSION);
  const store = new PostgresVectorStore();
  const rows = documentIds
    ? (
        await Promise.all(
          documentIds.map((id) =>
            store.queryTopK(qVec, topK, {
              sessionId: scope,
              documentId: durableDocumentId(scope, id),
            }),
          ),
        )
      )
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
    : await store.queryTopK(qVec, topK, { sessionId: scope });
  return rows.map((r) => ({
    ...r,
    documentId: shortDocumentId(scope, r.documentId),
  }));
}

export async function deleteDurableVectors(sessionId: string): Promise<void> {
  const scope = requireScopeId(sessionId, "deleteDurableVectors");
  try {
    await new PostgresVectorStore().deleteSession(scope);
  } catch (err) {
    throw new PersistenceError(
      "vectors",
      err instanceof Error ? err.message : "vector cleanup failed",
    );
  }
}

export async function deleteDurableObjects(
  sessionId: string,
  objectKeys: Array<string | null | undefined>,
): Promise<void> {
  const scope = requireScopeId(sessionId, "deleteDurableObjects");
  try {
    await deleteDocumentObjects(scope, objectKeys, getDefaultObjectStore());
  } catch (err) {
    throw new PersistenceError(
      "objects",
      err instanceof Error ? err.message : "object cleanup failed",
    );
  }
}
