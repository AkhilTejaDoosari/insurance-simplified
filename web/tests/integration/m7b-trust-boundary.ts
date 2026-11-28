// Bodies of TB-1 and TB-3 (docs/evidence-core.md §5), run from
// tests/integration/trust-boundary.test.ts against application code.
// Synthetic documents only; provider env blanked; local result store only.
import { expect } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceAuthority, sha256Hex } from "@/app/lib/evidence/canonical";
import { SessionDocumentRegistry } from "@/app/lib/evidence/registry";
import { sealProvision, type ProvisionContent } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { exclusionOutcomeViews, resolveExclusionOutcomes } from "@/app/lib/evidence/exclusion-outcomes";
import { exclusionScenario } from "./m7d-trust-fixtures";
import { NextRequest } from "next/server";
import { GET as results } from "@/app/api/results/[sessionId]/route";
import { POST as exportPdf } from "@/app/api/export/route";
import { bundleFromEngine } from "@/app/demo/lib/demo-adapter";
import { demoModel } from "@/app/demo/lib/demo-logic";
import { demoChat } from "@/app/demo/lib/demo-chat";
import { Cell, DemoContext } from "@/app/demo/components/shared";
import { SESSION_CAPABILITY_COOKIE } from "@/app/lib/session-capability";
import type { V2Document, V2Fact } from "@/app/lib/engine/client";
import { deleteComparisonResult } from "@/app/lib/comparison-result-db";
import { deleteSession } from "@/app/lib/session";
import {
  SESSIONS_DIR, SYNTHETIC_DOCUMENT, blankProviderEnv, extractedSession, pdfText, post, selectionFor,
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

// ---------------------------------------------------------------- TB-3 (V2)
//
// The V2 result is the engine's facts, saved with the session by /api/extract. An edit to
// the saved result after it was issued must show as "Couldn't confirm" on every V2 surface:
// the results screen (GET /api/results -> the V2 bundle -> the cell), its chat (the V2
// chat router over the same bundle) and the export (/api/export). The guard is the V2
// read-back gate (app/lib/engine/read-back.ts); without it each assertion below fails.

const CC = "Couldn't confirm";
const DOC_ID = SYNTHETIC_DOCUMENT.documentId;
const DED_CATEGORY = { key: "ded", name: "Deductible", tier: 1, order: 1, explain: "You pay this first." };

function issuedEngineResult(): V2Document[] {
  return [
    {
      documentId: DOC_ID,
      filename: SYNTHETIC_DOCUMENT.filename,
      pages: 2,
      facts: [
        {
          id: "f-ded",
          label: "Annual deductible",
          column: "",
          state: "verified",
          quote: "$500 per person",
          page: 2,
          categoryKey: "ded",
          value: {
            kind: "amount", number: "500", currency: "USD", basis: "per_year", year_kind: null, text: null,
            counts_toward_deductible: null,
          } as V2Fact["value"],
          plain: "You pay the first $500 yourself each year.",
        },
      ],
      openItems: [],
      categories: [DED_CATEGORY],
      categorySearch: {},
      checksIncomplete: false,
    },
  ];
}

/** Rewrites the saved engine result (local store) the way an attacker with storage access
 *  would; the stored fingerprints are left as they are. */
function editSavedEngineResult(sessionId: string, mutate: (docs: V2Document[]) => void): void {
  const path = join(SESSIONS_DIR, `${sessionId}.result.json`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.payload.engine ??= { documents: [] };
  mutate(record.payload.engine.documents);
  writeFileSync(path, JSON.stringify(record));
}

async function v2Surfaces(sessionId: string, capability: string, table: Parameters<typeof selectionFor>[0]) {
  const req = new NextRequest(`http://localhost/api/results/${sessionId}`, {
    headers: { cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
  });
  const res = await results(req, { params: Promise.resolve({ sessionId }) });
  expect(res.status).toBe(200);
  const saved = (await res.json()) as { engine: { documents: V2Document[] } };
  const M = demoModel(bundleFromEngine(saved.engine.documents));
  const actions = { M, openSource: () => undefined, openPdf: () => undefined, pdfUrl: () => "", pdfNote: "" };
  const html = renderToStaticMarkup(
    createElement(DemoContext.Provider, { value: actions }, createElement(Cell, { id: DOC_ID, k: "ded" })),
  );
  // the text a person reads on the screen
  const screen = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  const reply = demoChat(M).typed("What is the deductible?", [DOC_ID]);
  const chatText = reply.lines.flat().map((seg) => ("text" in seg ? seg.text : seg.label)).join("");
  const exported = await exportPdf(post("/api/export", { sessionId, selection: selectionFor(table) }, capability));
  expect(exported.status).toBe(200);
  return { screen, chat: chatText, exported: await pdfText(exported) };
}

export async function runTb3(): Promise<void> {
  const originalEnv = { ...process.env };
  const created: string[] = [];
  blankProviderEnv();
  try {
    const { sessionId, capability, table } = await extractedSession(created);
    editSavedEngineResult(sessionId, (docs) => docs.splice(0, docs.length, ...issuedEngineResult()));

    // Issued and untouched: verified on every surface.
    const before = await v2Surfaces(sessionId, capability, table);
    expect(before.screen).toContain("Verified");
    expect(before.screen).toContain("$500");
    expect(before.chat).toContain("$500");
    expect(before.exported).toContain("$500 per person");

    // Attack 1: the saved value (and its plain words) altered after issue.
    editSavedEngineResult(sessionId, (docs) => {
      const f = docs[0].facts[0];
      f.value = { ...f.value!, number: "50" };
      f.plain = "You pay the first $50 yourself each year.";
    });
    for (const [surface, text] of Object.entries(await v2Surfaces(sessionId, capability, table))) {
      expect(text, surface).not.toContain("$50 ");
      expect(text, surface).not.toMatch(/\$50(?!0)/);
      expect(text, surface).not.toContain("Verified");
    }
    const after1 = await v2Surfaces(sessionId, capability, table);
    expect(after1.screen).toContain(CC);
    expect(after1.chat).toContain("Check page 2");
    expect(after1.exported).toContain(CC);

    // Attack 2: the saved words themselves altered (value made consistent with them).
    editSavedEngineResult(sessionId, (docs) => {
      docs.splice(0, docs.length, ...issuedEngineResult());
      const f = docs[0].facts[0];
      f.quote = "$50 per person";
      f.value = { ...f.value!, number: "50" };
    });
    const after2 = await v2Surfaces(sessionId, capability, table);
    for (const [surface, text] of Object.entries(after2)) {
      expect(text, surface).not.toMatch(/\$50(?!0)/);
    }
    expect(after2.screen).toContain(CC);
    expect(after2.exported).toContain(CC);

    // Exclusion/applicability outcomes take the same gate on every surface
    // (exclusion-outcomes.ts -> displayIssuedResolution): altered after issue
    // -> "cannot be confirmed"; unaltered -> confirmed.
    const scenario = exclusionScenario({ coverage: "complete" });
    const outcomes = resolveExclusionOutcomes(scenario.store, scenario.authority, "Is acupuncture covered?");
    expect(outcomes.length).toBeGreaterThan(0);
    expect(exclusionOutcomeViews(scenario.authority, scenario.sessionId, outcomes).every((v) => v.status === "confirmed")).toBe(true);
    const alteredOutcomes = outcomes.map((o) => ({ ...o, resolution: { ...o.resolution, outcome: "verified" } }));
    const shownAltered = exclusionOutcomeViews(scenario.authority, scenario.sessionId, alteredOutcomes);
    expect(shownAltered.map((v) => v.status)).toEqual(outcomes.map(() => "cannot be confirmed"));
    expect(shownAltered.some((v) => v.verdict === "SUPPORTED")).toBe(false);
  } finally {
    process.env = { ...originalEnv };
    for (const id of created.splice(0)) {
      await deleteComparisonResult(id);
      rmSync(join(SESSIONS_DIR, `${id}.result.json`), { force: true });
      deleteSession(id);
    }
  }
}
