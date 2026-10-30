import { describe, expect, it } from "vitest";
import {
  attestPlans,
  resolveRowPlanIds,
} from "@/app/lib/extraction/plan-identity";
import {
  adaptCompactValue,
  recognizeExperimentalPlanTitle,
} from "@/scripts/p2-experiment/compact-adapter";

const DOC_ID = "synthetic-plan";
const pageText =
  "Northstar Health®\nAnnual deductible: $1,000 calendar year.";
const syntheticDoc = {
  documentId: DOC_ID,
  filename: "source.pdf",
  pageCount: 1,
  pages: [pageText],
};

function candidate(
  overrides: Partial<Parameters<typeof adaptCompactValue>[0]> = {},
) {
  return {
    documentId: DOC_ID,
    concept: "deductible",
    value: "$1,000 calendar year deductible",
    scope: {},
    evidence: [{ page: 1, quote: "Annual deductible: $1,000 calendar year." }],
    ...overrides,
  };
}

describe("P2 experimental compact adapter", () => {
  it("accepts an exact, complete synthetic deductible candidate", () => {
    const result = adaptCompactValue(candidate(), [syntheticDoc]);
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.row.factName).toBe("Annual deductible");
      expect(result.row.values[0].evidence[0].quote).toBe(
        "Annual deductible: $1,000 calendar year.",
      );
      expect(result.row.values[0].planId).toBeUndefined();
    }
  });

  it("accepts a source-bound period when the current schema can preserve it", () => {
    const result = adaptCompactValue(
      candidate({ scope: { period: "calendar year" } }),
      [syntheticDoc],
    );
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.row.values[0].qualifiers.period).toBe("calendar year");
    }
  });

  it("rejects enrollment scope that the current schema cannot represent", () => {
    expect(
      adaptCompactValue(candidate({ scope: { enrollment: "Self Only" } }), [
        syntheticDoc,
      ]).status,
    ).toBe("unmappable");
  });

  it("rejects a candidate when its declared required enrollment qualifier is missing", () => {
    expect(
      adaptCompactValue(candidate({ requiredScope: ["enrollment"] }), [
        syntheticDoc,
      ]).status,
    ).toBe("incomplete");
  });

  it("rejects unsupported exceptions and unknown scope keys instead of dropping them", () => {
    expect(
      adaptCompactValue(
        candidate({ scope: { exceptions: "except emergency care" } }),
        [syntheticDoc],
      ).status,
    ).toBe("unmappable");
    expect(
      adaptCompactValue(candidate({ scope: { inventedScope: "x" } as any }), [
        syntheticDoc,
      ]).status,
    ).toBe("unsupported");
  });

  it("rejects a value whose amount is not grounded by its citation", () => {
    expect(
      adaptCompactValue(
        candidate({ value: "$2,000 calendar year deductible" }),
        [syntheticDoc],
      ).status,
    ).toBe("incomplete");
  });

  it("rejects wrong-page citations and malformed document identities", () => {
    expect(
      adaptCompactValue(
        candidate({
          evidence: [
            { page: 2, quote: "Annual deductible: $1,000 calendar year." },
          ],
        }),
        [syntheticDoc],
      ).status,
    ).toBe("incomplete");
    expect(
      adaptCompactValue(candidate({ documentId: "other-document" }), [
        syntheticDoc,
      ]).status,
    ).toBe("unsupported");
  });

  it("recognizes a source title diagnostically without changing production attestation or C6", () => {
    expect(recognizeExperimentalPlanTitle("Northstar Health", syntheticDoc)).toEqual({
      recognized: true,
      name: "Northstar Health",
    });
    const productionPlans = attestPlans([syntheticDoc]);
    expect(productionPlans).toHaveLength(0);
    expect(
      resolveRowPlanIds(
        "Annual deductible",
        [
          {
            documentId: DOC_ID,
            display: "$1,000 calendar year deductible",
            qualifiers: {},
            evidence: [
              {
                documentId: DOC_ID,
                page: 1,
                quote: "Annual deductible: $1,000 calendar year.",
              },
            ],
          },
        ],
        productionPlans,
        [syntheticDoc],
      ),
    ).toEqual([undefined]);
    expect(
      recognizeExperimentalPlanTitle("Northstar Health", {
        ...syntheticDoc,
        pages: ["Program overview\nNorthstar Health is another plan."],
      }).recognized,
    ).toBe(false);
    expect(
      recognizeExperimentalPlanTitle("Phantom Health", {
        ...syntheticDoc,
        pages: ["Northstar Health\nSee Phantom Health for comparison."],
      }).recognized,
    ).toBe(false);
    expect(
      recognizeExperimentalPlanTitle("Northstar Health", {
        ...syntheticDoc,
        pages: ["Plan name: Northstar Health\nPlan name: Competitor Gold"],
      }).recognized,
    ).toBe(false);
  });
});
