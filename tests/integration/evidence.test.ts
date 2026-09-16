import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";

async function loadFixture(name: string, documentId: string) {
  const buf = readFileSync(`tests/fixtures/${name}`);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { pageCount, pages } = await extractPages(bytes, name);
  return { documentId, filename: name, pageCount, pages };
}

describe("cell → evidence flow (User Story 2)", () => {
  it("every populated value carries document, page, and exact quote", async () => {
    const docs = [await loadFixture("plan-a.pdf", "doc-1"), await loadFixture("plan-b.pdf", "doc-2")];
    const table = extractFallback(docs, {});
    expect(table.rows.length).toBeGreaterThan(0);
    for (const row of table.rows) {
      for (const v of row.values) {
        expect(v.evidence.length).toBeGreaterThanOrEqual(1);
        for (const e of v.evidence) {
          expect(e.documentId).toBe(v.documentId);
          expect(e.page).toBeGreaterThanOrEqual(1);
          expect(e.quote.trim()).not.toBe("");
        }
      }
    }
  });

  it("CONFLICTED rows expose both sides with their own sources", async () => {
    const docs = [await loadFixture("plan-a.pdf", "doc-1"), await loadFixture("plan-b.pdf", "doc-2")];
    const table = extractFallback(docs, {});
    const row = table.rows.find((r) => r.factName === "emergency-copay");
    expect(row?.verdict).toBe("CONFLICTED");
    expect(row!.values).toHaveLength(2);
    const docIds = new Set(row!.values.map((v) => v.documentId));
    expect(docIds).toEqual(new Set(["doc-1", "doc-2"]));
  });

  it("facts absent everywhere are NOT STATED", async () => {
    const docs = [await loadFixture("plan-a.pdf", "doc-1"), await loadFixture("plan-b.pdf", "doc-2")];
    const table = extractFallback(docs, {});
    expect(table.rows.find((r) => r.factName === "maternity-coverage")?.verdict).toBe("NOT STATED");
  });
});
