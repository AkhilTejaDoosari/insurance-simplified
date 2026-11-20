// M7 (agent I): rendered comparison-view sections for the issued surfaces.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdaptiveResults from "@/app/components/AdaptiveResults";
import EvidenceSurfaces from "@/app/components/EvidenceSurfaces";
import type { EvidenceSurfaces as Surfaces } from "@/app/lib/evidence/surface-types";
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
(globalThis as Record<string, unknown>).React ??= React;

const render = (s: Surfaces | null, documentIds?: string[]) =>
  renderToStaticMarkup(<EvidenceSurfaces table={table} surfaces={s} sessionId="sess-test" documentIds={documentIds} />);
const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("m7i EvidenceSurfaces component", () => {
  it("complete: heading, plan, every exclusion verbatim with its evidence-id page link", () => {
    const html = render(surfaces([complete]));
    const text = textOf(html);
    expect(text).toContain("Exclusions read");
    expect(text).toContain("Sample Plan A (plan-a.pdf)");
    expect(text).toContain("All 6 pages were read.");
    for (const e of complete.exclusions) expect(text).toContain(e.claim);
    expect(html).toContain("/view/sess-test/d1/plan-a.pdf?page=5&amp;evidence=ev-x1");
    expect(html).toContain("/view/sess-test/d1/plan-a.pdf?page=6&amp;evidence=ev-x2");
    expect(html).toContain('aria-label="Exclusion in Sample Plan A: open plan-a.pdf at page 5"');
    expect(html).toContain('data-coverage="complete"');
  });

  it("partial: names pages not read fully as a note", () => {
    const html = render(surfaces([partial]));
    expect(textOf(html)).toContain("Pages 3 and 4 could not be read fully — exclusions there may be missing.");
    expect(html).toContain('role="note"');
    expect(textOf(html)).toContain("Experimental treatment.");
  });

  it("unknown and empty: no empty-list wording, only the reading state", () => {
    const text = textOf(render(surfaces([unknownEmpty])));
    expect(text).toContain("It is not known whether every page was read — exclusions may be missing.");
    expect(text).not.toContain("No exclusion section");
    expect(forbiddenWording(text)).toEqual([]);
  });

  it("complete and empty: 'No exclusion section was found in the pages read'", () => {
    const text = textOf(render(surfaces([completeEmpty])));
    expect(text).toContain("All 6 pages were read.");
    expect(text).toContain("No exclusion section was found in the pages read.");
    expect(forbiddenWording(text)).toEqual([]);
  });

  it("cannot be confirmed: the phrase and no values", () => {
    const text = textOf(render(surfaces([exclusionsCbc], [authorityCbc])));
    expect(text).toContain("cannot be confirmed");
    expect(text).toContain("NEEDS VERIFICATION");
    expect(text).not.toMatch(/Sample Plan|page \d/);
  });

  it("authority resolved: governing document and its proof quotes with page links", () => {
    const html = render(surfaces([], [resolved]));
    const text = textOf(html);
    expect(text).toContain("Which document governs");
    expect(text).toContain("plan-a-rider.pdf governs annual deductible (Sample Plan A).");
    expect(text).toContain("plan-a-rider.pdf replaces plan-a.pdf.");
    expect(html).toContain("<q>This rider replaces the deductible schedule of Sample Plan A.</q>");
    expect(html).toContain("/view/sess-test/d3/plan-a-rider.pdf?page=1&amp;evidence=ev-r1");
    expect(text).not.toContain("CONFLICTED");
  });

  it("authority conflict: CONFLICTED badge with reasons in plain words", () => {
    const html = render(surfaces([], [conflict]));
    const text = textOf(html);
    expect(html).toContain('class="verdict verdict--bad">CONFLICTED');
    expect(text).toContain("The documents disagree about out-of-pocket maximum (Sample Plan A), and which one governs could not be proven.");
    expect(text).toContain("Why: their coverage periods could not be matched; neither document states that it replaces the other.");
  });

  it("renders nothing without surfaces (legacy results)", () => {
    expect(render(null)).toBe("");
    expect(render(surfaces([]))).toBe("");
  });

  it("never says No / Not covered / Not excluded / Excluded for missing items", () => {
    const text = textOf(render(surfaces([unknownEmpty, partialEmpty, completeEmpty, exclusionsCbc], [conflict, authorityCbc])));
    expect(forbiddenWording(text)).toEqual([]);
  });
});

describe("m7i AdaptiveResults carries the surfaces of the extract response", () => {
  const withSurfaces = { ...table, surfaces: surfaces([complete, partial], [conflict]) };

  it("compare view shows each selected plan's inventory", () => {
    const html = renderToStaticMarkup(
      <AdaptiveResults table={withSurfaces} view={{ mode: "compare", planIds: ["pa", "pb"], tiers: {} }} sessionId="sess-test" userContext={{}} contacts={[]} />,
    );
    const text = textOf(html);
    expect(text).toContain("Exclusions read");
    expect(text).toContain("Sample Plan A (plan-a.pdf)");
    expect(text).toContain("Sample Plan B (plan-b.pdf)");
    expect(text).toContain("CONFLICTED");
  });

  it("understand view of one document shows only that document's inventory", () => {
    const html = renderToStaticMarkup(
      <AdaptiveResults table={withSurfaces} view={{ mode: "understand", documentId: "d2", planIds: ["pb"], tiers: {} }} sessionId="sess-test" userContext={{}} contacts={[]} />,
    );
    const text = textOf(html);
    expect(text).toContain("Sample Plan B (plan-b.pdf)");
    expect(text).not.toContain("Sample Plan A (plan-a.pdf)");
  });
});
