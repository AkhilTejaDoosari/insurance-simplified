// Bodies of TB-1 and TB-3 (docs/evidence-core.md §5), run from
// tests/integration/trust-boundary.test.ts against application code.
// Synthetic documents only; provider env blanked; local result store only.
import { expect } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceAuthority, sha256Hex } from "@/app/lib/evidence/canonical";
import { SessionDocumentRegistry } from "@/app/lib/evidence/registry";
import { sealProvision, type ProvisionContent } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { issueRows, renderIssuedRows } from "@/app/lib/evidence/row-resolution";
import { sealVerifiedTable } from "@/app/lib/evidence/session-evidence";
import { cannotBeConfirmedFacts } from "@/app/lib/presentation/adaptive";
import { exclusionOutcomeViews, resolveExclusionOutcomes } from "@/app/lib/evidence/exclusion-outcomes";
import { exclusionScenario } from "./m7d-trust-fixtures";
import AdaptiveResults from "@/app/components/AdaptiveResults";
import { POST as chat } from "@/app/api/chat/route";
import { POST as exportPdf } from "@/app/api/export/route";
import { deleteComparisonResult } from "@/app/lib/comparison-result-db";
import { deleteSession } from "@/app/lib/session";
import { withEvidenceId } from "@/app/lib/evidence-ids";
import type { ComparisonTable, RegisteredComparisonTable } from "@/app/lib/extraction/types";
import {
  SESSIONS_DIR, SYNTHETIC_DOCUMENT, blankProviderEnv, extractedSession, pdfText, post, selectionFor, tamperStoredRow,
} from "./m7b-fixtures";

// Components compile with the classic JSX runtime under Vitest.
(globalThis as { React?: typeof React }).React ??= React;

// ---------------------------------------------------------------- TB-1

const SESSION = "sess-tb1";
const DOC = `${SESSION}--doc`;
const PAGE1 = "Plan name: Example Health Silver\nPlan year: January 1, 2026 through December 31, 2026";
const PAGE2 = "Cosmetic surgery is not covered.\nCoverage period: March 1, 2026 to June 30, 2026";
const BYTES = new TextEncoder().encode("%PDF-synthetic-tb1");

function span(page: 1 | 2, text: string) {
  const source = page === 1 ? PAGE1 : PAGE2;
  const start = source.indexOf(text);
  if (start < 0) throw new Error("fixture span missing");
  return { documentId: DOC, page, start, end: start + text.length, text };
}

function tb1Store(authority: EvidenceAuthority): ProvisionStore {
  const registry = new SessionDocumentRegistry(SESSION);
  const registered = registry.register({
    sessionId: SESSION, documentId: DOC, bytes: BYTES, pages: [PAGE1, PAGE2],
    plan: {
      planId: "plan-example",
      name: { value: "Example Health Silver", span: span(1, "Plan name: Example Health Silver") },
      period: { start: "2026-01-01", end: "2026-12-31", span: span(1, "Plan year: January 1, 2026 through December 31, 2026") },
    },
  });
  expect(registered.ok).toBe(true);
  return new ProvisionStore(SESSION, registry, authority);
}

function tb1Content(overrides: Partial<ProvisionContent>): ProvisionContent {
  return {
    sessionId: SESSION, documentId: DOC, documentSha256: sha256Hex(BYTES), kind: "exclusion",
    claim: "Cosmetic surgery is not covered.",
    plan: { planId: "plan-example", name: "Example Health Silver", nameSpan: span(1, "Plan name: Example Health Silver") },
    scope: {},
    evidence: [{ documentId: DOC, page: 2, quote: "Cosmetic surgery is not covered." }],
    period: { start: "2026-03-01", end: "2026-06-30", span: span(2, "Coverage period: March 1, 2026 to June 30, 2026") },
    ...overrides,
  };
}

export function runTb1(): void {
  // Control: the same provision with genuinely bound plan-name and period
  // evidence is admitted, so a refusal below is caused by the binding alone.
  const controlAuthority = new EvidenceAuthority();
  const control = tb1Store(controlAuthority);
  expect(control.accept(sealProvision(controlAuthority, tb1Content({}))).ok).toBe(true);

  // Unbound source "blocks": text that names the plan / states the period but
  // sits at offsets where the stored page says something else.
  const unboundName = { documentId: DOC, page: 2, start: 0, end: 32, text: "Plan name: Example Health Silver" };
  const unboundPeriod = { documentId: DOC, page: 1, start: 0, end: 40, text: "Coverage period: March 2026 to June 2026" };
  const attacks: Partial<ProvisionContent>[] = [
    { plan: { planId: "plan-example", name: "Example Health Silver", nameSpan: unboundName } },
    { period: { start: "2026-03-01", end: "2026-06-30", span: unboundPeriod } },
    {
      plan: { planId: "plan-example", name: "Example Health Silver", nameSpan: unboundName },
      period: { start: "2026-03-01", end: "2026-06-30", span: unboundPeriod },
    },
  ];
  for (const attack of attacks) {
    const authority = new EvidenceAuthority();
    const store = tb1Store(authority);
    // Properly sealed by the store's own authority: only the binding is wrong.
    const result = store.accept(sealProvision(authority, tb1Content(attack)));
    expect(result.ok).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.listByKind("exclusion")).toEqual([]);
    expect(store.listByDocument(DOC)).toEqual([]);
  }
}

