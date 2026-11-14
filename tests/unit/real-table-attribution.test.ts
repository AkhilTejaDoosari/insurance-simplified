// Real-PDF regression for table claims (local brochures under nonstandard/,
// git-ignored; skipped when absent). Each case is a claim the previous line engine
// got wrong (merged tier/network columns, lost tier, wrong polarity) and is
// checked here against the attributed, column-scoped table claim.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";

const FILES = [
  ["doc-1", "nonstandard/01_img_patriot_exchange_2026.pdf"],
  ["doc-2", "nonstandard/03_worldtrips_studentsecure.pdf"],
  ["doc-3", "nonstandard/04_seven_corners_travel_medical_usa.pdf"],
] as const;

// The brochures are licensed and git-ignored: absent in a fresh clone/CI, the
// suite is reported as SKIPPED (never PASS).
const available = FILES.every(([, file]) => existsSync(file));

let table: ComparisonTable;
beforeAll(async () => {
  if (!available) return;
  const docs = [];
  for (const [documentId, file] of FILES) {
    const { pageCount, pages, tables } = await extractPages(new Uint8Array(readFileSync(file)), basename(file));
    docs.push({ documentId, filename: basename(file), pageCount, pages, tables });
  }
  table = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
}, 60_000);

const attributed = (fact: string, doc: string) =>
  table.rows.find((r) => r.factName === fact)!.values.filter((v) => v.documentId === doc && v.planId);
/** The cell line of each scoped claim (governing notes follow on later
 *  lines; they are asserted in their own tests). */
const scoped = (fact: string, doc: string, key: "planTier" | "networkTier" | "conditions", scope: string) =>
  attributed(fact, doc).filter((v) => v.qualifiers[key] === scope).map((v) => v.display.split("\n")[0]);

