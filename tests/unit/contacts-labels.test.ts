// Generalization fix 5 (2026-11-25): what a contact is for, and federal
// boilerplate that every SBC prints. Synthetic text.
import { describe, expect, it } from "vitest";
import { extractContacts } from "@/app/lib/extraction/contacts";
const hits = (...lines: string[]) => extractContacts([{ documentId: "d", filename: "x.pdf", pages: [lines.join("\n")] }]).map((h) => [h.value, h.purpose]);

describe("contact labels and boilerplate", () => {
  it("drops federal agencies and the federal glossary", () => {
    expect(hits(
      "You can view the Glossary at www.healthcare.gov/sbc-glossary/ or call 1-866-487-2365 to request a copy.",
      "Employee Benefits Security Administration at 1-866-444-3272 or www.dol.gov/ebsa, or the U.S. Department of Health and Human Services at",
      "1-877-267-2323 x61565 or www.cciio.cms.gov. Marketplace, visit www.HealthCare.gov or call 1-800-318-2596.",
      "https://ocrportal.hhs.gov/ocr/portal/lobby.jsf 1-800-368-1019",
    )).toEqual([]);
  });
  it("keeps a similar host that is not the agency", () => {
    expect(hits("Visit www.myhealthcare.gov.example.test for claims").length).toBe(1);
  });
  it.each([
    ["Call the Plan Administrator at 315-555-0142 for a copy.", "Plan Administrator"],
    ["Northwind Member Services 1-888-555-0136 (TTY: 711)", "Member Services"],
    ["Yes. See www.example.test for a list of network providers.", "network providers"],
    ["For claims questions email claims@example.test", "claims"],
    ["Emergency assistance: (866) 555-0171", "Emergency assistance"],
  ])("labels from the same sentence: %s", (line, label) => {
    expect(hits(line)[0][1]).toBe(label);
  });
  it.each([
    "Call customer service or the claims administrator at 1-888-555-0136.",
    "Nothing says what this is: see 1-888-555-0136.",
    "Claims are paid in 30 days. Northwind 1-888-555-0136",
  ])("gives no label when the sentence names none or several: %s", (line) => {
    expect(hits(line)[0][1]).toBeNull();
  });
  it("does not label one contact with another's purpose", () => {
    expect(hits("Member Services 1-888-555-0136, Northwind 1-888-555-0137")).toEqual([["1-888-555-0136", "Member Services"], ["1-888-555-0137", null]]);
  });
  it("rejects cut or conjunction labels", () => {
    expect(hits("A list of states with Consumer Assistance Programs is available at: https://www.example.test/list")[0][1]).toBeNull();
    expect(hits("In the US or Canada: (866) 555-0171")[0][1]).toBeNull();
  });
  it("keeps a relay line a relay line", () => {
    expect(hits("or call 1-800-555-0136/TTY: 800-555-0137 for a list of network providers.")[1]).toEqual(["800-555-0137", "TTY"]);
  });
  it("reads the sentence over line breaks", () => {
    expect(hits("More information about prescription", "drug coverage is", "available at", "www.example.test")).toEqual([["www.example.test", "prescription drug coverage"]]);
    expect(hits("Claims", "www.example.test")[0][1]).toBeNull();
  });
  it("drops a web address cut at the line end", () => {
    expect(hits("available at", "https://hr.example.test/benefits/healt", "h-benefits/prescription-drug-", "coverage")).toEqual([]);
    expect(hits("See https://www.example.test/preventive-care-", "benefits/.")).toEqual([]);
    expect(hits("Visit www.example.test", "or call us.")).toEqual([["www.example.test", null]]);
  });

  // ---- independent review round 4 (2026-11-25): F5-1, F5-2
  it("never shifts labels printed after their number", () => {
    expect(hits("1-800-555-0100 Claims", "1-800-555-0200 Pharmacy", "1-800-555-0300 Nurse line").map((h) => h[1])).toEqual([null, null, null]);
    expect(hits("800-555-0100 Claims 800-555-0200 Pharmacy").map((h) => h[1])).toEqual([null, null]);
  });
  it.each([
    [["Send all claims within 90 days of service", "800-555-0100"]],
    [["Travel assistance is not part of this plan", "www.northwind.test"]],
    [["Contact the claims administrator, not us at 800-555-0100"]],
  ])("takes no label from a line about something else", (lines) => {
    expect(hits(...lines)[0][1]).toBeNull();
  });
});
