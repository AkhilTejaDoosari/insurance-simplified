import { describe, expect, it, vi } from "vitest";
import { summarizeRulesDisplay } from "@/app/lib/extraction/rules-display";
import { extractFallback, extractViaLlm } from "@/app/lib/extraction/extract";
import { completeJson } from "@/app/lib/llm/client";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));

const mockedComplete = vi.mocked(completeJson);

const doc = (pages: string[]) => ({
  documentId: "doc-1",
  filename: "a.pdf",
  pageCount: 1,
  pages,
});

describe("summarizeRulesDisplay", () => {
  it("scopes preauthorization to the benefit it governs", () => {
    expect(
      summarizeRulesDisplay("preauthorization", "Preauthorization required for inpatient admission."),
    ).toEqual({ display: "Preauthorization required for inpatient admission", certain: true });
  });

  it("states absent preauthorization plainly", () => {
    expect(
      summarizeRulesDisplay("preauthorization", "No preauthorization required for emergency care."),
    ).toEqual({ display: "No preauthorization required", certain: true });
  });

  it("distinguishes referral direction without inferring silence", () => {
    expect(summarizeRulesDisplay("referral-requirement", "No referral required.")).toEqual({
      display: "No referral required",
      certain: true,
    });
    expect(
      summarizeRulesDisplay("referral-requirement", "You must obtain a referral from your PCP."),
    ).toEqual({ display: "Referral required", certain: true });
    expect(
      summarizeRulesDisplay("referral-requirement", "Referral rules vary by network tier."),
    ).toEqual({ display: "Referral rules vary by network tier.", certain: false });
  });

  it("condenses exclusions to the excluded item", () => {
    expect(summarizeRulesDisplay("material-exclusions", "Adventure sports excluded.")).toEqual({
      display: "Adventure sports excluded",
      certain: true,
    });
  });

  it("keeps waiting-period scope and duration together", () => {
    expect(
      summarizeRulesDisplay("waiting-period", "12-month waiting period for pre-existing conditions."),
    ).toEqual({ display: "12 months for pre-existing conditions", certain: true });
    expect(
      summarizeRulesDisplay("waiting-period", "6 months waiting period for maternity care."),
    ).toEqual({ display: "6 months for maternity care", certain: true });
  });

  it("renders plan duration rules, never intake dates", () => {
    expect(summarizeRulesDisplay("coverage-duration", "Maximum trip duration 90 days.")).toEqual({
      display: "Maximum trip duration 90 days",
      certain: true,
    });
    expect(summarizeRulesDisplay("coverage-duration", "Renewable up to 48 months.")).toEqual({
      display: "Renewable up to 48 months",
      certain: true,
    });
  });

  it("renders plan age rules concisely", () => {
    expect(summarizeRulesDisplay("age-limits", "Must be at least 31 days old and not yet 65 years old.")).toEqual({
      display: "31 days–65 years",
      certain: true,
    });
    expect(summarizeRulesDisplay("age-limits", "Maximum age 64.")).toEqual({
      display: "Maximum age 64",
      certain: true,
    });
  });

  it("normalizes explicit mathematical age bounds instead of punting", () => {
    expect(summarizeRulesDisplay("age-limits", "Eligibility: 31 days to < 65 years.")).toEqual({
      display: "31 days to under 65 years",
      certain: true,
    });
    expect(summarizeRulesDisplay("age-limits", "Covered through age <= 64 years.")).toEqual({
      display: "Maximum age 64",
      certain: true,
    });
    expect(summarizeRulesDisplay("age-limits", "Age 18–64 years.")).toEqual({
      display: "Age 18–64",
      certain: true,
    });
    expect(summarizeRulesDisplay("age-limits", "Insureds < 65 years of age.")).toEqual({
      display: "Maximum age 65",
      certain: true,
    });
  });

  it("handles real brochure phrasing variants without punting", () => {
    expect(
      summarizeRulesDisplay("age-limits", "Be at least 31 days old but not yet 65 years old."),
    ).toEqual({ display: "31 days–65 years", certain: true });
  });

  it("keeps genuinely ambiguous age wording uncertain and verbatim", () => {
    const line = "Age limits apply as determined at enrollment.";
    expect(summarizeRulesDisplay("age-limits", line)).toEqual({
      display: line,
      certain: false,
    });
  });

  it("pairs network scopes with their percentages", () => {
    expect(
      summarizeRulesDisplay("network-rules", "Coinsurance: 90% in-network, 80% out-of-network."),
    ).toEqual({ display: "In-network: 90%; Out-of-network: 80%", certain: true });
  });
});

describe("rules extraction", () => {
  it("fallback emits scoped preauthorization with evidence", () => {
    const table = extractFallback(
      [doc(["Preauthorization required for inpatient admission."])],
      {},
    );
    const row = table.rows.find((r) => r.factName === "preauthorization")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].display).toBe("Preauthorization required for inpatient admission");
  });

  it("fallback marks unclear referrals NEEDS VERIFICATION instead of guessing", () => {
    const table = extractFallback([doc(["Referral rules vary by network tier."])], {});
    const row = table.rows.find((r) => r.factName === "referral-requirement")!;
    expect(row.verdict).toBe("NEEDS VERIFICATION");
  });

  it("fallback never invents a no-exclusions claim from silence", () => {
    const table = extractFallback([doc(["Annual deductible: $250."])], {});
    const row = table.rows.find((r) => r.factName === "material-exclusions")!;
    expect(row.verdict).toBe("NOT STATED");
    expect(row.values).toEqual([]);
  });

  it("LLM path rewrites rules displays through the same interpreter", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
      rows: [
        {
          factName: "waiting-period",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "12 months",
              qualifiers: {},
              evidence: [
                { documentId: "doc-1", page: 1, quote: "12-month waiting period for pre-existing conditions." },
              ],
            },
          ],
        },
      ],
    });
    const table = await extractViaLlm([doc(["12-month waiting period."])], {});
    const row = table.rows.find((r) => r.factName === "waiting-period")!;
    expect(row.values[0].display).toBe("12 months for pre-existing conditions");
  });

  it("LLM path normalizes the real brochure age quote", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
      rows: [
        {
          factName: "age-limits",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "31 days to < 65 years",
              qualifiers: {},
              evidence: [
                { documentId: "doc-1", page: 9, quote: "Be at least 31 days old but not yet 65 years old." },
              ],
            },
          ],
        },
      ],
    });
    const table = await extractViaLlm([doc(["Be at least 31 days old but not yet 65 years old."])], {});
    const row = table.rows.find((r) => r.factName === "age-limits")!;
    expect(row.values[0].display).toBe("31 days–65 years");
  });
});
