import { describe, expect, it } from "vitest";
import { answerQuestion, retrieve } from "@/app/lib/rag/answer";
import type { RagDocument } from "@/app/lib/rag/answer";

function doc(id: string, pages: string[]): RagDocument {
  return { documentId: id, filename: `${id}`, pageCount: pages.length, pages };
}

describe("BM25 lexical retrieval over chunks", () => {
  it("ranks the obvious lexical match first with stable provenance", () => {
    const docs = [
      doc("plan-a.pdf", ["Annual deductible: $250 in-network."]),
      doc("plan-b.pdf", ["Prescription drug formulary tiers and mail order."]),
    ];
    const hits = retrieve(docs, "What is the annual deductible?", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].documentId).toBe("plan-a.pdf");
    expect(hits[0].page).toBe(1);
    expect(hits[0].quote).toContain("deductible");
  });

  it("rewards term frequency: repeated query term outranks single mention", () => {
    const docs = [
      doc("single.pdf", ["Emergency care copay applies."]),
      doc("multi.pdf", ["Emergency emergency emergency care copay applies."]),
    ];
    const hits = retrieve(docs, "emergency copay", 5);
    expect(hits.length).toBe(2);
    expect(hits[0].documentId).toBe("multi.pdf");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("applies length normalization: same terms in shorter chunk win", () => {
    const filler = " filler".repeat(200);
    const docs = [
      doc("long.pdf", [`deductible annual${filler}`]),
      doc("short.pdf", ["deductible annual"]),
    ];
    const hits = retrieve(docs, "deductible annual", 5);
    expect(hits.length).toBe(2);
    expect(hits[0].documentId).toBe("short.pdf");
  });

  it("breaks score ties deterministically (documentId, page, order, chunkId)", () => {
    const docs = [
      doc("b-doc.pdf", ["deductible annual network"]),
      doc("a-doc.pdf", ["deductible annual network"]),
    ];
    const first = retrieve(docs, "deductible annual network", 5);
    const second = retrieve(docs, "deductible annual network", 5);
    expect(first.map((h) => h.documentId)).toEqual(["a-doc.pdf", "b-doc.pdf"]);
    expect(first).toEqual(second);
  });

  it("zero-overlap query returns [] and triggers refusal downstream", () => {
    const docs = [doc("plan-a.pdf", ["Annual deductible: $250 in-network."])];
    expect(retrieve(docs, "space tourism maternity", 3)).toEqual([]);
    const res = answerQuestion(docs, "space tourism maternity");
    expect(res.kind).toBe("refusal");
  });

  it("keeps empty->[] contract and maxPassages bound", () => {
    expect(retrieve([], "deductible", 3)).toEqual([]);
    expect(retrieve([doc("d.pdf", ["deductible annual"])] , "", 3)).toEqual([]);
    const docs = [
      doc("a.pdf", ["deductible annual one"]),
      doc("b.pdf", ["deductible annual two"]),
      doc("c.pdf", ["deductible annual three"]),
    ];
    expect(retrieve(docs, "deductible annual", 2).length).toBe(2);
  });
});
