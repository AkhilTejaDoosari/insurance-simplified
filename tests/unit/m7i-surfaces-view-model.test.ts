// M7 (agent I): view-model for the issued evidence surfaces — exclusion
// inventories and document authority — rendered exactly as given.
import { describe, expect, it } from "vitest";
import {
  NO_EXCLUSION_SECTION_FOUND,
  conflictReasonText,
  exclusionCoverageNotes,
  exclusionCoverageText,
  surfacesDisplay,
  surfacesOf,
  surfacesText,
} from "@/app/lib/presentation/adaptive";
import { CANNOT_BE_CONFIRMED } from "@/app/lib/evidence/issued";
import {
  authorityCbc,
  complete,
  completeEmpty,
  conflict,
  exclusionsCbc,
  forbiddenWording,
  partial,
  partialEmpty,
  resolved,
  surfaces,
  table,
  unknownEmpty,
} from "./helpers/m7i-surfaces";

describe("m7i exclusion inventories", () => {
  it("complete: every exclusion verbatim with its page link, and 'All N pages were read'", () => {
    const [x] = surfacesDisplay(table, surfaces([complete])).exclusions;
    expect(x).toMatchObject({ kind: "exclusion-inventory", planName: "Sample Plan A", filename: "plan-a.pdf", coverage: "complete" });
    if (x.kind !== "exclusion-inventory") throw new Error("kind");
    expect(x.coverageText).toBe("All 6 pages were read.");
    expect(x.emptyText).toBeUndefined();
    expect(x.items.map((i) => i.claim)).toEqual(complete.exclusions.map((e) => e.claim));
    expect(x.items[0].links).toEqual([
      { documentId: "d1", filename: "plan-a.pdf", page: 5, quote: complete.exclusions[0].claim, evidenceId: "ev-x1" },
    ]);
  });

  it("partial: names the pages that could not be read fully", () => {
    const [x] = surfacesDisplay(table, surfaces([partial])).exclusions;
    if (x.kind !== "exclusion-inventory") throw new Error("kind");
    expect(x.coverageText).toBe("Pages 3 and 4 could not be read fully — exclusions there may be missing.");
    expect(x.items).toHaveLength(1);
    expect(exclusionCoverageText("partial", [7], 9)).toBe("Page 7 could not be read fully — exclusions there may be missing.");
  });

  it("unknown coverage with an empty list never says 'No exclusions'", () => {
    const [x] = surfacesDisplay(table, surfaces([unknownEmpty])).exclusions;
    if (x.kind !== "exclusion-inventory") throw new Error("kind");
    expect(x.coverageText).toBe("It is not known whether every page was read — exclusions may be missing.");
    expect(x.emptyText).toBeUndefined();
    expect(x.items).toEqual([]);
  });

  it("partial coverage with an empty list keeps only the pages-not-read wording", () => {
    const [x] = surfacesDisplay(table, surfaces([partialEmpty])).exclusions;
    if (x.kind !== "exclusion-inventory") throw new Error("kind");
    expect(x.emptyText).toBeUndefined();
    expect(x.coverageText).toMatch(/^Pages 3 and 4 could not be read fully/);
  });

  it("complete coverage with an empty list says no exclusion section was found in the pages read", () => {
    const [x] = surfacesDisplay(table, surfaces([completeEmpty])).exclusions;
    if (x.kind !== "exclusion-inventory") throw new Error("kind");
    expect(x.emptyText).toBe(NO_EXCLUSION_SECTION_FOUND);
    expect(x.emptyText).toBe("An exclusion section was not found in the pages read.");
  });

  it("cannot be confirmed: the phrase and no values", () => {
    const [x] = surfacesDisplay(table, surfaces([exclusionsCbc])).exclusions;
    expect(x).toMatchObject({ kind: "cannot-be-confirmed", of: "exclusion-inventory", status: CANNOT_BE_CONFIRMED });
    expect(JSON.stringify(x)).not.toMatch(/Sample Plan|prov-|ev-|page \d/);
    if (x.kind !== "cannot-be-confirmed") throw new Error("kind");
    expect(x.text).toContain("cannot be confirmed");
  });

  it("a malformed or self-contradicting view is shown as cannot be confirmed, never partially", () => {
    const bad = [
      { ...complete, pagesNotRead: [2] }, // "complete" naming unread pages
      { ...complete, documentId: "elsewhere" }, // unknown document
      { ...complete, exclusions: [{ ...complete.exclusions[0], evidence: [] }] }, // no page link
      { ...complete, exclusions: [{ ...complete.exclusions[0], evidence: [{ documentId: "d1", page: 99, quote: "x" }] }] },
      { ...complete, coverage: "mostly" },
      { kind: "something-else" },
      null,
    ];
    for (const view of bad) {
      const [x] = surfacesDisplay(table, surfaces([view as never])).exclusions;
      expect(x.kind).toBe("cannot-be-confirmed");
    }
  });

  it("scopes inventories to the documents in view; cannot-be-confirmed is always shown", () => {
    const d = surfacesDisplay(table, surfaces([complete, partial, exclusionsCbc]), ["d2"]);
    expect(d.exclusions.map((x) => (x.kind === "exclusion-inventory" ? x.documentId : x.kind))).toEqual(["d2", "cannot-be-confirmed"]);
  });

  it("reads surfaces only from the evidence-surfaces/v1 field", () => {
    expect(surfacesOf({ surfaces: surfaces([complete]) })).not.toBeNull();
    expect(surfacesOf({ surfaces: { schema: "other", exclusions: [], authority: [] } })).toBeNull();
    expect(surfacesOf(table)).toBeNull();
    expect(surfacesDisplay(table, null)).toEqual({ exclusions: [], authority: [] });
  });
});

