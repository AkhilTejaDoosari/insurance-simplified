// P0-01 regression: every uploaded document stays in the plan inventory, with
// an explicit reason when no plan identity could be verified. A model that
// proposes plans for some documents must not suppress deterministic
// attestation of the documents it omitted, and a plan dropped for an
// unverifiable source must leave a visible record instead of vanishing.
import { describe, expect, it } from "vitest";
import { verifyComparisonTable, type VerifiableDocument } from "@/app/lib/extraction/verify-table";
import { planInventoryOf } from "@/app/lib/extraction/plan-inventory";
import type { ComparisonTable } from "@/app/lib/extraction/types";

const doc = (documentId: string, firstPage: string): VerifiableDocument => ({
  documentId,
  filename: `${documentId}.pdf`,
  pageCount: 2,
  pages: [firstPage, "Annual deductible: $500."],
});

const DOCUMENTS: VerifiableDocument[] = [
  doc("doc-1", "Policy name: Alpha\nAnnual deductible: $250."),
  doc("doc-2", "Policy name: Beta\nAnnual deductible: $300."),
  doc("doc-3", "Policy name: Gamma\nAnnual deductible: $400."),
  // A declaration the model omitted; deterministic attestation can prove it.
  doc("doc-4", "Policy name: Delta\nAnnual deductible: $450."),
  // The model claims a plan whose quote is not on the cited page.
  doc("doc-5", "Summary of benefits\nAnnual deductible: $600."),
];

const proposed = (planId: string, name: string, documentId: string, quote = `Policy name: ${name}`) => ({
  planId,
  name,
  sources: [{ documentId, page: 1, quote }],
});

function modelTable(): ComparisonTable {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: DOCUMENTS.map(({ documentId, filename, pageCount }) => ({ documentId, filename, pageCount })),
    plans: [
      proposed("p-alpha", "Alpha", "doc-1"),
      proposed("p-beta", "Beta", "doc-2"),
      proposed("p-gamma", "Gamma", "doc-3"),
      proposed("p-epsilon", "Epsilon", "doc-5", "Policy name: Epsilon"),
    ],
    rows: [],
  };
}

describe("plan inventory (P0-01)", () => {
  it("attests documents the model omitted and records every uploaded document", () => {
    const verified = verifyComparisonTable(modelTable(), DOCUMENTS);

    expect(verified.plans?.map((p) => p.name).sort()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
    expect(verified.planInventory?.map((e) => e.documentId)).toEqual(["doc-1", "doc-2", "doc-3", "doc-4", "doc-5"]);
    const byDoc = new Map(verified.planInventory!.map((e) => [e.documentId, e]));
    expect(byDoc.get("doc-4")?.status).toBe("verified-plan");
    expect(byDoc.get("doc-4")?.planIds).toHaveLength(1);
    expect(byDoc.get("doc-5")).toEqual({ documentId: "doc-5", planIds: [], status: "plan-source-unverified" });
  });

  it("never invents an identity: a document without a declaration is unresolved with a reason", () => {
    const table: ComparisonTable = { ...modelTable(), plans: undefined };
    const verified = verifyComparisonTable(table, DOCUMENTS);
    const doc5 = verified.planInventory!.find((e) => e.documentId === "doc-5");
    expect(doc5).toEqual({ documentId: "doc-5", planIds: [], status: "no-verified-plan-name" });
    expect(verified.plans?.some((p) => p.sources.some((s) => s.documentId === "doc-5"))).toBe(false);
  });

  it("does not attest a second plan into a document the model already proved", () => {
    const docs = [doc("doc-1", "Policy name: Alpha\nPlan name: Shadow")];
    const table: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "doc-1.pdf", pageCount: 2 }],
      plans: [proposed("p-alpha", "Alpha", "doc-1")],
      rows: [],
    };
    expect(verifyComparisonTable(table, docs).plans?.map((p) => p.name)).toEqual(["Alpha"]);
  });

  it("is idempotent, so stored results re-derive to identical plans on read-back", () => {
    const once = verifyComparisonTable(modelTable(), DOCUMENTS);
    const twice = verifyComparisonTable(structuredClone(once), DOCUMENTS);
    expect(twice.plans).toEqual(once.plans);
    expect(twice.planInventory?.map((e) => e.status)).toEqual(
      ["verified-plan", "verified-plan", "verified-plan", "verified-plan", "no-verified-plan-name"],
    );
  });

  it("planInventoryOf covers every document even when the server record is absent or stale", () => {
    const table: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [
        { documentId: "a", filename: "a.pdf", pageCount: 1 },
        { documentId: "b", filename: "b.pdf", pageCount: 1 },
        { documentId: "c", filename: "c.pdf", pageCount: 1 },
      ],
      plans: [proposed("p-a", "Alpha", "a")],
      // Stale record: claims a plan for "b" that is not in table.plans and omits "c".
      planInventory: [
        { documentId: "a", planIds: ["p-a"], status: "verified-plan" },
        { documentId: "b", planIds: ["p-ghost"], status: "verified-plan" },
      ],
      rows: [],
    };
    expect(planInventoryOf(table)).toEqual([
      { documentId: "a", planIds: ["p-a"], status: "verified-plan" },
      { documentId: "b", planIds: [], status: "no-verified-plan-name" },
      { documentId: "c", planIds: [], status: "no-verified-plan-name" },
    ]);
    const { planInventory: _omit, ...legacy } = table;
    expect(planInventoryOf(legacy).map((e) => e.documentId)).toEqual(["a", "b", "c"]);
  });

  it("keeps the unverified-source reason only for a document that still has no plan", () => {
    const table: ComparisonTable = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "a", filename: "a.pdf", pageCount: 1 }],
      planInventory: [{ documentId: "a", planIds: [], status: "plan-source-unverified" }],
      rows: [],
    };
    expect(planInventoryOf(table)).toEqual([{ documentId: "a", planIds: [], status: "plan-source-unverified" }]);
  });

  it("re-derives a stored deterministic-path result to identical plans (no read-back drift)", () => {
    // Sessions extracted without a model: plans came from attestation of every
    // document. Re-verifying the stored table must reproduce them exactly,
    // because read-back.ts drops plan identities on any difference.
    const deterministic = verifyComparisonTable({ ...modelTable(), plans: undefined }, DOCUMENTS);
    const stored = structuredClone(deterministic);
    expect(verifyComparisonTable(stored, DOCUMENTS).plans).toEqual(deterministic.plans);
  });

  it("pins the known legacy edge: an LLM-path result stored before P0-01 that omitted an attestable document re-derives an extra plan", () => {
    // Fail-closed by design: read-back sees different plans and withholds
    // plan identities instead of trusting the stale list. Recorded in the P0 ledger.
    const legacyStored: ComparisonTable = {
      ...modelTable(),
      plans: [proposed("p-alpha", "Alpha", "doc-1")],
    };
    const rederived = verifyComparisonTable(structuredClone(legacyStored), DOCUMENTS);
    expect(rederived.plans).not.toEqual(legacyStored.plans);
  });
});
