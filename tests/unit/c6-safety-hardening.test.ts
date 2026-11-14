// C6 safety hardening (Option B, abstention-only). Every passage is verbatim
// from the extracted text of the authorized corpus: IMG Patriot Exchange
// (doc-1), WorldTrips StudentSecure (doc-2), Seven Corners Travel Medical
// (doc-3) and FEP Blue Focus (tests/fixtures/fep-pages). Pure functions only;
// no LLM, network or PDFs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRowPlanIds } from "@/app/lib/extraction/plan-identity";
import { extractFallback } from "@/app/lib/extraction/extract";
import type { CellValue, ProvenPlan } from "@/app/lib/extraction/types";

const FEP_P1 = readFileSync(join(process.cwd(), "tests/fixtures/fep-pages/fep-blue-focus-p1.txt"), "utf8");

const PLANS: Record<string, ProvenPlan> = {
  "doc-1": { planId: "plan-img", name: "Patriot Exchange ProgramSM", sources: [{ documentId: "doc-1", page: 1, quote: "Patriot Exchange ProgramSM" }] },
  "doc-2": { planId: "plan-ss", name: "StudentSecure", sources: [{ documentId: "doc-2", page: 1, quote: "Get StudentSecure insurance from WorldTrips, a member of the Tokio Marine HCC group of" }] },
  "doc-3": { planId: "plan-sc", name: "Travel Medical Including the USA", sources: [{ documentId: "doc-3", page: 1, quote: "Seven Corners Travel Medical Including the USA" }] },
  fep: { planId: "plan-fep", name: "FEP® Blue Focus", sources: [{ documentId: "fep", page: 1, quote: "FEP® Blue Focus" }] },
};
const FIRST_PAGE: Record<string, string> = {
  "doc-1": "Patriot Exchange ProgramSM\nCertificate of Insurance",
  "doc-2": "Get StudentSecure insurance from WorldTrips, a member of the Tokio Marine HCC group of",
  "doc-3": "Seven Corners Travel Medical Including the USA",
  fep: FEP_P1,
};
const docOf = (documentId: string) => ({ documentId, filename: `${documentId}.pdf`, pages: [FIRST_PAGE[documentId]] });

const v = (documentId: string, page: number, quote: string, display = quote, qualifiers: CellValue["qualifiers"] = {}): CellValue => ({
  documentId, display, qualifiers, evidence: [{ documentId, page, quote }],
});
/** Stage E for one row of one document, exactly as the route calls it. */
const resolve = (fact: string, values: CellValue[]) => {
  const documentId = values[0].documentId;
  return resolveRowPlanIds(fact, values, [PLANS[documentId]], [docOf(documentId)]);
};

// ------------------------------------------------------------------ unsafe
const IMG_TELEHEALTH_EXCLUSION = v("doc-1", 24, "(9) Telehealth or Telemedicine services not considered Medically Necessary as determined by the Company under the plan");
const IMG_TELEHEALTH_DEF = v("doc-1", 32, "Telehealth: The distribution of health-related services and information via electronic information and telecommunication");
const IMG_TELEMEDICINE_DEF = v("doc-1", 32, "Telemedicine: A process where an Insured Person is teleconferenced for a Teleconsultation with a qualified Physician but");

const FEP_PREMIUM_TOC = v("fep", 3, "• When benefits and premiums start ...............................................................................................................................10", undefined, { conditions: "When" });
const FEP_PREMIUM_NARRATIVE = [
  v("fep", 2, "Medicare’s prescription drug coverage, your monthly Medicare Part D premium will go up at least 1 percent per month for every", undefined, { period: "per month" }),
  v("fep", 2, "your premium will always be at least 19% higher than what many other people pay. You will have to pay this higher premium as long"),
  v("fep", 12, "new plan.Annuitants’coverage and premiums begin on January 1. If you joined at any other time", undefined, { conditions: "If" }),
  v("fep", 104, "Services when benefits are payable under Medicare, or state premium taxes however applied. See Section 9.", undefined, { conditions: "when" }),
];

