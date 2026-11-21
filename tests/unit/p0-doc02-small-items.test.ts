// Owner decision 2026-11-21, doc 02 fix 3: smaller misfiled lines, fixed by
// general rules only. Reproduced on an owner PDF: section headings and
// disclaimers in the exclusions row, "… means …" definition lines as
// benefit values, value-less schedule labels shown as values, a legal-
// assistance line under referrals, and per-network coinsurance lines
// duplicated into network rules. Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";

function table(pages: string[]) {
  return extractFallback([{ documentId: "doc-1", filename: "plan.pdf", pageCount: pages.length, pages }], {});
}
const shown = (t: ReturnType<typeof table>, fact: string) => (t.rows.find((r) => r.factName === fact)?.values ?? []).map((v) => v.display);
const withheld = (t: ReturnType<typeof table>, fact: string) => (t.rows.find((r) => r.factName === fact)?.withheld ?? []).map((w) => w.quote);
const verdict = (t: ReturnType<typeof table>, fact: string) => t.rows.find((r) => r.factName === fact)?.verdict;

describe("a value-less label or heading is never a value", () => {
  const t = table([
    ["SUMMARY SCHEDULE OF BENEFITS", "Copay per visit:", "Specialist", "Urgent Care", "$30", "$50", "REPATRIATION OF REMAINS", "Repatriation of remains $50,000"].join("\n"),
  ]);

  it("a document's only label line is withheld for verification, not shown", () => {
    expect(shown(t, "specialist-visit")).toEqual([]);
    expect(withheld(t, "specialist-visit")).toEqual(["Specialist"]);
    expect(verdict(t, "specialist-visit")).toBe("NEEDS VERIFICATION");
  });

  it("a heading next to the fact's real value is dropped", () => {
    expect(shown(t, "repatriation")).toEqual(["Repatriation of remains $50,000"]);
    expect(withheld(t, "repatriation")).toEqual([]);
  });

  it("controls: short lines that state something are kept", () => {
    const c = table([["Maternity Covered as any sickness", "Dental Not covered", "Urgent care $50"].join("\n")]);
    expect(shown(c, "maternity-coverage")).toEqual(["Maternity Covered as any sickness"]);
    expect(shown(c, "dental-coverage")).toEqual(["Dental Not covered"]);
    expect(shown(c, "urgent-care")).toEqual(["Urgent care $50"]);
    const e = table([["Telehealth: Teladoc app"].join("\n")]);
    expect(shown(e, "telehealth")).toEqual(["Telehealth: Teladoc app"]);
    const n = table([["Northwind PPO Network"].join("\n")]);
    expect(shown(n, "network")).toEqual(["Northwind PPO Network"]);
    const d = table([["(c) Coinsurance will be applied.", "Prescriptions subject to deductible", "Surgery except as provided"].join("\n")]);
    expect(shown(d, "coinsurance")).toEqual(["(c) Coinsurance will be applied."]);
    expect(shown(d, "prescriptions")).toEqual(["Prescriptions subject to deductible"]);
    expect(shown(d, "surgery")).toEqual(["Surgery except as provided"]);
  });
});

describe("a '… means …' definition is not a benefit value", () => {
  const t = table([
    [
      "Pre-existing Condition means any illness for which treatment was received before coverage.",
      "Pre-existing conditions Covered",
      "Emergency Medical Evacuation means:",
    ].join("\n"),
  ]);

  it("the definition is dropped where the rule itself is stated", () => {
    expect(shown(t, "pre-existing-conditions")).toEqual(["Pre-existing conditions Covered"]);
  });

  it("a document's only definition line is withheld, not shown", () => {
    expect(shown(t, "emergency-evacuation")).toEqual([]);
    expect(withheld(t, "emergency-evacuation")).toEqual(["Emergency Medical Evacuation means:"]);
  });

  it("controls: 'this means you pay' explains a cost and is kept; limits facts may cite definitions", () => {
    const c = table([["Emergency room: this means you pay $300 per visit", "Dependent means a spouse and each unmarried child under age 26."].join("\n")]);
    expect(shown(c, "emergency-care")).toEqual(["Emergency room: this means you pay $300 per visit"]);
    expect(shown(c, "age-limits")).toEqual(["Dependent means a spouse and each unmarried child under age 26."]);
  });
});

describe("the exclusions row holds exclusions, not references to them", () => {
  const t = table([
    [
      "This summary is subject to the policy's terms, conditions, limits and exclusions.",
      "The policy has limitations",
      "and exclusions. In the event of a discrepancy, the policy will prevail.",
      "(however motorcycle riding is subject to a separate exclusion below);",
      "Charges for cosmetic treatment are not covered.",
    ].join("\n"),
  ]);

  it("keeps the stated exclusion only", () => {
    expect(shown(t, "material-exclusions")).toEqual(["Charges for cosmetic treatment are not covered."]);
  });
});

describe("referrals are medical referrals", () => {
  it("a legal-assistance referral is not a referral requirement", () => {
    const t = table([["• Legal referral to help you locate a consular official or attorney", "A referral from the student health center is required before seeing a specialist."].join("\n")]);
    expect(shown(t, "referral-requirement")).toEqual(["A referral from the student health center is required before seeing a specialist."]);
  });
});

describe("per-network cost shares are not network rules", () => {
  const t = table([
    [
      "Coinsurance out-of-network 70% of usual & customary",
      "Surgeon benefit (inpatient or outpatient) 80% in-network, 70% out-of-network",
      "Mental and nervous disorders (inpatient) 80% in-network and 60% out-of-network.",
      "Treatment by out-of-network providers is paid at the usual and customary rate; you pay any balance.",
    ].join("\n"),
  ]);

  it("network rules keep the rule about using providers", () => {
    expect(shown(t, "network-rules")).toEqual(["Treatment by out-of-network providers is paid at the usual and customary rate; you pay any balance."]);
  });

  it("the coinsurance line stays in coinsurance", () => {
    expect(shown(t, "coinsurance")).toContain("Coinsurance out-of-network 70% of usual & customary");
  });
});
