import { describe, expect, it } from "vitest";
import { documentPlanTitle, UNCONFIRMED_PLAN_TITLE } from "@/app/lib/extraction/plan-names";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

const source = (documentId: string, name: string) => ({
  documentId,
  page: 1,
  quote: `Policy name: ${name}`,
  evidenceId: `ev-${documentId}-1`,
});

describe("official plan titles (Phase B)", () => {
  it("uses the source-verified declared name of a proven plan", () => {
    const table = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "patriot-america-plus.pdf", pageCount: 2 }],
      plans: [{ planId: "plan-p", name: "Patriot America Plus", sources: [source("doc-1", "Patriot America Plus")] }],
      rows: [],
    } satisfies Table;
    expect(documentPlanTitle(table, "doc-1")).toEqual({
      name: "Patriot America Plus",
      source: "verified",
    });
  });

  it("never uses a raw or prettified filename as a plan title", () => {
    const legacy = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "4-plan-a-final.pdf", pageCount: 2 }],
      rows: [],
    } satisfies Table;
    const title = documentPlanTitle(legacy, "doc-1");
    expect(title.source).toBe("unconfirmed");
    expect(title.name).toBe(UNCONFIRMED_PLAN_TITLE);
    expect(title.name).not.toMatch(/plan-a|4|final/i);
  });

  it("distinguishes several unconfirmed uploads by upload order", () => {
    const legacy = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-1", filename: "one.pdf", pageCount: 1 },
        { documentId: "doc-2", filename: "two.pdf", pageCount: 1 },
      ],
      rows: [],
    } satisfies Table;
    expect(documentPlanTitle(legacy, "doc-1").name).toBe(`${UNCONFIRMED_PLAN_TITLE} (upload 1)`);
    expect(documentPlanTitle(legacy, "doc-2").name).toBe(`${UNCONFIRMED_PLAN_TITLE} (upload 2)`);
  });

  it("rank-orders verified uploads before unconfirmed ones and keeps filenames as document metadata", () => {
    const mixed = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "doc-verified", filename: "brochure.pdf", pageCount: 1 },
        { documentId: "doc-unknown", filename: "scan.pdf", pageCount: 1 },
      ],
      plans: [{ planId: "plan-v", name: "Verified Plan", sources: [source("doc-verified", "Verified Plan")] }],
      rows: [],
    } satisfies Table;
    expect(documentPlanTitle(mixed, "doc-unknown").name).toBe(UNCONFIRMED_PLAN_TITLE);
    expect(mixed.documents.map((d) => d.filename)).toEqual(["brochure.pdf", "scan.pdf"]);
  });
});
