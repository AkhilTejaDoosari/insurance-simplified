// P0-01: the comparison picker lists every verified plan distinctly and every
// unresolved upload with its reason.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PolicyViewControls from "@/app/components/PolicyViewControls";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
(globalThis as Record<string, unknown>).React ??= React;

const plan = (planId: string, name: string, documentId: string) => ({
  planId, name, sources: [{ documentId, page: 1, quote: `Policy name: ${name}` }],
});
const table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "a", filename: "alpha-2026.pdf", pageCount: 1 },
    { documentId: "b", filename: "alpha-wording.pdf", pageCount: 1 },
    { documentId: "c", filename: "beta.pdf", pageCount: 1 },
    { documentId: "d", filename: "unnamed.pdf", pageCount: 1 },
  ],
  plans: [plan("pa", "Alpha", "a"), plan("pb", "Alpha", "b"), plan("pc", "Beta", "c")],
  presentationGroups: [],
  rows: [],
} as unknown as Table;

const html = renderToStaticMarkup(
  <PolicyViewControls
    table={table}
    view={{ mode: "compare", planIds: ["pa", "pc"], tiers: {} }}
    onChange={() => {}}
  />,
);

describe("comparison picker inventory (P0-01)", () => {
  it("disambiguates separately verified plans that share a name by source file", () => {
    expect(html).toContain("Compare Alpha (alpha-2026.pdf)");
    expect(html).toContain("Compare Alpha (alpha-wording.pdf)");
    expect(html).toContain("Compare Beta");
  });

  it("lists the unresolved upload with its reason and counts all documents", () => {
    expect(html).toContain("unnamed.pdf");
    expect(html).toContain("No plan name could be verified");
    expect(html).toContain("2 of 3 verified plans in the comparison");
    expect(html).toContain("4 uploaded documents");
  });

  it("keeps Remove focusable with its reason at the two-plan minimum", () => {
    expect(html).toMatch(/aria-disabled="true"[^>]*>Remove|>Remove/);
    expect(html).toContain('id="plan-remove-reason"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Remove/);
  });
});
