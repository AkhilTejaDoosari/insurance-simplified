// R1 deterministic page-preserving chunker (todos 12-13).
// Pure-string sliding window over whitespace-separated tokens. Chunks NEVER
// cross page boundaries. This module is NOT wired into retrieve() — R2 owns
// that. It MUST NOT import anything from app/lib/extraction/* (separate paths).
//
// Table-row limitation (todo 15 context): brochure comparison tables arrive
// flattened by page extraction, so tier-mapping across table columns is not
// reconstructed here — chunks preserve page token order verbatim instead.
//
// Metadata (todo 13): every chunk carries documentId/page/order plus
// charOffsets that round-trip to its exact page slice, with an optional
// section heading only when reliably detectable. Per-session chunk lists are
// derived lazily and cached under the OS tmpdir; SessionDocument is untouched.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Target chunk size in whitespace-separated tokens. */
export const CHUNK_TARGET_TOKENS = 512;
/** Overlap between consecutive chunks of the same page, in tokens. */
export const CHUNK_OVERLAP_TOKENS = 64;

export interface ChunkOffsets {
  /** Start index into the raw page string (inclusive). */
  start: number;
  /** End index into the raw page string (exclusive). */
  end: number;
}

export interface TextChunk {
  chunkId: string;
  documentId: string;
  /** 1-based page number (matches pages[] index + 1). */
  page: number;
  /** 0-based order of the chunk within its page. */
  order: number;
  /** Chunk text: the exact raw page slice pages[page-1].slice(start, end). */
  text: string;
  /** Exact character range of text within the raw page string. */
  charOffsets: ChunkOffsets;
  /** Nearest preceding heading-like line, when reliably detectable. */
  section?: string;
}

/** Minimal per-document page input (structural; SessionDocument untouched). */
export interface ChunkableDocument {
  documentId: string;
  pages: string[];
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
 * Chunk text is the exact raw slice between its token boundaries, so
 * pages[page-1].slice(start, end) === chunk.text always holds.
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
  const spans = tokenSpans(pageText);
  if (spans.length === 0) return [];
  const chunks: TextChunk[] = [];
  const step = targetTokens - overlapTokens;
  let order = 0;
  for (let start = 0; start < spans.length; start += step, order++) {
    const window = spans.slice(start, start + targetTokens);
    const charOffsets: ChunkOffsets = {
      start: window[0].start,
      end: window[window.length - 1].end,
    };
    const text = pageText.slice(charOffsets.start, charOffsets.end);
    const section = detectSection(pageText, charOffsets.start);
    chunks.push({
      chunkId: chunkIdFor(documentId, page, order, text),
      documentId,
      page,
      order,
      text,
      charOffsets,
      ...(section === undefined ? {} : { section }),
    });
    if (start + targetTokens >= spans.length) break;
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

interface TokenSpan {
  start: number;
  end: number;
}

function tokenSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (trimmed.endsWith(":")) return true;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  const upper = trimmed.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.5 && /[A-Z]/.test(trimmed[0] ?? "");
}

function detectSection(pageText: string, chunkStart: number): string | undefined {
  const before = pageText.slice(0, chunkStart).split("\n");
  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i].trim();
    if (line === "") continue;
    if (isHeadingLine(line)) return line;
    return undefined;
  }
  return undefined;
}

/**
 * Resolve a chunk back to its exact page substring. Throws on an
 * out-of-range page index or on offsets outside the page bounds.
 */
export function sliceForChunk(chunk: TextChunk, pages: string[]): string {
  if (!Number.isInteger(chunk.page) || chunk.page < 1 || chunk.page > pages.length) {
    throw new Error(
      `sliceForChunk: page ${chunk.page} out-of-range (1..${pages.length})`,
    );
  }
  const pageText = pages[chunk.page - 1];
  const { start, end } = chunk.charOffsets;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > pageText.length
  ) {
    throw new Error(
      `sliceForChunk: offsets [${start}, ${end}) out-of-range for page length ${pageText.length}`,
    );
  }
  return pageText.slice(start, end);
}

function chunksCacheDir(): string {
  const dir = join(tmpdir(), "insurance-simplified-chunks");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(sessionId);
}

function sessionCacheKey(documents: ChunkableDocument[]): string {
  return sha16(
    JSON.stringify(
      documents.map((d) => [d.documentId, d.pages.map((p) => sha16(p))]),
    ),
  );
}

/**
 * Chunk a session's documents lazily with a tmpdir-backed cache. Pure
 * derivation from the given pages; never mutates SessionDocument.
 */
export function chunksForSession(
  sessionId: string,
  documents: ChunkableDocument[],
): TextChunk[] {
  const chunks = documents.flatMap((d) => chunkDocument(d.documentId, d.pages));
  if (!isSafeSessionId(sessionId)) return chunks;
  const path = join(chunksCacheDir(), `${sessionId}.json`);
  const key = sessionCacheKey(documents);
  try {
    const cached = JSON.parse(readFileSync(path, "utf8")) as {
      key: string;
      chunks: TextChunk[];
    };
    if (cached.key === key && Array.isArray(cached.chunks)) return cached.chunks;
  } catch {
    void 0;
  }
  writeFileSync(path, JSON.stringify({ key, chunks }));
  return chunks;
}

/** Drop a session's cached chunks (mirrors delete-on-close retention). */
export function clearCachedSessionChunks(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) return;
  try {
    rmSync(join(chunksCacheDir(), `${sessionId}.json`), { force: true });
  } catch {
    void 0;
  }
}
