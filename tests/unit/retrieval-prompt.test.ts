import { describe, expect, it } from "vitest";
import { buildRetrievalPrompt, MAX_CONTEXT_CHARS } from "@/app/lib/rag/answer";

const DOCS = [
  { documentId: "doc-1", filename: "a.pdf", pageCount: 2, pages: ["p1", "p2"] },
  { documentId: "doc-2", filename: "b.pdf", pageCount: 1, pages: ["p1"] },
];

describe("R5 retrieval-fed prompt assembly", () => {
  it("keeps chunk order and intact page tags with no whole-doc leakage", () => {
    const passages = [
      { documentId: "doc-1", page: 1, chunkId: "c1", quote: "Annual deductible $250.", score: 0.9 },
      { documentId: "doc-2", page: 1, chunkId: "c2", quote: "Copay $25.", score: 0.8 },
    ];
    const prompt = buildRetrievalPrompt(DOCS, passages, "What is deductible?");
    expect(prompt).toContain('[Page 1]\nAnnual deductible $250.');
    expect(prompt).toContain('[Page 1]\nCopay $25.');
    expect(prompt).toContain('<<<DOCUMENT id="doc-1" >>>');
    expect(prompt).toContain('<<<DOCUMENT id="doc-2" >>>');
    expect(prompt.indexOf("Annual deductible $250.")).toBeLessThan(prompt.indexOf("Copay $25."));
    expect(prompt).toContain("Question: What is deductible?");
  });

  it("truncates lowest-rank chunks first under budget with tags intact", () => {
    const big = "x".repeat(8000);
    const passages = [
      { documentId: "doc-1", page: 1, chunkId: "c1", quote: "KEEP ME.", score: 0.9 },
      { documentId: "doc-2", page: 1, chunkId: "c2", quote: big, score: 0.1 },
    ];
    const prompt = buildRetrievalPrompt(DOCS, passages, "q");
    expect(prompt).toContain("KEEP ME.");
    expect(prompt.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 3000);
    expect(prompt).toContain("[Page 1]");
  });

  it("never includes pages beyond supplied passages", () => {
    const passages = [
      { documentId: "doc-1", page: 1, chunkId: "c1", quote: "Only this.", score: 1 },
    ];
    const prompt = buildRetrievalPrompt(DOCS, passages, "q");
    expect(prompt).toContain("Only this.");
    expect(prompt).not.toContain("p2");
  });
});
