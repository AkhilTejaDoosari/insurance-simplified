// M7 (agent B): /api/extract seals provisions and issues rows; /api/export and
// /api/chat re-derive a stored result (AT-PERSIST) before showing it.
// Synthetic documents only; provider env blanked; local result store only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { POST as exportPdf } from "@/app/api/export/route";
import { POST as chat } from "@/app/api/chat/route";
import { deleteComparisonResult, loadComparisonResult } from "@/app/lib/comparison-result-db";
import { deleteSession } from "@/app/lib/session";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { attestPlans } from "@/app/lib/extraction/plan-identity";
import {
  SESSIONS_DIR, SYNTHETIC_DOCUMENT, blankProviderEnv, extractedSession as seed, pdfText, post, selectionFor, tamperStoredRow,
} from "./m7b-fixtures";

const extractedSession = () => seed(created);
import { confirmStoredResult } from "@/app/lib/evidence/read-back";
import { sealVerifiedTable } from "@/app/lib/evidence/session-evidence";

const originalEnv = { ...process.env };
const created: string[] = [];

beforeEach(() => blankProviderEnv());

afterEach(async () => {
  process.env = { ...originalEnv };
  for (const id of created.splice(0)) {
    await deleteComparisonResult(id);
    rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
    deleteSession(id);
  }
});

describe("m7b extract → store → read-back", () => {
  it("extract registers the verified plan and responds with issued rows and a canonical fingerprint", async () => {
    const { sessionId, table } = await extractedSession();
    const deductible = table.rows.find((r: { factName: string }) => r.factName === "annual-deductible");
    expect(deductible?.values?.[0]?.display).toContain("$500");
    const record = await loadComparisonResult(sessionId);
    expect(record?.payload.resultFingerprint).toBe(table.resultFingerprint);
    const evidence = sealVerifiedTable(sessionId, [SYNTHETIC_DOCUMENT], {
      schemaVersion: "v1", factListVersion: record!.payload.factListVersion, documents: record!.payload.documents,
      ...(record!.payload.plans ? { plans: record!.payload.plans } : {}), rows: record!.payload.rows as never,
    });
    expect(evidence.registry.get("doc-m7b")?.plan?.name.value).toBe("Example Health Silver");
    // Line-engine values carry no plan attribution, so none becomes a
    // provision (the store admits only plan-scoped provisions).
    expect(evidence.store.list()).toEqual([]);
  });

  it("seals plan-attributed verified values (incl. an exclusion) from verify-table output", () => {
    const doc = {
      documentId: "doc-labelled", filename: "labelled.pdf", pageCount: 2,
      pages: [
        "Plan name: Example Health Silver\nSummary",
        "Plan name: Example Health Silver; material-exclusions: Cosmetic surgery is not covered.\nPlan name: Example Health Silver; annual-deductible: $500",
      ],
    };
    const plans = attestPlans([doc]);
    const planId = plans[0].planId;
    const verified = verifyComparisonTable({
      schemaVersion: "v1", factListVersion: "v1", documents: [{ documentId: doc.documentId, filename: doc.filename, pageCount: 2 }], plans,
      rows: [
        { factName: "annual-deductible", verdict: "SUPPORTED", values: [{ documentId: doc.documentId, planId, display: "$500", qualifiers: {}, evidence: [{ documentId: doc.documentId, page: 2, quote: "Plan name: Example Health Silver; annual-deductible: $500" }] }] },
        { factName: "material-exclusions", verdict: "SUPPORTED", values: [{ documentId: doc.documentId, planId, display: "Cosmetic surgery is not covered.", qualifiers: {}, evidence: [{ documentId: doc.documentId, page: 2, quote: "Plan name: Example Health Silver; material-exclusions: Cosmetic surgery is not covered." }] }] },
      ],
    }, [doc]);
    const evidence = sealVerifiedTable("sess-labelled", [doc], verified);
    expect(evidence.store.listByKind("cost_share", { documentId: doc.documentId })).toHaveLength(1);
    const exclusions = evidence.store.listByKind("exclusion", { documentId: doc.documentId });
    expect(exclusions.map((p) => p.claim)).toEqual(["Cosmetic surgery is not covered."]);
    expect(evidence.provisionIdsByRow.map((ids) => ids.length)).toEqual([1, 1]);
  });

  it("an unaltered stored result re-derives and renders normally", async () => {
    const { sessionId, table } = await extractedSession();
    const record = (await loadComparisonResult(sessionId))!;
    const confirmed = confirmStoredResult({ sessionId, documents: [SYNTHETIC_DOCUMENT], record });
    expect(confirmed.cannotBeConfirmed).toEqual([]);
    expect(confirmed.table.rows.map((r) => r.verdict)).toEqual(table.rows.map((r: { verdict: string }) => r.verdict));
  });

  it("export of an unaltered stored result shows its values and no 'cannot be confirmed'", async () => {
    const { sessionId, capability, table } = await extractedSession();
    const res = await exportPdf(post("/api/export", { sessionId, selection: selectionFor(table) }, capability));
    expect(res.status).toBe(200);
    const text = await pdfText(res);
    expect(text).toContain("$500");
    expect(text).not.toContain("cannot be confirmed");
  });

  it("a stored row altered after issue is 'cannot be confirmed' on export and keeps no value", async () => {
    const { sessionId, capability, table } = await extractedSession();
    tamperStoredRow(sessionId, "annual-deductible", (row) => {
      (row.values as { display: string }[])[0].display = "$0 per person";
    });
    const res = await exportPdf(post("/api/export", { sessionId, selection: selectionFor(table) }, capability));
    expect(res.status).toBe(200);
    const text = await pdfText(res);
    expect(text).toContain("cannot be confirmed");
    expect(text).not.toContain("$0 per person");
  });

  it("a changed session document makes a stored result unconfirmable (not silently trusted)", async () => {
    const { sessionId } = await extractedSession();
    const record = (await loadComparisonResult(sessionId))!;
    const changed = { ...SYNTHETIC_DOCUMENT, pages: [SYNTHETIC_DOCUMENT.pages[0], SYNTHETIC_DOCUMENT.pages[1].replace("$500", "$900")] };
    const confirmed = confirmStoredResult({ sessionId, documents: [changed], record });
    expect(confirmed.cannotBeConfirmed.length).toBe(record.payload.rows.length);
    expect(confirmed.table.rows.every((r) => r.values.length === 0)).toBe(true);
  });

  it("chat attaches related comparison results, confirmed when unaltered", async () => {
    const { sessionId, capability } = await extractedSession();
    const res = await chat(post("/api/chat", { sessionId, question: "What is the annual deductible?", engine: "fallback" }, capability));
    expect(res.status).toBe(200);
    const body = await res.json();
    if (body.kind !== "answer") throw new Error("expected an answer from the synthetic document");
    const deductible = (body.resolutions ?? []).find((r: { factName: string }) => r.factName === "annual-deductible");
    expect(deductible?.status).toBe("confirmed");
  });
});