describe.skipIf(!available)("real brochures: column-scoped table claims", () => {
  it("IMG out-of-pocket maximum is per network column, never one merged line", () => {
    expect(scoped("out-of-pocket-maximum", "doc-1", "networkTier", "In-Network")).toEqual(["Out of Pocket Maximum (United States In-Network): $1,000"]);
    expect(scoped("out-of-pocket-maximum", "doc-1", "networkTier", "Out-of-Network")).toEqual(["Out of Pocket Maximum (United States Out-of-Network): Up to the Maximum Limit"]);
    expect(scoped("out-of-pocket-maximum", "doc-1", "conditions", "International")).toEqual(["Out of Pocket Maximum (International): $0"]);
    expect(attributed("out-of-pocket-maximum", "doc-1").some((v) => /\$1,000.*Up to/.test(v.display))).toBe(false);
  });

  it("StudentSecure preventive care keeps its qualifier and tier; other tiers' exclusion stays separate", () => {
    expect(scoped("preventive-care", "doc-2", "planTier", "ELITE")).toEqual(["Preventative Care (ELITE Limit): Up to $200 after 6 months of continuous coverage"]);
    expect(scoped("preventive-care", "doc-2", "planTier", "SELECT")).toEqual(["Preventative Care (SELECT Limit): No coverage"]);
  });

  it("StudentSecure maternity limits differ by tier, and SMART is an exclusion", () => {
    expect(scoped("maternity-coverage", "doc-2", "planTier", "ELITE")).toContain("Maternity Care for a Covered Pregnancy (ELITE Limit): Up to $15,000 lifetime maximum");
    expect(scoped("maternity-coverage", "doc-2", "planTier", "SMART")).toEqual(["Maternity Care for a Covered Pregnancy (SMART Limit): No coverage"]);
  });

  it("never claims 'No waiting period' for a pre-existing condition row that states waiting periods", () => {
    const all = table.rows.flatMap((r) => r.values).filter((v) => v.documentId === "doc-2");
    expect(all.some((v) => /^No waiting period/i.test(v.display))).toBe(false);
  });

  it("Seven Corners Basic and Choice ambulance limits are separate tier claims", () => {
    // Line 1 is the cell; following lines are its governing notes (here the
    // schedule preamble "All benefits shown below…", table-governing-notes.test.ts).
    const cell = (tier: string) => scoped("ambulance", "doc-3", "planTier", tier);
    expect(cell("Basic")).toEqual(["Local Ambulance (Travel Medical Basic Reliable Coverage): Inside the United States: $5,000 Outside the United States: Up to medical maximum"]);
    expect(cell("Choice")).toEqual(["Local Ambulance (Travel Medical Choice Most popular): Inside the United States: $10,000 Outside the United States: Up to medical maximum"]);
    for (const v of attributed("ambulance", "doc-3")) expect(v.display).toMatch(/\nSCHEDULE OF BENEFITS All benefits shown below/);
  });

  // Section restriction lines (IMG pp. 4–6, authored from the source PDF):
  // p4 rows sit under "Subject to Deductible unless otherwise noted…" (above
  // the header); p6 Emergency Services rows under "NOT Subject to Deductible
  // unless otherwise noted…" — and never under the contradicting p4/p6 one.
  it("IMG section restrictions are carried by the rows they govern, and only those", () => {
    const lines = (v: { display: string }) => v.display.split("\n").slice(1).join(" | ");
    for (const v of attributed("emergency-evacuation", "doc-1")) {
      expect(v.display.split("\n")[1]).toBe("NOT Subject to Deductible unless otherwise noted Eligible Medical Expenses are limited to Usual, Reasonable and Customary Limits per Period of Coverage unless stated as Maximum Limit");
      expect(v.display).not.toMatch(/\n(?:Inpatient or Outpatient Services |Mental or Nervous \/ Substance Abuse )?Subject to Deductible/);
    }
    for (const v of attributed("urgent-care", "doc-1")) {
      expect(lines(v)).toBe("Inpatient or Outpatient Services Subject to Deductible unless otherwise noted Eligible Medical Expenses are limited to Usual, Reasonable and Customary Limits per Period of Coverage unless stated as Maximum Limit");
    }
    for (const v of attributed("out-of-pocket-maximum", "doc-1")) expect(lines(v)).toBe("Coinsurance for Eligible Medical Expenses");
  });

  // IMG p3 "Pre-certification" names two p6 benefits exactly; each p6 claim
  // carries its named rule, cited on p3 (gold text from the source PDF).
  it.each([
    ["ambulance", /^Interfacility Ambulance Transfer\b/, "• Interfacility Ambulance Transfer: No coverage if Pre-certification requirements are not met."],
    ["emergency-evacuation", /^Emergency Medical Evacuation\b/, "• Emergency Medical Evacuation: No coverage if not approved by the Company. Refer to the EMERGENCY MEDICAL EVACUATION provision for complete requirements and coverage."],
  ])("IMG %s %s carries its named p3 pre-certification rule", (fact, label, rule) => {
    const vs = attributed(fact, "doc-1").filter((v) => label.test(v.display));
    expect(vs.length).toBe(3);
    for (const v of vs) {
      expect(v.display.split("\n")).toContain(rule);
      expect(v.evidence.some((e) => e.page === 3 && e.quote.replace(/\s+/g, " ") === rule)).toBe(true);
    }
  });

  it("StudentSecure p3 claims carry the page's general note", () => {
    const note = "Eligible expenses are subject to applicable copayments, coinsurance, overall maximum limit, and are per certificate period unless specifically indicated otherwise.";
    const p3 = table.rows.flatMap((r) => r.values).filter((v) => v.documentId === "doc-2" && v.planId && v.evidence[0].page === 3);
    expect(p3.length).toBeGreaterThan(0);
    for (const v of p3) expect(v.display.split("\n").map((l) => l.replace(/\s+/g, " ").trim())).toContain(note);
  });

  it("IMG percentages carry what they mean (Plan Pays) in scope and display", () => {
    const pt = attributed("physical-therapy", "doc-1");
    expect(pt.map((v) => [v.qualifiers.networkTier ?? null, v.qualifiers.conditions])).toEqual([
      ["In-Network", "Plan Pays"], ["Out-of-Network", "Plan Pays"], [null, "International Plan Pays"],
    ]);
    expect(pt.every((v) => /Plan Pays\): \d+%$/.test(v.display.split("\n")[0]))).toBe(true);
  });

  // Full source provisions (IMG pp. 4 and 6), not the extracted parent cell:
  // every material condition of the provision must be in an attributed claim's
  // display, or the provision must not be attributed at all.
  it.each([
    ["urgent-care", /^Urgent Care\b/, [/Not subject to Deductible/, /Copayment: \$50/, /Copayment is not applicable if the Declaration states a \$0 Deductible/]],
    ["urgent-care", /^Walk-in Clinic\b/, [/Not subject to Deductible/, /Copayment: \$20/, /Copayment is not applicable if the Declaration states a \$0 Deductible/]],
    ["emergency-reunion", /^Emergency Reunion\b/, [/Maximum Limit: \$15,000/, /Maximum Days: 15/, /Meal Maximum per day: \$25/, /Reasonable and necessary travel costs and accommodations/, /Must be approved in advance by the Company/]],
    ["ambulance", /^Interfacility Ambulance Transfer\b/, [/Up to the per Injury or Illness limit/, /Services rendered in the United States/, /Transfer must be a result of an Inpatient Hospital admission/]],
  ] as const)("IMG %s %s: attributed only with every material condition", (fact, label, conditions) => {
    const claims = attributed(fact, "doc-1").filter((v) => label.test(v.display));
    for (const v of claims) {
      const text = v.display.replace(/\s+/g, " ");
      for (const c of conditions) expect(text, v.display).toMatch(c);
    }
  });

  it("IMG table provisions keep their conditions: complete claims are attributed", () => {
    expect(attributed("urgent-care", "doc-1").filter((v) => /^Urgent Care\b/.test(v.display)).length).toBe(3);
    expect(attributed("emergency-reunion", "doc-1").length).toBe(3);
  });

  it("every attributed value is a verified table cell with a header citation", () => {
    const all = table.rows.flatMap((r) => r.values.filter((v) => v.planId));
    expect(all.length).toBeGreaterThan(50);
    // Row + header citation, plus one citation per governing note line.
    expect(all.every((v) => v.anchor && v.evidence.length === 2 + v.display.split("\n").length - 1)).toBe(true);
  });

  it("does not derive a cost type from a 'not subject to' condition", () => {
    const ad = attributed("ad-and-d", "doc-2");
    expect(ad.length).toBeGreaterThan(0);
    expect(ad.some((v) => v.qualifiers.costType === "coinsurance")).toBe(false);
  });
});
