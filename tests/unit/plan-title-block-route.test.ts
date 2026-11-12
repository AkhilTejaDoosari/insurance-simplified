// P2.1 route-level proof: enrollment scope survives validation, Stage E plan
// attribution and the comparison presentation for a recognized FEP-style plan,
// and is never silently converted into a plan-wide value. The extraction
// engine is mocked (no LLM); attestation, citation verification, Stage E and
// presentation are the real code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { buildPresentation, indexFacts, type ActiveView } from "@/app/lib/presentation/adaptive";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

vi.mock("@/app/lib/extraction/extract", () => ({
  extractFallback: vi.fn(),
  extractViaLlm: vi.fn(),
}));

import { POST } from "@/app/api/extract/route";
import { extractFallback } from "@/app/lib/extraction/extract";

const mockedFallback = vi.mocked(extractFallback);
const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests/fixtures/fep-pages", name), "utf8");
const FEP_P1 = fixture("fep-blue-focus-p1.txt");
const FEP_P17 = fixture("fep-blue-focus-p17.txt");

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
  vi.resetAllMocks();
});

const SYNTHETIC_P2 = [
  "For Self Only contracts, the deductible is $1,000.",
  "For Self Plus One contracts, the deductible is $2,000.",
  "For Self and Family contracts, the deductible is $3,000.",
].join("\n");

