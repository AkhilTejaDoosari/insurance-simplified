// P0-01 / owner decision 2: a product title on the first line of page 1
// followed by an insurance document-type heading ("Certificate of Insurance",
// …) is a verifiable plan identity, whatever words the title ends with. The
// previous rule accepted it only for titles ending in "Program", which left
// two of the owner's five real PDFs without an identity (reproduced locally
// with REAL_PDFS_DIR; names below are synthetic). No insurer names, no
// filenames, page 1 only.
import { describe, expect, it } from "vitest";
import { attestPlans } from "@/app/lib/extraction/plan-identity";

const doc = (first: string, rest: string[] = []) => ({
  documentId: "doc-1",
  filename: "anything.pdf",
  pageCount: 1 + rest.length,
  pages: [first, ...rest],
});
const names = (first: string, rest?: string[]) => attestPlans([doc(first, rest)]).map((p) => p.name);
const BODY = "IMPORTANT NOTICE\nThis insurance is not subject to the federal act.";

describe("generalized title-block plan identity", () => {
  it("attests a product title followed by a document-type heading", () => {
    expect(names(`Northwind Voyager Plus®\nCertificate of Insurance\n${BODY}`)).toEqual(["Northwind Voyager Plus®"]);
    expect(names(`Northwind Scholar Shield\nDescription of Coverage\n${BODY}`)).toEqual(["Northwind Scholar Shield"]);
  });

  it("keeps the existing Program titles", () => {
    expect(names(`Northwind Exchange ProgramSM\nCertificate of Insurance\n${BODY}`)).toEqual(["Northwind Exchange ProgramSM"]);
  });

  it("cites the title on page 1 with a quote that contains the name", () => {
    const [plan] = attestPlans([doc(`Northwind Voyager Plus®\nCertificate of Insurance\n${BODY}`)]);
    expect(plan.sources).toHaveLength(1);
    expect(plan.sources[0].page).toBe(1);
    expect(plan.sources[0].quote).toContain("Northwind Voyager Plus®");
  });

  it.each([
    ["generic heading", "Table of Contents\nCertificate of Insurance"],
    ["notice heading", "Important Notice\nCertificate of Insurance"],
    ["legal entity", "Northwind Insurance Company\nCertificate of Insurance"],
    ["illustrative title", "Sample Plan\nCertificate of Insurance"],
    ["sentence, not a title", "Coverage begins on the effective date.\nCertificate of Insurance"],
    ["no document-type heading", "Northwind Voyager Plus®\nWelcome to your benefits"],
    ["title not on the first line", "Welcome\nNorthwind Voyager Plus®\nCertificate of Insurance"],
    ["over-long title", `${"Northwind ".repeat(12)}Plan\nCertificate of Insurance`],
  ])("abstains for a %s", (_label, first) => {
    expect(names(`${first}\n${BODY}`)).toEqual([]);
  });

  it("does not attest from a later page (page-1 rule unchanged)", () => {
    expect(names(BODY, [`Northwind Voyager Plus®\nCertificate of Insurance\n${BODY}`])).toEqual([]);
  });

  it("keeps two documents with the same title as separate plans (no merge without policy id and issuer)", () => {
    const a = { ...doc(`Northwind Voyager Plus®\nCertificate of Insurance\n${BODY}`), documentId: "doc-a" };
    const b = { ...doc(`Northwind Voyager Plus®\nCertificate of Insurance\n${BODY}`), documentId: "doc-b" };
    const plans = attestPlans([a, b]);
    expect(plans).toHaveLength(2);
    expect(new Set(plans.map((p) => p.planId)).size).toBe(2);
  });
});
