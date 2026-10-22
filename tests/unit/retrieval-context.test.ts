import { describe, expect, it } from "vitest";
import {
  REFUSAL_TEXT,
  answerQuestion,
  retrieve,
  validateChatResponse,
  type RagDocument,
} from "@/app/lib/rag/answer";

const normForClaim = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const WORLD: RagDocument = {
  documentId: "wt",
  filename: "03_worldtrips_studentsecure.pdf",
  pageCount: 1,
  pages: [
    [
      "Get StudentSecure insurance from WorldTrips, a member of the Tokio Marine HCC group of companies.",
      "About Us",
      "Service and Support",
      "24/7 Assistance Line",
      "Plan Overview",
      "Eligibility Requirements",
      "Enrollment Steps",
      "Renewal Policy",
      "Deductible $0 for eligible claims",
      "Claims Process",
    ].join("\n"),
  ],
};

const SEVEN: RagDocument = {
  documentId: "sc",
  filename: "04_seven_corners_travel_medical_usa.pdf",
  pageCount: 1,
  pages: [
    [
      "Seven Corners Travel Medical Including the USA",
      "About the insurer",
      "Service and Support",
      "24/7 Assistance Line",
      "Plan Overview",
      "Eligibility Requirements",
      "Enrollment Steps",
      "Renewal Policy",
      "Deductible $100 per policy period",
      "Claims Process",
    ].join("\n"),
  ],
};

const TIERS: RagDocument = {
  documentId: "wt-tiers",
  filename: "03_worldtrips_studentsecure.pdf",
  pageCount: 1,
  pages: [
    [
      "StudentSecure Plan Comparison for international students.",
      "BENEFIT          ELITE       SELECT      BUDGET      SMART",
      "Overall Maximum Limit $5,000,000 $1,000,000",
      "Medical Expense Benefit",
      "Deductible $0 $50 $100 $250",
      "Coinsurance 80% 90% 100% 100%",
      "Provider Network PPO PPO PPO PPO",
    ].join("\n"),
  ],
};

describe("retrieval context (P2 false-refusal regression)", () => {
  it("expands a matched line into a window that carries its tier header", () => {
    const hits = retrieve([TIERS], "What is the deductible?");

    expect(hits).toHaveLength(1);
    expect(hits[0].quote).toContain("BENEFIT");
    expect(hits[0].quote).toContain("Deductible $0 $50 $100 $250");
    expect(hits[0].quote).not.toContain("international students");
    expect(normForClaim(TIERS.pages[0])).toContain(normForClaim(hits[0].quote));
  });

  it("supplies a name-bearing passage for every document the question names", () => {
    const hits = retrieve(
      [WORLD, SEVEN],
      "What deductible does WorldTrips StudentSecure offer compared to Seven Corners?"
    );

    expect(hits.some((h) => h.documentId === "wt" && h.quote.includes("WorldTrips"))).toBe(true);
    expect(hits.some((h) => h.documentId === "sc" && h.quote.includes("Seven Corners"))).toBe(true);
    expect(hits.filter((h) => h.quote.includes("Deductible"))).toHaveLength(2);
    for (const h of hits) {
      const page = (h.documentId === "wt" ? WORLD : SEVEN).pages[h.page - 1];
      expect(normForClaim(page)).toContain(normForClaim(h.quote));
    }
  });

  it("adds no identity passage when the question names no document", () => {
    const hits = retrieve([WORLD, SEVEN], "What is the deductible?");

    expect(hits).toHaveLength(2);
    expect(
      hits.every((h) => !h.quote.includes("WorldTrips") && !h.quote.includes("Seven Corners"))
    ).toBe(true);
  });

  it("keeps zero-overlap questions refusing (identity never fabricates evidence)", () => {
    const question = "Does Seven Corners cover Martian telemedicine?";

    expect(retrieve([WORLD, SEVEN], question)).toHaveLength(0);
    expect(answerQuestion([WORLD, SEVEN], question)).toEqual({
      schemaVersion: "v1",
      kind: "refusal",
      refusalText: REFUSAL_TEXT,
    });
  });
});

describe("chat response shape diagnostics", () => {
  it("coerces numeric-string pages from the LLM and rejects non-numeric ones", () => {
    const parsed = validateChatResponse({
      schemaVersion: "v1",
      kind: "answer",
      answerText: "Deductible $0.",
      citations: [{ documentId: "wt", page: "3" as unknown as number, quote: "Deductible $0" }],
    });
    expect(parsed.kind).toBe("answer");
    if (parsed.kind === "answer") {
      expect(parsed.citations[0].page).toBe(3);
    }

    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "Deductible $0.",
        citations: [{ documentId: "wt", page: "abc" as unknown as number, quote: "Deductible $0" }],
      })
    ).toThrow(/malformed citation field=page type=string/);
  });

  it("reports the citation field name and value type", () => {
    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "Deductible $0.",
        citations: [{ documentId: 42 as unknown as string, page: 1, quote: "Deductible $0" }],
      })
    ).toThrow(/malformed citation field=documentId type=number/);

    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        answerText: "Deductible $0.",
        citations: ["nope"],
      })
    ).toThrow(/malformed citation entry type=string/);
  });

  it("reports answerText's type when it is missing", () => {
    expect(() =>
      validateChatResponse({
        schemaVersion: "v1",
        kind: "answer",
        citations: [{ documentId: "wt", page: 1, quote: "Deductible $0" }],
      })
    ).toThrow(/answerText required type=undefined/);
  });
});