describe("1. IMG telehealth exclusion is not promoted by glossary removal", () => {
  it("abstains when the exclusion item is alone in its row", () => {
    expect(resolve("telehealth", [IMG_TELEHEALTH_EXCLUSION])).toEqual([undefined]);
  });
  it("gives the same answer with and without the glossary definitions", () => {
    const withDefs = resolve("telehealth", [IMG_TELEHEALTH_EXCLUSION, IMG_TELEHEALTH_DEF, IMG_TELEMEDICINE_DEF]);
    const without = resolve("telehealth", [IMG_TELEHEALTH_EXCLUSION]);
    expect(without[0]).toBe(withDefs[0]);
  });
});

describe("2. FEP Medicare Part D penalty narrative is not promoted by TOC removal", () => {
  it("abstains on every narrative premium value without the TOC line", () => {
    expect(resolve("premium", FEP_PREMIUM_NARRATIVE)).toEqual([undefined, undefined, undefined, undefined]);
  });
  it("gives the same answer with and without the TOC line", () => {
    const withToc = resolve("premium", [...FEP_PREMIUM_NARRATIVE, FEP_PREMIUM_TOC]).slice(0, 4);
    expect(resolve("premium", FEP_PREMIUM_NARRATIVE)).toEqual(withToc);
  });
  it("abstains on the truncated pre-existing fragment once the TOC line is gone", () => {
    expect(resolve("pre-existing-conditions", [v("fep", 10, "• No pre-existing")])).toEqual([undefined]);
  });
});

describe("3. FEP partial enrollment fragment fails the scope gate", () => {
  it("abstains on the wrapped '…and Family contracts … $22,000' line", () => {
    const fragment = v("fep", 17, "and Family contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000 (see page 29).");
    expect(resolve("out-of-pocket-maximum", [fragment])).toEqual([undefined]);
  });
});

describe("4. Seven Corners evacuation limits are not emergency-care amounts", () => {
  const P3 = [
    // Verbatim p3 line that the engine treats as a Basic/Choice tier header.
    "You can find exclusions for this plan in the Travel Medical Basic and Travel Medical Choice plan document.",
    "Travel Medical Basic",
    "Reliable Coverage",
    "Travel Medical Choice",
    "Most popular",
    "EMERGENCY SERVICES AND ASSISTANCE*",
    "Emergency Medical Evacuation & Repatriation $250,000 (separate from medical maximum) $500,000 (separate from medical maximum)",
    "Emergency Medical Reunion $2,000 $2,000",
  ].join("\n");
  const table = extractFallback([{ documentId: "doc-3", filename: "sc.pdf", pageCount: 1, pages: [P3] }], {});
  const displays = (fact: string) => table.rows.find((r) => r.factName === fact)!.values.map((x) => x.display).join(" | ");

  it("does not borrow the evacuation line's amounts into emergency-care", () => {
    expect(displays("emergency-care")).not.toMatch(/\$250,000|\$500,000/);
  });
  it("keeps the evacuation amounts under emergency-evacuation", () => {
    expect(displays("emergency-evacuation")).toMatch(/\$250,000/);
    expect(displays("emergency-evacuation")).toMatch(/\$500,000/);
  });
  it("abstains on an emergency-care value whose own citation names a different concept", () => {
    const borrowed = v("doc-3", 3, "Emergency Medical Evacuation & Repatriation $250,000 (separate from medical maximum) $500,000 (separate from medical maximum)", "$250,000");
    expect(resolve("emergency-care", [borrowed])).toEqual([undefined]);
  });
});

describe("5. truncated negations and incomplete fragments are not verified-plan facts", () => {
  it.each([
    ["chiropractic", v("doc-2", 4, "& Chiropractic Care (Not")],
    ["ad-and-d", v("doc-2", 5, "Dismemberment (Not subject")],
    ["emergency-reunion", v("doc-2", 5, "Emergency Reunion (Not sub-")],
    ["student-health-center", v("doc-2", 6, "from a student health center.")],
    ["dental-coverage", v("doc-2", 8, "medical facilities, medical and dental")],
    ["eligibility", v("doc-2", 7, "2. You must be residing outside your")],
    ["premium", v("doc-1", 21, "(2) the Insured Person has timely paid applicable Premium for at least thirty (30) days of continuous coverage")],
    ["eligibility", v("doc-1", 10, "proceeding can be brought after the expiration of three (3) years after the time written Proof of Claim is required to be")],
  ])("%s: abstains", (fact, value) => {
    expect(resolve(fact, [value])).toEqual([undefined]);
  });

  it.each([
    ["Accidental Death &", "dental-coverage"],
    ["condition provisions, and all other", "vision-coverage"],
  ])("'%s' is not classified as %s", (line, fact) => {
    const t = extractFallback([{ documentId: "d", filename: "d.pdf", pageCount: 1, pages: [line] }], {});
    expect(t.rows.find((r) => r.factName === fact)!.values).toEqual([]);
  });
});