// ---------------------------------------------------------------- TB-3

const CBC = "cannot be confirmed";

export async function runTb3(): Promise<void> {
  const originalEnv = { ...process.env };
  const created: string[] = [];
  blankProviderEnv();
  try {
    const { sessionId, capability, table } = await extractedSession(created);
    const target = "annual-deductible";
    const altered = "$0 per person";
    expect(table.rows.find((r: { factName: string }) => r.factName === target)?.values?.length).toBeGreaterThan(0);

    // 1. Comparison view: rows issued by the extraction pipeline, one altered
    //    after issue, rendered through the view-model and the UI component.
    const core: ComparisonTable = {
      schemaVersion: "v1", factListVersion: table.factListVersion, documents: table.documents,
      ...(table.plans ? { plans: table.plans } : {}),
      rows: table.rows.map((r: ComparisonTable["rows"][number]) => ({
        ...r, values: r.values.map((v) => ({ ...v, evidence: v.evidence.map(({ documentId, page, quote }) => ({ documentId, page, quote })) })),
      })),
    };
    const { authority, provisionIdsByRow } = sealVerifiedTable(sessionId, [SYNTHETIC_DOCUMENT], core);
    const issued = issueRows(authority, sessionId, core.rows, provisionIdsByRow);
    const index = core.rows.findIndex((r) => r.factName === target);
    const tampered = issued.map((entry, i) => i !== index ? entry : {
      ...entry,
      resolution: { ...entry.resolution, row: { ...entry.resolution.row, values: entry.resolution.row.values.map((v) => ({ ...v, display: altered })) } },
    });
    const rendered = renderIssuedRows(authority, sessionId, tampered);
    const view: RegisteredComparisonTable = {
      ...core,
      rows: rendered.rows.map((r) => ({ ...r, values: r.values.map((v) => ({ ...v, evidence: v.evidence.map(withEvidenceId) })) })),
    };
    expect(cannotBeConfirmedFacts(view).map((n) => [n.concept, n.status])).toEqual([[target, CBC]]);
    const html = renderToStaticMarkup(createElement(AdaptiveResults, {
      table: view,
      view: { mode: "understand", documentId: table.documents[0].documentId, planIds: [], tiers: {} },
      sessionId, userContext: {}, contacts: [],
    }));
    expect(html.toLowerCase()).toContain(CBC);
    expect(html).not.toContain(altered);

    // Exclusion/applicability outcomes take the same gate on every surface
    // (exclusion-outcomes.ts → displayIssuedResolution): altered after issue
    // → "cannot be confirmed"; unaltered → confirmed.
    const scenario = exclusionScenario({ coverage: "complete" });
    const outcomes = resolveExclusionOutcomes(scenario.store, scenario.authority, "Is acupuncture covered?", { documentIds: [scenario.documentId] });
    expect(outcomes.length).toBeGreaterThan(0);
    expect(exclusionOutcomeViews(scenario.authority, scenario.sessionId, outcomes).every((v) => v.status === "confirmed")).toBe(true);
    const alteredOutcomes = outcomes.map((o) => ({ ...o, resolution: { ...o.resolution, outcome: "verified" } }));
    const shownAltered = exclusionOutcomeViews(scenario.authority, scenario.sessionId, alteredOutcomes);
    expect(shownAltered.map((v) => v.status)).toEqual(outcomes.map(() => CBC));
    expect(shownAltered.some((v) => v.verdict === "SUPPORTED")).toBe(false);

    // 2 & 3. The persisted result is altered after issue (stored fingerprint
    //    left untouched), then read back by chat and export.
    tamperStoredRow(sessionId, target, (row) => {
      (row.values as { display: string }[]).forEach((v) => { v.display = altered; });
    });

    const chatRes = await chat(post("/api/chat", { sessionId, question: "What is the annual deductible?", engine: "fallback" }, capability));
    expect(chatRes.status).toBe(200);
    const answer = await chatRes.json();
    // P0-02: without a generation model chat returns "cannot be confirmed"
    // with verified passages; related results are still attached.
    expect(answer.kind).toBe("refusal");
    expect(answer.citations?.length).toBeGreaterThan(0);
    const related = (answer.resolutions ?? []).find((r: { factName: string }) => r.factName === target);
    expect(related?.status).toBe(CBC);
    expect(JSON.stringify(answer)).not.toContain(altered);

    const exportRes = await exportPdf(post("/api/export", { sessionId, selection: selectionFor(table) }, capability));
    expect(exportRes.status).toBe(200);
    const text = await pdfText(exportRes);
    expect(text).toContain(CBC);
    expect(text).not.toContain(altered);
  } finally {
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      await deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  }
}
