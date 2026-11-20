// P0-05 regression: the user-facing value is a short claim with its
// conditions beside it; the full verbatim source wording stays available as
// a verification layer. The claim is never a paraphrase: it is made of
// verbatim pieces of the verified display, re-checked against the citations,
// and every piece of the display that is not in the claim is shown as a
// condition (nothing dropped). Synthetic text only.
import { describe, expect, it } from "vitest";
import { describeFact } from "@/app/lib/presentation/claim";
import { materialDisplayTokens } from "@/app/lib/evidence-verification";
import type { CellValue } from "@/app/lib/extraction/types";

const NOTE =
  "Outpatient services are subject to the deductible unless otherwise noted. Eligible expenses are limited to usual, reasonable and customary charges per period of coverage.";

function tableCell(label: string, heading: string, cell: string, notes: string[] = [], quotes?: string[]): CellValue {
  const display = `${label} (${heading}): ${cell}${notes.map((n) => `\n${n}`).join("")}`;
  return {
    documentId: "doc-1",
    display,
    qualifiers: {},
    evidence: (quotes ?? [`${label} ${cell}`, heading, ...notes]).map((quote) => ({ documentId: "doc-1", page: 3, quote })),
    anchor: { kind: "table-cell", page: 3, table: 0, row: 4, column: 1, label },
  };
}

function line(display: string, quote = display): CellValue {
  return { documentId: "doc-1", display, qualifiers: {}, evidence: [{ documentId: "doc-1", page: 2, quote }] };
}

describe("describeFact (P0-05)", () => {
  it("a long table cell yields a short claim, its conditions, and the full source wording", () => {
    const value = tableCell(
      "Walk-in Clinic • Not subject to Deductible • Copayment: $40 • Copayment does not apply if the schedule states a $0 Deductible",
      "In-Network Plan Pays",
      "90%",
      [NOTE],
    );
    const d = describeFact(value, "urgent-care");

    expect(d.claim).toBe("Walk-in Clinic (In-Network Plan Pays): 90%");
    expect(d.conditions).toEqual([
      "Not subject to Deductible",
      "Copayment: $40",
      "Copayment does not apply if the schedule states a $0 Deductible",
      NOTE,
    ]);
    expect(d.status).toBe("conditional");
    expect(d.sourceWording).toBe(value.display);
    expect(d.claim!.length).toBeLessThan(value.display.length / 4);
  });

  it("drops nothing: every material token of the display is in the claim or a condition", () => {
    const value = tableCell(
      "Emergency Transport • Maximum Limit: $25,000 • Must be approved in advance by the Company",
      "Out-of-Network Plan Pays",
      "80%",
      [NOTE, "• Emergency Transport: No coverage if not approved by the Company."],
    );
    const d = describeFact(value, "emergency-evacuation");
    const shown = new Set(materialDisplayTokens([d.claim, ...d.conditions].join("\n"), "emergency-evacuation"));
    expect(materialDisplayTokens(value.display, "emergency-evacuation").filter((t) => !shown.has(t))).toEqual([]);
    expect(d.conditions).toContain("• Emergency Transport: No coverage if not approved by the Company.");
  });

  it("a cell without sub-notes or governing notes is a supported claim equal to the display", () => {
    const value = tableCell("Deductible", "SILVER", "$250");
    expect(describeFact(value, "annual-deductible")).toEqual({
      claim: "Deductible (SILVER): $250",
      conditions: [],
      status: "supported",
      sourceWording: "Deductible (SILVER): $250",
    });
  });

  it("keeps a negated cell negated in the claim", () => {
    const value = tableCell("Pregnancy", "In-Network", "Not covered", [], ["Pregnancy Not covered", "In-Network"]);
    expect(describeFact(value, "maternity-coverage").claim).toBe("Pregnancy (In-Network): Not covered");
  });

  it("rejects a claim whose figure is not in the citations (claim null, unconfirmed, wording kept)", () => {
    const value = tableCell("Walk-in Clinic", "In-Network Plan Pays", "90%", [NOTE], [
      "Walk-in Clinic 80%",
      "In-Network Plan Pays",
      NOTE,
    ]);
    const d = describeFact(value, "urgent-care");
    expect(d.claim).toBeNull();
    expect(d.status).toBe("unconfirmed");
    expect(d.sourceWording).toBe(value.display);
  });

  it("rejects a table display that does not have the anchored label/heading/cell shape", () => {
    const value: CellValue = { ...tableCell("Deductible", "GOLD", "$500"), display: "Deductible: $500 (GOLD)" };
    const d = describeFact(value, "annual-deductible");
    expect(d.claim).toBeNull();
    expect(d.status).toBe("unconfirmed");
  });

  it("a single source line stays one verbatim claim, without its list marker", () => {
    const d = describeFact(line("(4) Proof of claim must be furnished within ninety (90) days after the loss."), "claims-filing-deadline");
    expect(d.claim).toBe("Proof of claim must be furnished within ninety (90) days after the loss.");
    expect(d.conditions).toEqual([]);
    expect(d.status).toBe("supported");
  });

  it("a line whose text is not in its citation is unconfirmed", () => {
    const d = describeFact(line("Deductible $750 per certificate period", "Deductible $250 per certificate period"), "annual-deductible");
    expect(d.claim).toBeNull();
    expect(d.status).toBe("unconfirmed");
  });
});