// ------------------------------------------- former line-value "positive controls"
// Policy 2026-11-14: a PDF line is never attributed to a plan by inference
// (document ownership or plan-name mention). Several of these former positive
// controls were measured WRONG on the real PDFs: the Out-of-Pocket line merges
// In-Network $1,000 / Out-of-Network "Up to the Maximum Limit" / International
// $0; "Preventative Care Up to $200 after 6 months" drops the tier (other tiers:
// "No coverage") and "of continuous coverage"; the ambulance/chiropractic/
// incidental-trip lines merge the Basic and Choice columns. The same facts are
// now attributed from the table layout with their column scope
// (table-attribution.test.ts, real-table-attribution.test.ts).
describe("former line-value positive controls stay unattributed", () => {
  it.each([
    ["ambulance", v("doc-3", 2, "Local Ambulance Inside the United States: $5,000")],
    ["chiropractic", v("doc-3", 2, "Physiotherapy & Chiropractic Care N/A $50 per visit; 10 visits maximum")],
    // Stated geographic scope must be preserved in validated qualifiers
    // (evidence binding); see the scope-preservation control below.
    ["coinsurance", v("doc-3", 2, "Coinsurance Outside the United States (The plan pays) We pay 100% to the medical maximum. We pay 100% to the medical maximum.", "Plan pays 100%", { conditions: "Outside the United States" })],
    ["incidental-trip", v("doc-3", 2, "Incidental Trips to Home Country $5,000 (available with 30 days of coverage) $10,000 (available with 30 days of coverage)")],
    ["emergency-evacuation", v("doc-3", 3, "Emergency Medical Evacuation & Repatriation $250,000 (separate from medical maximum) $500,000 (separate from medical maximum)", "$250,000")],
    ["eligibility", v("doc-3", 1, "Travelers must be non-U.S. residents who are 14 days of age or older. Green Card/Permanent Resident Card holders")],
    ["annual-deductible", v("doc-3", 2, "Deductible Options (You pay) $0 - $5,000 (Choose the option you want.) $0 - $5,000 (Choose the option you want.)")],
    ["out-of-pocket-maximum", v("doc-1", 3, "Out of Pocket Maximum $1,000 Up to the Maximum")],
    ["annual-deductible", v("doc-2", 3, "Deductible $0 $0 $0 $0", "$0", { planTier: "ELITE" })],
    ["preventive-care", v("doc-2", 4, "Preventative Care Up to $200 after 6 months")],
    ["eligibility", v("doc-2", 7, "1. You must be under age 65; and")],
    // Exclusion with explicit, self-contained polarity (tier cell).
    ["terrorism-coverage", v("doc-2", 4, "Terrorism Up to $50,000 lifetime maximum; eligible medical expenses only No coverage", "No coverage", { planTier: "SMART" })],
  ])("%s line value is not attributed", (fact, value) => {
    expect(resolve(fact, [value])).toEqual([undefined]);
  });
});

describe("stated scope is preserved, never synthesized (evidence binding)", () => {
  it("doc-3 coinsurance without its outside-US scope abstains", () => {
    const quote = "Coinsurance Outside the United States (The plan pays) We pay 100% to the medical maximum. We pay 100% to the medical maximum.";
    expect(resolve("coinsurance", [v("doc-3", 2, quote, "Plan pays 100%")])).toEqual([undefined]);
  });
});

