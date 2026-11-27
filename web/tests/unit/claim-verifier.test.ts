import { describe, expect, it } from "vitest";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

const DOCS = [
  {
    documentId: "doc-1",
    pageCount: 1,
    pages: ["Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000."],
  },
];

const SUPPLIED = [
  { documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000." },
];

describe("R5 claim-to-citation verifier", () => {
  it("passes a fully covered answer", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(true);
  });

  it("refuses hallucinated page/quote", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-1", page: 99, quote: "Annual deductible: $250 in-network." }],
      [{ documentId: "doc-1", page: 99, quote: "Annual deductible: $250 in-network." }],
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses genuine-quote-plus-unsupported-claim", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network. Space tourism is fully covered.",
      [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses valid citation plus unrelated extra claim (adversarial a)", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network. The moon is made of cheese.",
      [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses mixed supported/unsupported sentences (adversarial b)", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network. Martian copay is zero dollars.",
      [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses citation not in supplied chunk context", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-1", page: 1, quote: "Fabricated passage here." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("passes a citation whose quote reflows supplied whitespace (live LLM regression)", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250\nin-network. Annual out-of-pocket maximum: $3,000." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(true);
  });

  it("refuses a reflowed quote whose page was not supplied", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250 in-network." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses a reflowed quote from another document", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-2", page: 1, quote: "Annual deductible: $250 in-network." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
  });

  it("diagnoses a wrong-page citation as supplied on another page", () => {
    const r = verifyAnswerClaims(
      "Annual deductible $250 in network.",
      [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250 in-network." }],
      SUPPLIED,
      DOCS,
    );
    expect(r.ok).toBe(false);
    expect(r.rationale).toContain("suppliedDoc=true");
    expect(r.rationale).toContain("sourceDoc=false");
  });
});
