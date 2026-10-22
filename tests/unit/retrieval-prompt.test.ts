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
    expect(prompt).toContain('<<<DOCUMENT id="doc-1" name="a.pdf" >>>');
    expect(prompt).toContain('<<<DOCUMENT id="doc-2" name="b.pdf" >>>');
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

  // Regression: evidence deep in a multi-page SBC sits on pages past page 1.
  // A doubled/renumbered tag makes the model cite the wrong page;
  // verifyEvidenceCitation then fails-closed, so answerable questions refuse.
  it("tags each passage with its REAL page number, exactly once", () => {
    const deepDoc = {
      documentId: "doc-sbc",
      filename: "studentsecure.pdf",
      pageCount: 6,
      pages: ["cover", "benefits", "Deductible is $0.", "rules", "Prescription drugs covered.", "notes"],
    };
    const passages = [
      { documentId: "doc-sbc", page: 3, chunkId: "c3", quote: "Deductible is $0.", score: 0.9 },
      { documentId: "doc-sbc", page: 5, chunkId: "c5", quote: "Prescription drugs covered.", score: 0.8 },
    ];
    const prompt = buildRetrievalPrompt([deepDoc], passages, "What is the deductible?");

    const tags = prompt.match(/\[Page \d+\]/g) ?? [];
    expect(tags).toEqual(["[Page 3]", "[Page 5]"]);
    expect(prompt).not.toContain("[Page 1]\n[Page 3]");
    expect(prompt).not.toContain("[Page 2]\n[Page 5]");
  });

  // Regression (todo 6): semantic retrieval returns topK=16 chunks of up to
  // 512 tokens. A pathological ~4100-char chunk at topK=16 (~66k) would
  // exceed the budget and drop the whole lowest-ranked document block — that
  // risk is accepted for V1 (see the MAX_CONTEXT_CHARS docblock). This test
  // still pins the old floor: 10 worst-case-size chunks must always fit,
  // whichever topK is configured.
  it("keeps 10 worst-case-size chunks from every document under budget", () => {
    const bigDocs = [
      { documentId: "doc-1", filename: "a.pdf", pageCount: 5, pages: ["p1", "p2", "p3", "p4", "p5"] },
      { documentId: "doc-2", filename: "b.pdf", pageCount: 5, pages: ["p1", "p2", "p3", "p4", "p5"] },
    ];
    const passages = Array.from({ length: 10 }, (_, i) => ({
      documentId: i % 2 === 0 ? "doc-1" : "doc-2",
      page: Math.floor(i / 2) + 1,
      chunkId: `c${i}`,
      quote: `SENTINEL-Q${i}-START ${"x".repeat(4000)} SENTINEL-Q${i}-END`,
      score: 1 - i * 0.01,
    }));

    const prompt = buildRetrievalPrompt(bigDocs, passages, "q");

    expect(prompt).toContain('<<<DOCUMENT id="doc-1"');
    expect(prompt).toContain('<<<DOCUMENT id="doc-2"');
    for (let i = 0; i < 10; i++) {
      expect(prompt).toContain(`SENTINEL-Q${i}-END`);
    }
    expect(prompt.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 3000);
  });

  // Regression (todo 6): topK was raised 10 -> 16 so a full small-session
  // chunk set fits the prompt (the Seven Corners "Deductible Options"
  // passage ranks 12 of 16 for deductible-comparison questions; at topK=10
  // it was missing, so the $0 - $5,000 range never reached the model).
  // Realistic dense insurance chunks (~2400 chars per 512-token chunk) must
  // keep BOTH documents fully under budget at the new topK.
  it("keeps all top-16 realistic-size chunks from every document under budget", () => {
    const bigDocs = [
      { documentId: "doc-1", filename: "a.pdf", pageCount: 8, pages: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"] },
      { documentId: "doc-2", filename: "b.pdf", pageCount: 8, pages: ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"] },
    ];
    const passages = Array.from({ length: 16 }, (_, i) => ({
      documentId: i % 2 === 0 ? "doc-1" : "doc-2",
      page: Math.floor(i / 2) + 1,
      chunkId: `c${i}`,
      quote: `SENTINEL-R${i}-START ${"x".repeat(2400)} SENTINEL-R${i}-END`,
      score: 1 - i * 0.01,
    }));

    const prompt = buildRetrievalPrompt(bigDocs, passages, "q");

    expect(prompt).toContain('<<<DOCUMENT id="doc-1"');
    expect(prompt).toContain('<<<DOCUMENT id="doc-2"');
    for (let i = 0; i < 16; i++) {
      expect(prompt).toContain(`SENTINEL-R${i}-END`);
    }
    expect(prompt.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 3000);
  });
});
