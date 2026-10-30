import { describe, expect, it } from "vitest";
import {
  parseSelectionRequest,
  validateSelectionScope,
} from "@/app/lib/extraction/selection-request";
import { scopeDocumentsForChat } from "@/app/lib/rag/selection-scope";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

const table: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: ["a", "b", "c"].map((id) => ({
    documentId: id,
    filename: `${id}.pdf`,
    pageCount: 1,
  })),
  plans: [
    {
      planId: "alpha",
      name: "Alpha",
      sources: [{ documentId: "a", page: 1, quote: "Alpha" }],
    },
  ],
  rows: [],
};
const payload = {
  resultFingerprint: "fp",
  planIds: [],
  tiers: {},
  legacyTiersByDocument: {},
  viewMode: "understand",
  documentId: "b",
};
describe("active-view selection boundary", () => {
  it("does not feed unassigned costs to chat as a selected plan benefit", () => {
    const own: Table = { ...table, rows: [{ factName: "coverage-limit", verdict: "SUPPORTED", values: [{ documentId: "a", display: "Unassigned limit 999", qualifiers: {}, evidence: [{ documentId: "a", page: 1, quote: "Unassigned limit 999", evidenceId: "ev-unassigned" }] }] }] };
    const docs = [{ documentId: "a", filename: "a.pdf", pageCount: 1, pages: ["Alpha\nUnassigned limit 999"] }];
    const scope = scopeDocumentsForChat(docs, own, ["alpha"], "limit", { mode: "understand", documentId: "a", planIds: ["alpha"], tiers: {} });
    expect(scope.documents[0].pages[0]).not.toContain("999");
    const documentOnly = scopeDocumentsForChat(docs, own, [], "limit", { mode: "understand", documentId: "a", planIds: [], tiers: {} });
    expect(documentOnly.documents[0].pages[0]).toContain("Unassigned limit 999");
  });
  it("permits an authorized uploaded document without pretending it is a proven plan", () => {
    const parsed = parseSelectionRequest(payload);
    expect(parsed).toMatchObject({
      viewMode: "understand",
      documentId: "b",
      planIds: [],
    });
    expect(validateSelectionScope(parsed!, table)).toBeUndefined();
  });
  it("rejects foreign documents and proven plans from a different document", () => {
    const parsed = parseSelectionRequest({ ...payload, documentId: "foreign" });
    expect(validateSelectionScope(parsed!, table)).toBe("foreign-document");
    const wrongPlan = parseSelectionRequest({ ...payload, planIds: ["alpha"] });
    expect(validateSelectionScope(wrongPlan!, table)).toBe("foreign-plan");
  });
  it("never widens a single-document question to another uploaded policy", () => {
    const documents = table.documents.map((d) => ({
      ...d,
      pages: [
        d.documentId === "a"
          ? "Plan name: Alpha\nSecret Alpha cost $999"
          : `Only ${d.documentId} policy text`,
      ],
    }));
    const scope = scopeDocumentsForChat(
      documents,
      table,
      [],
      "What about Alpha?",
      { mode: "understand", documentId: "b", planIds: [], tiers: {} },
    );
    expect(scope.widened).toBe(false);
    expect(scope.documents.map((d) => d.documentId)).toEqual(["b"]);
  });
  it("masks unselected plan following lines and tier passages inside the same PDF", () => {
    const mixed: Table = {
      ...table,
      plans: [
        ...table.plans!,
        {
          planId: "beta",
          name: "Beta",
          sources: [{ documentId: "a", page: 1, quote: "Beta policy" }],
        },
      ],
      rows: [
        {
          factName: "premium",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "a",
              planId: "alpha",
              display: "100",
              qualifiers: { planTier: "Basic" },
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Alpha Basic premium 100",
                  evidenceId: "ev-basic",
                },
              ],
            },
            {
              documentId: "a",
              planId: "alpha",
              display: "200",
              qualifiers: { planTier: "Elite" },
              evidence: [
                {
                  documentId: "a",
                  page: 1,
                  quote: "Alpha Elite premium 200",
                  evidenceId: "ev-elite",
                },
              ],
            },
          ],
        },
      ],
    };
    const docs = [
      {
        documentId: "a",
        filename: "a.pdf",
        pageCount: 1,
        pages: [
          "Alpha\nAlpha Basic premium 100\nAlpha Elite premium 200\nBeta policy\nUnselected deductible 999",
        ],
      },
    ];
    const scope = scopeDocumentsForChat(
      docs,
      mixed,
      ["alpha"],
      "What about Beta?",
      {
        mode: "understand",
        documentId: "a",
        planIds: ["alpha"],
        tiers: { alpha: "Basic" },
      },
    );
    expect(scope.documents[0].pages[0]).toContain("Alpha Basic premium 100");
    expect(scope.documents[0].pages[0]).not.toContain("200");
    expect(scope.documents[0].pages[0]).not.toContain("999");
    expect(scope.documents[0].pages[0]).not.toContain("Beta");
  });
});