// ------------------------------------------------- independent review (BLOCK)
describe("R1. money or numbers cannot turn a glossary definition into a provision", () => {
  const DEF = "Telehealth: The distribution of health-related services and information via electronic information and telecommunication.";
  it.each([
    ["The + $ fee", `${DEF} Administrative fee: $100.`],
    ["lowercase the", DEF.replace(": The ", ": the ") + " Administrative fee: $100."],
    ["uppercase THE", DEF.replace(": The ", ": THE ") + " Administrative fee: $100."],
    ["percentage", `${DEF} Plan pays 80%.`],
    ["unrelated number", `${DEF} See section 4.2 and 30 days.`],
    ["indefinite article + $", "Telehealth: A remote consultation with a Physician; fee $25 per visit."],
    ["ANY + $", "Telehealth: Any service delivered remotely by a Physician; fee $10."],
    ["amount right after the article word", "Telehealth: The service costs $100 when delivered remotely."],
  ])("%s: abstains", (_label, quote) => {
    expect(resolve("telehealth", [v("doc-1", 32, quote)])).toEqual([undefined]);
  });

  it.each([
    ["label: amount schedule entry", "telehealth", "Telehealth: $0 copay per visit"],
    ["label: percentage schedule entry", "coinsurance", "Coinsurance: 80% after deductible"],
    ["label: amount with period", "annual-deductible", "Deductible: $500 per Period of Coverage"],
  ])("%s line value stays unattributed (no inference)", (_label, fact, quote) => {
    expect(resolve(fact, [v("doc-1", 3, quote)])).toEqual([undefined]);
  });
});

describe("R2. abbreviated or unproved FEHB enrollment scope abstains", () => {
  const oop = (quote: string, conditions?: string) =>
    resolve("out-of-pocket-maximum", [v("fep", 17, quote, quote, conditions ? { conditions } : {})]);
  it.each([
    ["SO", "SO contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["SPO", "SPO contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["SF", "For SF enrollments, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["S+1", "For S+1 contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["Self+1", "For Self+1 contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["SO colon", "Out-of-pocket maximum SO: $11,000"],
    ["unknown abbreviation", "XQ contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["ambiguous fragment", "Plus One contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
    ["Family-only fragment", "Family contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000."],
  ])("%s: abstains even with a guessed condition", (_label, quote) => {
    expect(oop(quote)).toEqual([undefined]);
    expect(oop(quote, "Self Only")).toEqual([undefined]);
  });

  it.each([
    ["Self Only", "For Self Only contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $11,000.", "Self Only"],
    ["Self Plus One", "For Self Plus One contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000.", "Self Plus One"],
    ["Self and Family", "For Self and Family contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000.", "Self and Family"],
  ])("full category %s with source-backed condition: line value stays unattributed (no inference)", (_label, quote, conditions) => {
    expect(oop(quote, conditions)).toEqual([undefined]);
  });

  it("a full category without a preserved condition still abstains", () => {
    expect(oop("For Self Only contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $11,000.")).toEqual([undefined]);
  });

  it("P2.2-A deductible values stay unattributed (no new attribution)", () => {
    expect(resolve("annual-deductible", [
      v("fep", 17, "• For Self Only contracts, the calendar year deductible is now $1,000. For Self Plus One, and Self and Family contracts, the"),
      v("fep", 36, "• The calendar year deductibles: $1,000 per person ($2,000 per Self Plus One or Self and Family enrollment)."),
    ])).toEqual([undefined, undefined]);
  });
});

describe("R3. explicit-mention path gets the same semantic and FEHB gates", () => {
  const mentioned = (documentId: string, page: number, quote: string, display = quote): CellValue =>
    ({ ...v(documentId, page, quote, display), planId: PLANS[documentId].planId });
  it("a mention-attributed glossary + unrelated fee abstains", () => {
    expect(resolve("telehealth", [mentioned("doc-1", 32, "Patriot Exchange ProgramSM. Telehealth: The distribution of health-related services. Administrative fee: $100.", "$100")])).toEqual([undefined]);
  });
  it("a mention-attributed FEHB abbreviation abstains", () => {
    expect(resolve("out-of-pocket-maximum", [mentioned("fep", 17, "FEP® Blue Focus SO contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000.")])).toEqual([undefined]);
  });
  it("a plan-name mention does not attribute a line value (it merged three network columns)", () => {
    expect(resolve("out-of-pocket-maximum", [mentioned("doc-1", 3, "Patriot Exchange ProgramSM. Out of Pocket Maximum $1,000 Up to the Maximum", "$1,000")])).toEqual([undefined]);
  });
});
