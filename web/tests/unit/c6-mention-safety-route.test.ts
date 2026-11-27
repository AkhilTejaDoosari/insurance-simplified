// C6 explicit-mention safety: a citation that names the plan must not exempt
// an unrelated amount or a glossary definition from semantic support. Full
// route path: real attestation, citation verification, attributePlanScope
// (mention), resolveRowPlanIds (Stage E) and presentation state. Only the
// extraction engine is stubbed (same pattern as plan-title-block-route).
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { indexFacts, type ActiveView } from "@/app/lib/presentation/adaptive";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

vi.mock("@/app/lib/extraction/extract", () => ({
  extractFallback: vi.fn(),
  extractViaLlm: vi.fn(),
}));

import { POST } from "@/app/api/extract/route";
import { extractFallback } from "@/app/lib/extraction/extract";

const mockedFallback = vi.mocked(extractFallback);
const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
  vi.resetAllMocks();
});

const PAGE_1 = "Plan name: Acme Plan";

async function run(factName: string, quote: string, display: string) {
  const pages = [PAGE_1, quote];
  const { session, capability } = createSession(
    [{ documentId: "acme", filename: "acme.pdf", pageCount: pages.length, pages }],
    {},
  );
  created.push(session.sessionId);
  mockedFallback.mockReturnValue({
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "acme", filename: "acme.pdf", pageCount: pages.length }],
    rows: [{
      factName,
      verdict: "SUPPORTED",
      values: [{ documentId: "acme", display, qualifiers: {}, evidence: [{ documentId: "acme", page: 2, quote }] }],
    }],
  } as never);
  const res = await POST(new NextRequest("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
    body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
  }));
  expect(res.status).toBe(200);
  const table = (await res.json()) as RegisteredComparisonTable;
  expect(table.plans?.map((p) => p.name)).toEqual(["Acme Plan"]);
  const planId = table.plans![0].planId;
  const value = table.rows.find((r) => r.factName === factName)!.values[0];
  const view: ActiveView = { mode: "understand", documentId: "acme", planIds: [planId], tiers: {} };
  const fact = indexFacts(table, view).find((f) => f.concept === factName);
  return { planId, value, state: fact?.state };
}

describe("explicit plan mention does not exempt unrelated amounts or definitions", () => {
  it.each([
    ["OpenCode scenario", "Acme Plan. Telehealth: The distribution of health-related services via electronic information. Administrative fee: $100."],
    ["lowercase article", "Acme Plan. Telehealth: the distribution of health-related services via electronic information. Administrative fee: $100."],
    ["uppercase article", "Acme Plan. Telehealth: THE distribution of health-related services via electronic information. Administrative fee: $100."],
    ["plan name with colon", "Acme Plan: Telehealth: The distribution of health-related services via electronic information. Administrative fee: $100."],
    ["plan name with dash", "Acme Plan - Telehealth: The distribution of health-related services via electronic information. Administrative fee: $100."],
    ["plan name at the end", "Telehealth: The distribution of health-related services via electronic information. Administrative fee: $100 (Acme Plan)."],
    ["fee joined by semicolon", "Acme Plan. Telehealth: The distribution of health-related services via electronic information; administrative fee: $100."],
    ["unrelated fee without definition", "Acme Plan. Telehealth services are described in Section 4. Administrative fee: $100."],
  ])("%s: the unrelated fee is not a verified-plan telehealth fact", async (_label, quote) => {
    const { value, state } = await run("telehealth", quote, "$100");
    expect(value.planId).toBeUndefined();
    expect(state).not.toBe("verified-plan");
  });

  it("an unrelated percentage after a definition is not a coinsurance fact", async () => {
    const { value } = await run("coinsurance", "Acme Plan. Coinsurance: The percentage of costs you share. Late payment charge: 5%.", "5%");
    expect(value.planId).toBeUndefined();
  });
});

// Policy 2026-11-14: a plan-name mention does not attribute a line value
// (see plan-identity resolveRowPlanIds). These stay displayed, unattributed.
describe("well-formed provisions that name the plan stay displayed but unattributed", () => {
  it.each([
    ["telehealth", "Acme Plan. Telehealth: $0 copay per visit.", "$0"],
    ["coinsurance", "Acme Plan. Coinsurance: 80% after deductible.", "80%"],
    ["annual-deductible", "Acme Plan. Deductible: $500 per Period of Coverage.", "$500"],
  ])("%s", async (fact, quote, display) => {
    const { value, state } = await run(fact, quote, display);
    expect(value.display).toBe(display);
    expect(value.planId).toBeUndefined();
    expect(state).not.toBe("verified-plan");
  });
});
