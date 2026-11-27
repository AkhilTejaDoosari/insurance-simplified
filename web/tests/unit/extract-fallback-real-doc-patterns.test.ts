import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { extractQualifiers } from "@/app/lib/extraction/fact-list";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";

function doc(documentId: string, pages: string[]) {
  return { documentId, filename: `${documentId}.pdf`, pageCount: pages.length, pages };
}

describe("deterministic extraction on real-brochure text patterns", () => {
  it("does not present a repeated short table fragment as supported evidence", () => {
    const source = "In PPO Network";
    const input = doc("doc-b", ["In PPO Network\nOut of PPO Network\nIn PPO Network"]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "network");

    expect(row?.values).toEqual([]);
    expect(row?.verdict).toBe("NEEDS VERIFICATION");
    expect(verifyEvidenceCitation([input], {
      documentId: "doc-b",
      page: 1,
      quote: source,
    })).toEqual({ ok: false });
  });

  it("does not infer tier values positionally from a nearby tier heading", () => {
    const input = doc("doc-a", [
      "ELITE SELECT BUDGET SMART\nNetwork reimbursement: 80% in-network",
    ]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "network");

    expect(row?.values).toEqual([]);
    expect(row?.verdict).toBe("NOT STATED");
  });

  it("does not classify a student health-center benefit as student eligibility", () => {
    const input = doc("doc-a", ["Student Health Center: $25 per visit"]);
    const table = extractFallback([input], {});

    expect(table.rows.find((row) => row.factName === "student-eligibility")?.values).toEqual([]);
    expect(table.rows.find((row) => row.factName === "student-health-center")?.values).toHaveLength(1);
    expect(table.rows.find((row) => row.factName === "student-health-center")?.values[0]?.qualifiers.ageBand).toBeUndefined();
  });

  it("does not classify a general eligible-expenses clause as enrollment eligibility", () => {
    const input = doc("doc-a", ["Eligible expenses are subject to applicable copayments."]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "eligibility");

    expect(row?.values).toEqual([]);
  });

  it("does not classify premium-refund text as a premium price", () => {
    const input = doc("doc-a", ["Only premium for an unused whole month is eligible for refund."]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "premium");

    expect(row?.values).toEqual([]);
  });

  it("does not classify a section heading as eligibility evidence", () => {
    const input = doc("doc-b", ["Who Can Buy and Where Can I Travel?"]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "eligibility");

    expect(row?.values).toEqual([]);
  });

  it("does not classify generic international-student prose as eligibility evidence", () => {
    const input = doc("doc-a", ["This coverage was designed for international students and scholars studying abroad."]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "student-eligibility");

    expect(row?.values).toEqual([]);
  });

  it("excludes deductible recommendations and boilerplate but keeps the labeled options", () => {
    const recommendation = "We recommend selecting the Zenith Choice option with a $0 deductible to satisfy minimum requirements.";
    const boilerplate = "Every medical and dental benefit is subject to deductible and/or copay.";
    const options = "Deductible Options (You pay): $0 - $5,000 (Choose the option you want.)";
    const input = doc("doc-b", [recommendation, boilerplate, options]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "annual-deductible");

    expect(row?.values.map((value) => value.evidence[0]?.quote)).toEqual([options]);
  });

  it("preserves the strict under-age condition in the displayed age fact", () => {
    const input = doc("doc-a", ["You must be under age 65; and"]);
    const row = extractFallback([input], {}).rows.find((candidate) => candidate.factName === "age-limits");

    expect(row?.values).toHaveLength(1);
    expect(row?.values[0]).toMatchObject({
      // Verbatim source display; the condition stays in qualifiers.ageBand.
      display: "You must be under age 65; and",
      qualifiers: { ageBand: "under age 65" },
    });
  });

  it("extracts age qualifiers only when the source explicitly marks an age", () => {
    expect(extractQualifiers("Student Health Center: $25 per visit").ageBand).toBeUndefined();
    expect(extractQualifiers("Maximum age 65").ageBand).toBe("age 65");
  });

  it("keeps each document's extracted facts identical when processed alone or together", () => {
    const docA = doc("doc-a", ["Annual deductible: $0 for Zenith Student Elite."]);
    const docB = doc("doc-b", ["Annual deductible: $250 for Zenith Travel Basic."]);
    const alone = extractFallback([docA], {});
    const combined = extractFallback([docA, docB], {});
    const valuesFor = (table: ReturnType<typeof extractFallback>, id: string) =>
      table.rows.flatMap((row) => row.values
        .filter((value) => value.documentId === id)
        .map((value) => [row.factName, value.display, value.qualifiers, value.evidence]));

    expect(valuesFor(combined, "doc-a")).toEqual(valuesFor(alone, "doc-a"));
  });
});