describe("m7i authority views", () => {
  it("resolved: names the governing document with its proof quotes", () => {
    const [a] = surfacesDisplay(table, surfaces([], [resolved])).authority;
    if (a.kind !== "authority") throw new Error("kind");
    expect(a.text).toBe("plan-a-rider.pdf governs annual deductible (Sample Plan A).");
    expect(a.verdict).toBeUndefined();
    expect(a.reasons).toEqual([]);
    expect(a.relations[0].text).toBe("plan-a-rider.pdf replaces plan-a.pdf.");
    expect(a.relations[0].links.map((l) => [l.filename, l.page, l.quote, l.evidenceId])).toEqual([
      ["plan-a-rider.pdf", 1, "This rider replaces the deductible schedule of Sample Plan A.", "ev-r1"],
      ["plan-a.pdf", 2, "Deductible schedule", "ev-r2"],
    ]);
  });

  it("conflict: CONFLICTED via the mapping table, reasons in plain words", () => {
    const [a] = surfacesDisplay(table, surfaces([], [conflict])).authority;
    if (a.kind !== "authority") throw new Error("kind");
    expect(a.verdict).toBe("CONFLICTED");
    expect(a.text).toBe("The documents disagree about out-of-pocket maximum (Sample Plan A), and which one governs could not be proven.");
    expect(a.reasons).toEqual(["their coverage periods could not be matched", "neither document states that it replaces the other"]);
    expect(a.relations[0].text).toBe("plan-a-rider.pdf disagrees with plan-a.pdf.");
  });

  it("a conflict without reasons still explains itself; unknown reasons stay generic", () => {
    const [a] = surfacesDisplay(table, surfaces([], [{ ...conflict, verdict: undefined, relations: [{ ...conflict.relations[0], reasons: undefined }] }])).authority;
    if (a.kind !== "authority") throw new Error("kind");
    expect(a.verdict).toBe("CONFLICTED");
    expect(a.reasons).toEqual(["part of the proof could not be confirmed"]);
    expect(conflictReasonText("zzz")).toBe("part of the proof could not be confirmed");
  });

  it("inconsistent authority views are cannot be confirmed", () => {
    const bad = [
      { ...conflict, verdict: "SUPPORTED" }, // conflict must be CONFLICTED
      { ...resolved, verdict: "CONFLICTED" },
      { ...resolved, governing: [] },
      { ...resolved, relations: [{ ...resolved.relations[0], evidence: [] }] }, // supersession without proof
      { ...resolved, relations: [{ ...resolved.relations[0], relation: "outranks" }] },
      { ...resolved, scopeLabel: "" },
    ];
    for (const view of bad) {
      const [a] = surfacesDisplay(table, surfaces([], [view as never])).authority;
      expect(a.kind).toBe("cannot-be-confirmed");
    }
    const [c] = surfacesDisplay(table, surfaces([], [authorityCbc])).authority;
    expect(c).toMatchObject({ kind: "cannot-be-confirmed", of: "authority", status: "cannot be confirmed" });
  });
});

describe("m7i chat coverage notes", () => {
  it("names partial/unknown/cannot-be-confirmed inventories for the plans an answer touches", () => {
    const s = surfaces([complete, partial, exclusionsCbc]);
    expect(exclusionCoverageNotes(table, s, ["d1"]).map((n) => n.coverage)).toEqual(["cannot be confirmed"]);
    const notes = exclusionCoverageNotes(table, s, ["d2"]);
    expect(notes[0]).toEqual({
      documentId: "d2",
      planName: "Sample Plan B",
      coverage: "partial",
      text: "Sample Plan B (plan-b.pdf): Pages 3 and 4 could not be read fully — exclusions there may be missing.",
    });
    expect(exclusionCoverageNotes(table, surfaces([complete]), ["d1"])).toEqual([]);
    expect(exclusionCoverageNotes(table, null, ["d1"])).toEqual([]);
  });
});

describe("m7i wording for missing items", () => {
  it("no surface ever says No / Not covered / Not excluded / Excluded for a missing item", () => {
    const missingOnly = surfaces(
      [unknownEmpty, partialEmpty, completeEmpty, exclusionsCbc, { ...unknownEmpty, documentId: "d1", planId: "pa" }],
      [conflict, authorityCbc],
    );
    const text = surfacesText(surfacesDisplay(table, missingOnly), false).join("\n");
    expect(forbiddenWording(text)).toEqual([]);
    const notes = exclusionCoverageNotes(table, missingOnly, ["d1", "d2"]).map((n) => n.text).join("\n");
    expect(forbiddenWording(notes)).toEqual([]);
  });
});
