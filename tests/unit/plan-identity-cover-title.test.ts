// P0-01 / owner decision 2: a brochure cover whose first line is a short
// product title, with no document-type heading after it, is a plan identity
// only when the same document names that exact title as a plan ("the
// <title> insurance plan"). Reproduced on the owner's replacement file 02
// (cover = title + tagline; no identity before this rule). Synthetic names;
// no insurer names, no filenames; the identity is still cited on page 1.
import { describe, expect, it } from "vitest";
import { attestPlans } from "@/app/lib/extraction/plan-identity";

const COVER = "Northwind Scholar\nDedicated cover for visiting students\nMeets school requirements";
const doc = (pages: string[]) => ({ documentId: "doc-1", filename: "anything.pdf", pageCount: pages.length, pages });
const names = (pages: string[]) => attestPlans([doc(pages)]).map((p) => p.name);

describe("cover-title plan identity", () => {
  it("attests a cover title that the document names as its plan", () => {
    const pages = [COVER, "TABLE OF CONTENTS\nBENEFITS", "This brochure summarizes the benefits of the Northwind Scholar insurance plan."];
    expect(names(pages)).toEqual(["Northwind Scholar"]);
    const [plan] = attestPlans([doc(pages)]);
    expect(plan.sources).toEqual([{ documentId: "doc-1", page: 1, quote: "Northwind Scholar" }]);
  });

  it.each([
    ["plan", "the Northwind Scholar plan"],
    ["program", "members of the Northwind Scholar program"],
  ])("accepts a %s declaration", (_kind, sentence) => {
    expect(names([COVER, `By enrolling you join ${sentence}.`])).toEqual(["Northwind Scholar"]);
  });

  it("abstains when the title is never named as a plan", () => {
    expect(names([COVER, "Northwind Scholar\nBenefits are paid as shown.", "Northwind Scholar travels widely."])).toEqual([]);
  });

  it("abstains when the only plan sentence is an example", () => {
    expect(names([COVER, "For example, the Northwind Scholar plan would pay $100."])).toEqual([]);
  });

  it("abstains when the plan sentence names a different title", () => {
    expect(names([COVER, "This summarizes the Northwind Scholar Plus insurance plan."])).toEqual([]);
  });

  it.each([
    ["a sentence", "Studying outside your home country?\nWe can help"],
    ["a slogan word", "Happens.\nTrip"],
    ["a generic heading", "Summary of Benefits\nStudents"],
    ["an organisation", "Northwind Underwriters\nStudents"],
    ["a long line", "Northwind Scholar Shield Plus Extra Coverage For All Visiting Students Abroad\nStudents"],
  ])("abstains for a cover line that is %s", (_kind, cover) => {
    const title = cover.split("\n")[0];
    expect(names([cover, `This summarizes the ${title} insurance plan.`])).toEqual([]);
  });

  it("abstains on a page that declares itself a sample", () => {
    expect(names([`${COVER}\nSample brochure`, "This summarizes the Northwind Scholar insurance plan."])).toEqual([]);
  });

  it("does not add a second identity to a document an existing rule already identified", () => {
    const pages = ["Northwind Voyager\nCertificate of Insurance\nIMPORTANT NOTICE", "the Northwind Voyager insurance plan"];
    expect(names(pages)).toEqual(["Northwind Voyager"]);
  });
});
