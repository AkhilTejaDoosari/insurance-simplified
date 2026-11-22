// Owner decision 2026-11-22 (Phase 5 blocker 1): doc 02 states a geographic
// restriction ("… benefits in your home country … are not covered under this
// plan.") but the line naming the home country wraps, and the restriction
// ("not covered") sits on a later line of the same sentence; the row read
// NOT STATED. A fact that requires a restriction marker reads the whole
// sentence the matching line belongs to (lower-case continuation lines,
// bounded), and cites exactly those lines. Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";

function row(fact: string, ...pages: string[]) {
  const doc = { documentId: "doc-1", filename: "synthetic.pdf", pageCount: pages.length, pages };
  const table = verifyComparisonTable(validateTable(extractFallback([doc], {})), [doc]);
  return table.rows.find((r) => r.factName === fact)!;
}

const WRAPPED = [
  "GENERAL PROVISIONS",
  "For purposes of this insurance, if you incur accident or sickness benefits in your",
  "home country (passport country) or in your country of permanent residence (location in which you",
  "permanently reside), such benefits are not covered under this plan.",
  "Claims must be submitted promptly.",
].join("\n");

describe("a restriction stated on a wrapped line of the same sentence", () => {
  it("is a geographic restriction, citing the whole sentence", () => {
    const r = row("geographic-restrictions", WRAPPED);
    expect(r.verdict).not.toBe("NOT STATED");
    const quote = r.values[0].evidence[0].quote;
    expect(quote).toContain("For purposes of this insurance");
    expect(quote).toContain("are not covered under this plan.");
    expect(quote).not.toContain("GENERAL PROVISIONS");
    expect(quote).not.toContain("Claims must be submitted");
  });
});

describe("controls: no restriction in the sentence → still not a restriction", () => {
  it("a wrapped mention without a restriction marker stays NOT STATED", () => {
    const text = [
      "If you are studying outside your",
      "home country, consider insurance that",
      "travels with you.",
    ].join("\n");
    expect(row("geographic-restrictions", text).verdict).toBe("NOT STATED");
  });

  it("a restriction in the NEXT sentence is not borrowed", () => {
    const text = ["Welcome to your home country program.", "Dental care is not covered."].join("\n");
    expect(row("geographic-restrictions", text).verdict).toBe("NOT STATED");
  });

  it("a heading above the sentence is not part of it", () => {
    const text = ["HOME COUNTRY COVERAGE", "Treatment while visiting is limited to", "emergencies only."].join("\n");
    const r = row("geographic-restrictions", text);
    for (const v of r.values) expect(v.evidence[0].quote).not.toContain("Treatment while visiting");
  });
});

// Five-document diff (2026-11-22): enumerated items "(55) … (56) …",
// "(a) … (b) …", "(1) … (2) …" were joined as one sentence and borrowed a
// marker from a neighbouring item. A list item never continues the line above.
describe("enumerated items are separate sentences", () => {
  it.each([
    ["(55) Charges for travel to your home country", "(56) Charges except as provided are not covered."],
    ["(a) A commercial airline ticket to the Country of Residence", "(b) only in economy class."],
    ["(1) the Insured Person must be outside the Country of Residence", "(2) the return must occur only during the stay."],
  ])("%s / %s", (a, b) => {
    expect(row("geographic-restrictions", [a, b].join("\n")).verdict).toBe("NOT STATED");
  });
});
