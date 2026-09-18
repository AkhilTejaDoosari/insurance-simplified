// R1 deterministic page-preserving chunker (todo 12).
// Pure-string sliding window over whitespace-separated tokens. Chunks NEVER
// cross page boundaries. This module is NOT wired into retrieve() — R2 owns
// that. It MUST NOT import anything from app/lib/extraction/* (separate paths).
//
// Table-row limitation (todo 15 context): brochure comparison tables arrive
// flattened by page extraction, so tier-mapping across table columns is not
// reconstructed here — chunks preserve page token order verbatim instead.

import { createHash } from "node:crypto";

/** Target chunk size in whitespace-separated tokens. */
export const CHUNK_TARGET_TOKENS = 512;
/** Overlap between consecutive chunks of the same page, in tokens. */
export const CHUNK_OVERLAP_TOKENS = 64;

export interface TextChunk {
  chunkId: string;
  documentId: string;
  /** 1-based page number (matches pages[] index + 1). */
  page: number;
  /** 0-based order of the chunk within its page. */
  order: number;
  /** Chunk text: page tokens joined with single spaces. */
  text: string;
}

/** Split text into tokens: maximal runs of non-whitespace (token = \S+). */
export function tokenize(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

/** Count whitespace-separated tokens (shared counting function). */
export function countTokens(text: string): number {
  return tokenize(text).length;
}

/** Collapse all whitespace runs to single spaces and trim. Case preserved. */
export function normalizeChunkText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** sha256 truncated to 16 hex chars. */
export function sha16(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
}

/**
 * Deterministic chunk ID: the text hash makes any edit change the affected
 * chunk's ID, while identical text re-chunks identically; binding
 * documentId/page/order keeps IDs unique across locations.
 */
export function chunkIdFor(
  documentId: string,
  page: number,
  order: number,
  chunkText: string,
): string {
  const textHash = sha16(normalizeChunkText(chunkText));
  return sha16(`${documentId}:${page}:${order}:${textHash}`);
}

/**
 * Chunk one page of text. Returns chunks in stable order (order 0..n-1).
 * Empty/whitespace-only pages yield zero chunks; short pages yield one.
 */
export function chunkPage(
  documentId: string,
  page: number,
  pageText: string,
  targetTokens: number = CHUNK_TARGET_TOKENS,
  overlapTokens: number = CHUNK_OVERLAP_TOKENS,
): TextChunk[] {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`chunkPage: page must be a 1-based integer, got ${page}`);
  }
  if (targetTokens < 1 || overlapTokens < 0 || overlapTokens >= targetTokens) {
    throw new Error(
      `chunkPage: require 0 <= overlap < target, got overlap=${overlapTokens} target=${targetTokens}`,
    );
  }
  const tokens = tokenize(pageText);
  if (tokens.length === 0) return [];
  const chunks: TextChunk[] = [];
  const step = targetTokens - overlapTokens;
  let order = 0;
  for (let start = 0; start < tokens.length; start += step, order++) {
    const slice = tokens.slice(start, start + targetTokens);
    const text = slice.join(" ");
    chunks.push({
      chunkId: chunkIdFor(documentId, page, order, text),
      documentId,
      page,
      order,
      text,
    });
    if (start + targetTokens >= tokens.length) break;
  }
  return chunks;
}

/**
 * Chunk a document's pages (pages[0] === page 1). Pages are chunked
 * independently — output never mixes tokens from different pages.
 */
export function chunkDocument(
  documentId: string,
  pages: string[],
  targetTokens: number = CHUNK_TARGET_TOKENS,
  overlapTokens: number = CHUNK_OVERLAP_TOKENS,
): TextChunk[] {
  return pages.flatMap((pageText, i) =>
    chunkPage(documentId, i + 1, pageText, targetTokens, overlapTokens),
  );
}
