// M7 (agent B): honest-absence, withheld-line and cannot-be-confirmed notices
// on the comparison view-model, and the exclusion-outcome authority check.
import { describe, expect, it } from "vitest";
import {
  absenceNotices,
  absenceText,
  cannotBeConfirmedFacts,
  readingCoverage,
  readingCoverageText,
  withheldNotices,
} from "@/app/lib/presentation/adaptive";
import { cannotBeConfirmedRow } from "@/app/lib/evidence/row-resolution";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { SessionDocumentRegistry } from "@/app/lib/evidence/registry";
import { resolveExclusionOutcomes, servicesNamedIn } from "@/app/lib/evidence/exclusion-outcomes";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

const table: RegisteredComparisonTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "d1", filename: "one.pdf", pageCount: 4 }, { documentId: "d2", filename: "two.pdf", pageCount: 2 }],
  coverage: {
    documents: [
      { documentId: "d1", pagesRead: [1, 2], pagesNotRead: [3], pagesPartlyRead: [4] },
      { documentId: "d2", pagesRead: [1, 2], pagesNotRead: [], pagesPartlyRead: [] },
    ],
    absences: [
      { factName: "dental-coverage", reason: "not-found-in-pages-read" },
      { factName: "vision-coverage", reason: "candidates-withheld" },
    ],
  },
  rows: [
    { factName: "dental-coverage", verdict: "NOT STATED", values: [] },
    { factName: "vision-coverage", verdict: "NOT STATED", values: [] },
    {
      factName: "ambulance", verdict: "NEEDS VERIFICATION", values: [],
      withheld: [{ documentId: "d1", page: 2, quote: "Ambulance | see note", reason: "label-unrecognized", evidenceId: "ev-1" } as never],
    },
    cannotBeConfirmedRow("annual-deductible") as never,
  ],
};

describe("m7b trust notices (comparison view-model)", () => {
  it("NOT STATED says 'Not found in the pages read' and names unread and partly read pages", () => {
    expect(absenceText(table, "dental-coverage")).toBe(
      "Not found in the pages read (one.pdf page 3 could not be read; one.pdf page 4 was only partly read).",
    );
    expect(absenceText(table, "dental-coverage", ["d2"])).toBe("Not found in the pages read.");
  });

  it("candidates-withheld says a candidate could not be verified", () => {
    expect(absenceText(table, "vision-coverage")).toMatch(/could not be verified/);
  });

  it("withheld lines are NEEDS VERIFICATION with the verbatim line and its evidence id", () => {
    expect(withheldNotices(table)).toEqual([
      { concept: "ambulance", label: "Ambulance", verdict: "NEEDS VERIFICATION", documentId: "d1", page: 2, quote: "Ambulance | see note", evidenceId: "ev-1" },
    ]);
  });

  it("reports reading coverage per document and the cannot-be-confirmed row", () => {
    expect(readingCoverage(table).map(readingCoverageText)).toEqual([
      "one.pdf: read 2 pages; partly read page 4; could not read page 3.",
      "two.pdf: read 2 pages.",
    ]);
    expect(cannotBeConfirmedFacts(table).map((n) => [n.concept, n.status])).toEqual([["annual-deductible", "cannot be confirmed"]]);
  });

  it("never words an absence as No / Not covered / Not eligible / Excluded", () => {
    const words = [...absenceNotices(table).map((a) => a.text), ...cannotBeConfirmedFacts(table).map((n) => n.text)].join(" ");
    expect(words).not.toMatch(/\bno\b|not covered|not eligible|excluded/i);
  });

  it("legacy results without coverage render no absence text", () => {
    const { coverage: _c, ...legacy } = table;
    expect(absenceText(legacy, "dental-coverage")).toBeUndefined();
    expect(readingCoverage(legacy)).toEqual([]);
  });
});

describe("m7b exclusion outcomes", () => {
  it("names services from the materiality map and refuses a foreign authority", () => {
    expect(servicesNamedIn("Is acupuncture covered?")).toContain("acupuncture");
    const store = new ProvisionStore("s", new SessionDocumentRegistry("s"), new EvidenceAuthority());
    expect(() => resolveExclusionOutcomes(store, new EvidenceAuthority(), "acupuncture", { documentIds: [] })).toThrow();
  });
});