async function run(pages: string[], values: unknown[]) {
  const { session, capability } = createSession(
    [{ documentId: "fep", filename: "fep.pdf", pageCount: pages.length, pages }],
    {},
  );
  created.push(session.sessionId);
  mockedFallback.mockReturnValue({
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "fep", filename: "fep.pdf", pageCount: pages.length }],
    rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values }],
  } as never);
  const res = await POST(
    new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}`,
      },
      body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
    }),
  );
  expect(res.status).toBe(200);
  const table = (await res.json()) as RegisteredComparisonTable;
  const planId = table.plans?.[0]?.planId;
  const view: ActiveView = { mode: "understand", documentId: "fep", planIds: planId ? [planId] : [], tiers: {} };
  return { table, planId, view, facts: indexFacts(table, view) };
}

const value = (page: number, display: string, quote: string, conditions?: string) => ({
  documentId: "fep",
  display,
  qualifiers: conditions ? { conditions } : {},
  evidence: [{ documentId: "fep", page, quote }],
});

describe("POST /api/extract — enrollment scope through Stage E and presentation", () => {
  it("recognizes FEP Blue Focus and carries each enrollment scope to the comparison facts", async () => {
    const { table, planId, view, facts } = await run([FEP_P1, SYNTHETIC_P2], [
      value(2, "$1,000", "For Self Only contracts, the deductible is $1,000.", "Self Only"),
      value(2, "$2,000", "For Self Plus One contracts, the deductible is $2,000.", "Self Plus One"),
      value(2, "$3,000", "For Self and Family contracts, the deductible is $3,000.", "Self and Family"),
    ]);
    expect(table.plans?.map((p) => p.name)).toEqual(["FEP® Blue Focus"]);
    expect(table.plans?.[0].sources[0]).toMatchObject({ documentId: "fep", page: 1, quote: "FEP® Blue Focus" });
    const values = table.rows[0].values;
    expect(values.map((v) => v.planId)).toEqual([planId, planId, planId]);
    expect(values.map((v) => v.qualifiers.conditions)).toEqual(["Self Only", "Self Plus One", "Self and Family"]);
    // Comparison output: each fact is plan-verified AND still scoped.
    expect(facts.map((f) => f.state)).toEqual(["verified-plan", "verified-plan", "verified-plan"]);
    expect(facts.map((f) => f.qualifiers.conditions)).toEqual(["Self Only", "Self Plus One", "Self and Family"]);
    const spec = buildPresentation(table, view, {});
    const shown = new Set(spec.blocks.flatMap((b) => b.factIds));
    for (const f of facts) expect(shown.has(f.id)).toBe(true);
  });

  it("never presents scope-less enrollment-specific values as verified plan facts", async () => {
    const { table, facts } = await run([FEP_P1, SYNTHETIC_P2], [
      value(2, "$1,000", "For Self Only contracts, the deductible is $1,000."),
      value(2, "$2,000", "For Self Plus One contracts, the deductible is $2,000."),
    ]);
    expect(table.rows[0].values.map((v) => v.planId)).toEqual([undefined, undefined]);
    expect(facts.map((f) => f.state)).toEqual(["unverified-applicability", "unverified-applicability"]);
  });

  it("on the real wrapped page 17, attributes the single-line Self Only value and abstains on the wrapped one", async () => {
    const pages = [FEP_P1, ...Array.from({ length: 15 }, (_, i) => `Filler page ${i + 2}`), FEP_P17];
    const { table, planId, facts } = await run(pages, [
      value(17, "$1,000", "For Self Only contracts, the calendar year deductible is now $1,000.", "Self Only"),
      value(17, "$2,000", "For Self Plus One, and Self and Family contracts, the deductible is now $2,000", "Self Plus One, and Self and Family"),
    ]);
    const [selfOnly, selfPlusOne] = table.rows[0].values;
    expect(selfOnly.planId).toBe(planId);
    expect(selfOnly.qualifiers.conditions).toBe("Self Only");
    // The canonical source span wraps across a line break, so the scope cannot be
    // re-proven downstream: the value stays unattributed instead of losing scope.
    expect(selfPlusOne.planId).toBeUndefined();
    expect(facts.map((f) => f.state)).toEqual(["verified-plan", "unverified-applicability"]);
    expect(facts[0].qualifiers.conditions).toBe("Self Only");
  });
});

// ---- Invariant C at route level: explicit (labelled) planId claims --------
import { attestPlans } from "@/app/lib/extraction/plan-identity";

describe("POST /api/extract — labelled explicit-planId values obey the enrollment gate", () => {
  const LABELLED_PAGE = [
    "Plan name: FEP® Blue Focus; annual-deductible: $2,000",
    "For Self Plus One, and Self and Family contracts, the deductible is now $2,000",
  ].join("\n");
  const pages = [FEP_P1, LABELLED_PAGE];
  const [plan] = attestPlans([{ documentId: "fep", filename: "fep.pdf", pages }]);

  async function runClaimed(conditions?: string) {
    const claimed = {
      documentId: "fep",
      planId: plan.planId,
      display: "$2,000",
      qualifiers: conditions ? { conditions } : {},
      evidence: [
        { documentId: "fep", page: 2, quote: "Plan name: FEP® Blue Focus; annual-deductible: $2,000" },
        { documentId: "fep", page: 2, quote: "For Self Plus One, and Self and Family contracts, the deductible is now $2,000" },
      ],
    };
    const { session, capability } = createSession(
      [{ documentId: "fep", filename: "fep.pdf", pageCount: 2, pages }],
      {},
    );
    created.push(session.sessionId);
    mockedFallback.mockReturnValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "fep", filename: "fep.pdf", pageCount: 2 }],
      plans: [plan],
      rows: [{ factName: "annual-deductible", verdict: "SUPPORTED", values: [claimed] }],
    } as never);
    const res = await POST(new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
      body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
    }));
    expect(res.status).toBe(200);
    const table = (await res.json()) as RegisteredComparisonTable;
    const view: ActiveView = { mode: "understand", documentId: "fep", planIds: [plan.planId], tiers: {} };
    return { table, facts: indexFacts(table, view), view };
  }

  it("missing conditions: not attributed and never verified-plan", async () => {
    const { table, facts } = await runClaimed();
    expect(table.rows[0].values[0].planId).toBeUndefined();
    expect(facts.map((f) => f.state)).toEqual(["unverified-applicability"]);
  });

  it("partial conditions: not attributed and never verified-plan", async () => {
    const { table, facts } = await runClaimed("Self Plus One");
    expect(table.rows[0].values[0].planId).toBeUndefined();
    expect(facts.map((f) => f.state)).toEqual(["unverified-applicability"]);
  });

  it("complete conditions: attributed, verified-plan, scope intact through presentation", async () => {
    const { table, facts, view } = await runClaimed("Self Plus One, and Self and Family");
    expect(table.rows[0].values[0].planId).toBe(plan.planId);
    expect(facts.map((f) => f.state)).toEqual(["verified-plan"]);
    expect(facts[0].qualifiers.conditions).toBe("Self Plus One, and Self and Family");
    const spec = buildPresentation(table, view, {});
    expect(spec.blocks.flatMap((b) => b.factIds)).toContain(facts[0].id);
  });
});
