import { describe, expect, it } from "vitest";

import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  chunkDocument,
  chunkPage,
  countTokens,
} from "@/app/lib/rag/chunks";

function words(n: number, prefix = "w"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

function deOverlapped(chunkTexts: string[]): string {
  const tokenLists = chunkTexts.map((t) => t.split(" ").filter(Boolean));
  const out: string[] = [...tokenLists[0]];
  for (let i = 1; i < tokenLists.length; i++) {
    out.push(...tokenLists[i].slice(CHUNK_OVERLAP_TOKENS));
  }
  return out.join(" ");
}

describe("countTokens (shared token definition: token = \\S+ run)", () => {
  it("uses exact defaults 512/64", () => {
    expect(CHUNK_TARGET_TOKENS).toBe(512);
    expect(CHUNK_OVERLAP_TOKENS).toBe(64);
  });

  it("counts whitespace-separated runs", () => {
    expect(countTokens("hello world")).toBe(2);
    expect(countTokens("  hello\tworld\nagain  ")).toBe(3);
    expect(countTokens("")).toBe(0);
    expect(countTokens("   \n\t  ")).toBe(0);
    expect(countTokens("one")).toBe(1);
  });
});

describe("deterministic page-preserving chunker", () => {
  it("is deterministic: same input yields same chunkIds across two runs", () => {
    const pages = [words(1200), words(300, "p")];
    const first = chunkDocument("doc-1", pages).map((c) => c.chunkId);
    const second = chunkDocument("doc-1", pages).map((c) => c.chunkId);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("loses no text: de-overlapped concat equals the page token stream", () => {
    const page = words(1200);
    const chunks = chunkPage("doc-1", 1, page);
    expect(chunks.length).toBeGreaterThan(1);
    expect(deOverlapped(chunks.map((c) => c.text))).toBe(page);
  });

  it("keeps order stable and sequential within a page", () => {
    const chunks = chunkPage("doc-1", 2, words(1200));
    expect(chunks.map((c) => c.order)).toEqual(
      chunks.map((_, i) => i),
    );
    expect(chunks.every((c) => c.page === 2)).toBe(true);
    expect(chunks.every((c) => c.documentId === "doc-1")).toBe(true);
  });

  it("never crosses page boundaries", () => {
    const page1 = words(700, "a");
    const page2 = words(700, "b");
    const chunks = chunkDocument("doc-x", [page1, page2]);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      const source = c.page === 1 ? page1 : page2;
      const other = c.page === 1 ? page2 : page1;
      const sourceTokens = new Set(source.split(" "));
      for (const tok of c.text.split(" ").filter(Boolean)) {
        expect(sourceTokens.has(tok)).toBe(true);
        expect(new Set(other.split(" ")).has(tok)).toBe(false);
      }
    }
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
  });

  it("single-char edit changes only the affected chunk ID", () => {
    const tokens = Array.from({ length: 1200 }, (_, i) => `w${i}`);
    const page = tokens.join(" ");
    const before = chunkPage("doc-1", 1, page);
    // Edit a token in chunk 0's non-overlapping region (index 100).
    const edited = [...tokens];
    edited[100] = "w100x";
    const after = chunkPage("doc-1", 1, edited.join(" "));
    expect(after.length).toBe(before.length);
    const changed = before.filter((c, i) => c.chunkId !== after[i].chunkId);
    expect(changed.length).toBe(1);
    expect(changed[0].order).toBe(0);
  });

  it("emits a single chunk for short pages and none for empty pages", () => {
    const short = chunkPage("doc-1", 1, "hello world");
    expect(short.length).toBe(1);
    expect(short[0].text).toBe("hello world");
    expect(chunkPage("doc-1", 1, "   \n ")).toEqual([]);
  });
});
