import { describe, expect, it } from "vitest";
import {
  MAX_RECOVERED_SPAN_CHARS,
  verifyEvidenceCitation,
} from "@/app/lib/evidence-verification";

const DOCS = [
  {
    documentId: "doc-1",
    pageCount: 2,
    pages: [
      "Annual deductible: $250 in-network.\nAnnual out-of-pocket maximum: $3,000.",
      "Emergency copay \u2014 $100, \u201Cwaived\u201D if admitted.\nUrgent care copay is $25. Urgent care copay is $25.",
    ],
  },
];

const cite = (documentId: string, page: number, quote: string) => ({
  documentId,
  page,
  quote,
});

describe("verifyEvidenceCitation", () => {
  it("1. passes an exact verbatim quote", () => {
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-1", 1, "Annual deductible: $250 in-network."))
    ).toEqual({ ok: true, quote: "Annual deductible: $250 in-network." });
  });

  it("2. canonicalizes whitespace/newline-normalized quotes to source text", () => {
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-1", 1, "Annual   deductible:\n$250 in-network."))
    ).toEqual({ ok: true, quote: "Annual deductible: $250 in-network." });
  });

  it("3. passes Unicode quote/dash normalization", () => {
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-1", 2, 'Emergency copay - $100, "waived" if admitted.'))
    ).toEqual({ ok: true, quote: "Emergency copay \u2014 $100, \u201Cwaived\u201D if admitted." });
  });

  it("4. passes soft-hyphen / safe line-wrap normalization", () => {
    const docs = [
      { documentId: "doc-1", pageCount: 1, pages: ["out-of-pocket maxi-\nmum: $3,000."] },
    ];
    expect(
      verifyEvidenceCitation(docs, cite("doc-1", 1, "out-of-pocket maximum: $3,000."))
    ).toEqual({ ok: true, quote: "out-of-pocket maxi-\nmum: $3,000." });
  });

  it("5. repairs ellipsis anchors to the canonical exact source span", () => {
    expect(
      verifyEvidenceCitation(
        DOCS,
        cite("doc-1", 1, "Annual deductible ... out-of-pocket maximum: $3,000.")
      )
    ).toEqual({
      ok: true,
      quote: "Annual deductible: $250 in-network.\nAnnual out-of-pocket maximum: $3,000.",
    });
  });

  it("6. rejects when an ellipsis fragment is missing", () => {
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-1", 1, "Annual deductible ... no such phrase here."))
    ).toEqual({ ok: false });
  });

  it("7. rejects reordered fragments", () => {
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-1", 1, "out-of-pocket maximum: $3,000. ... Annual deductible"))
    ).toEqual({ ok: false });
  });

  it("8. rejects duplicate/ambiguous anchor sequences", () => {
    // "Urgent care copay is $25." occurs twice on page 2.
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-1", 2, "Urgent care copay is $25."))
    ).toEqual({ ok: false });
  });

  it("9. rejects spans exceeding the maximum bound", () => {
    expect(MAX_RECOVERED_SPAN_CHARS).toBe(600);
    const filler = "x".repeat(700);
    const docs = [
      { documentId: "doc-1", pageCount: 1, pages: [`Alpha anchor. ${filler} Omega anchor.`] },
    ];
    expect(
      verifyEvidenceCitation(docs, cite("doc-1", 1, "Alpha anchor. ... Omega anchor."))
    ).toEqual({ ok: false });
  });

  it("10. rejects unknown documents", () => {
    expect(
      verifyEvidenceCitation(DOCS, cite("doc-9", 1, "Annual deductible: $250 in-network."))
    ).toEqual({ ok: false });
  });

  it("11. rejects out-of-range pages", () => {
    const quote = "Annual deductible: $250 in-network.";
    expect(verifyEvidenceCitation(DOCS, cite("doc-1", 0, quote))).toEqual({ ok: false });
    expect(verifyEvidenceCitation(DOCS, cite("doc-1", 99, quote))).toEqual({ ok: false });
  });

  it("12. rejects empty text (empty/whitespace quote, empty page)", () => {
    expect(verifyEvidenceCitation(DOCS, cite("doc-1", 1, ""))).toEqual({ ok: false });
    expect(verifyEvidenceCitation(DOCS, cite("doc-1", 1, "   \n  "))).toEqual({ ok: false });
    const blankPage = [{ documentId: "doc-1", pageCount: 1, pages: ["   \n  "] }];
    expect(
      verifyEvidenceCitation(blankPage, cite("doc-1", 1, "Annual deductible: $250 in-network."))
    ).toEqual({ ok: false });
  });
});
