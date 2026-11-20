// Owner decision 3 (2026-11-20): a session stored under an earlier identity
// rule must not silently lose its verified plans on read-back when today's
// rule would recognise MORE plans. Compatibility: the stored identities are
// re-verified on their pages exactly as stored (nothing new trusted), rows are
// re-derived under them, and documents the current rule could now identify
// are marked "reanalysis-available". Synthetic text only.
import { describe, expect, it } from "vitest";
import { confirmStoredResult } from "@/app/lib/evidence/read-back";
import { documentFingerprint, resultFingerprintFor, type ComparisonResultRecord } from "@/app/lib/comparison-result-db";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { planInventoryOf } from "@/app/lib/extraction/plan-inventory";
import type { ComparisonTable } from "@/app/lib/extraction/types";

const SESSION = "sess-legacy-identity";
const docs = [
  { documentId: "d1", filename: "one.pdf", pageCount: 1, pages: ["Plan name: Northwind Alpha\nAnnual deductible: $250."] },
  // Recognisable only under the generalized title rule.
  { documentId: "d2", filename: "two.pdf", pageCount: 1, pages: ["Northwind Voyager Plus®\nCertificate of Insurance\nAnnual deductible: $400."] },
];

function recordFor(table: ComparisonTable): ComparisonResultRecord {
  const documentFp = documentFingerprint(docs);
  return {
    sessionId: SESSION,
    status: "ready",
    documentFingerprint: documentFp,
    payload: {
      ...table,
      resultFingerprint: resultFingerprintFor({ documentFingerprint: documentFp, table, context: {} }),
      userContext: {},
      presentationGroups: [],
    },
    createdAt: "",
    updatedAt: "",
    expiresAt: "",
  } as unknown as ComparisonResultRecord;
}

// What the previous rule stored: only d1 had a verified identity.
function legacyStoredTable(): ComparisonTable {
  const current = verifyComparisonTable(
    { schemaVersion: "v1", factListVersion: "v1", documents: docs.map(({ pages: _p, ...d }) => d), rows: [] },
    docs,
  );
  const d1Plans = current.plans!.filter((p) => p.sources.every((s) => s.documentId === "d1"));
  expect(current.plans!.length).toBe(2); // the current rule sees both
  const { planInventory: _drop, ...rest } = current;
  return { ...rest, plans: d1Plans };
}

describe("legacy read-back keeps verified identities (owner decision 3)", () => {
  it("re-verifies the stored plans instead of dropping them, and seals evidence", () => {
    const stored = legacyStoredTable();
    const confirmed = confirmStoredResult({ sessionId: SESSION, documents: docs, record: recordFor(stored) });
    expect(confirmed.table.plans).toEqual(stored.plans);
    expect(confirmed.evidence).not.toBeNull();
  });

  it("marks a document the current rule can now identify as re-analysis available, not silently unresolved", () => {
    const confirmed = confirmStoredResult({ sessionId: SESSION, documents: docs, record: recordFor(legacyStoredTable()) });
    expect(planInventoryOf(confirmed.table)).toEqual([
      { documentId: "d1", planIds: [confirmed.table.plans![0].planId], status: "verified-plan" },
      { documentId: "d2", planIds: [], status: "reanalysis-available" },
    ]);
  });

  it("still withholds identities when a stored plan no longer verifies on its page", () => {
    const stored = legacyStoredTable();
    const tampered = {
      ...stored,
      plans: stored.plans!.map((p) => ({ ...p, sources: p.sources.map((s) => ({ ...s, quote: "Plan name: Forged Plan" })), name: "Forged Plan" })),
    };
    const confirmed = confirmStoredResult({ sessionId: SESSION, documents: docs, record: recordFor(tampered) });
    expect(confirmed.table.plans).toBeUndefined();
    expect(confirmed.evidence).toBeNull();
  });

  it("does not apply the legacy path to a current (v2) result whose plans were stripped", () => {
    const current = verifyComparisonTable(
      { schemaVersion: "v1", factListVersion: "v2", documents: docs.map(({ pages: _p, ...d }) => d), rows: [] },
      docs,
    );
    const { planInventory: _drop, plans: _stripped, ...stripped } = current;
    const confirmed = confirmStoredResult({ sessionId: SESSION, documents: docs, record: recordFor(stripped as ComparisonTable) });
    expect(confirmed.evidence).toBeNull();
  });
});
