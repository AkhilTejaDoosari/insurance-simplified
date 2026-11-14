// Structured evidence binding — end-to-end through the real /api/extract
// route (attestation, citation verification, validateTable, attributePlanScope,
// resolveRowPlanIds) to the final presentation state, on all three ownership
// paths. Only the extraction engine is stubbed.
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

const TITLE = "Plan name: Acme Plan";
type Path = "mention" | "inferred" | "claimed";

/** Run one value through the route. `claimed` supplies the plan and the
 *  value's planId from the engine (the LLM-path shape); the other paths let
 *  the route attest the plan from page 1. */
async function run(
  path: Path,
  factName: string,
  quote: string | string[],
  display: string,
  qualifiers: Record<string, string> = {},
) {
  const quotes = Array.isArray(quote) ? quote : [quote];
  const pages = [TITLE, ...quotes];
  const { session, capability } = createSession(
    [{ documentId: "acme", filename: "acme.pdf", pageCount: pages.length, pages }],
    {},
  );
  created.push(session.sessionId);
  const claimed = path === "claimed";
  mockedFallback.mockReturnValue({
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "acme", filename: "acme.pdf", pageCount: pages.length }],
    ...(claimed ? { plans: [{ planId: "plan-acme", name: "Acme Plan", sources: [{ documentId: "acme", page: 1, quote: TITLE }] }] } : {}),
    rows: [{
      factName,
      verdict: "SUPPORTED",
      values: [{
        documentId: "acme", display, qualifiers,
        ...(claimed ? { planId: "plan-acme" } : {}),
        evidence: quotes.map((q, i) => ({ documentId: "acme", page: i + 2, quote: q })),
      }],
    }],
  } as never);
  const res = await POST(new NextRequest("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
    body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
  }));
  if (res.status !== 200) return { status: res.status, planId: undefined, value: undefined, state: undefined };
  const table = (await res.json()) as RegisteredComparisonTable;
  expect(table.plans?.map((p) => p.name)).toEqual(["Acme Plan"]);
  const planId = table.plans![0].planId;
  const value = table.rows.find((r) => r.factName === factName)?.values[0];
  const view: ActiveView = { mode: "understand", documentId: "acme", planIds: [planId], tiers: {} };
  const fact = indexFacts(table, view).find((f) => f.concept === factName);
  return { status: 200, planId, value, state: fact?.state };
}

const DEF = "the distribution of health-related services via electronic information";

/** The seven bypasses found by the probe, plus the reviewer's original and the
 *  "annual membership" case. `{P}` is where the plan name goes on the mention
 *  path; it is removed on the inferred path. */
const BYPASSES: [string, string, string, string][] = [
  ["original: fee after definition", "telehealth", `{P}. Telehealth: The ${DEF.slice(4)}. Administrative fee: $100.`, "$100"],
  ["em dash, same sentence", "telehealth", `{P} — Telehealth: The ${DEF.slice(4)}, administrative fee: $100.`, "$100"],
  ["lowercase definition", "telehealth", `{P}. telehealth: ${DEF}, administrative fee: $100.`, "$100"],
  ["means definition", "telehealth", `{P}. TELEHEALTH means ${DEF}, administrative fee $100.`, "$100"],
  ["is defined as", "telehealth", `{P}. Telehealth is defined as ${DEF}; administrative fee $100`, "$100"],
  ["dash definition", "telehealth", `{P}. Telehealth - The ${DEF.slice(4)}; Administrative fee: $100`, "$100"],
  ["fee in parentheses", "telehealth", `{P}: Telehealth: The ${DEF.slice(4)} (Administrative fee: $100).`, "$100"],
  ["unrelated field, same sentence", "telehealth", "{P}. Telehealth services are described in Section 4, administrative fee: $100.", "$100"],
  ["annual membership after telehealth", "telehealth", "{P}. Telehealth is offered through a partner and an annual membership costs $100.", "$100"],
  ["fee joined by and", "telehealth", "{P}. Telehealth services and the administrative fee $100.", "$100"],
  ["coinsurance definition + late fee", "coinsurance", "{P}. Coinsurance: the percentage of costs you share; late payment charge: 5%.", "5%"],
  ["deductible definition + enrollment fee", "annual-deductible", "{P}. Deductible means the amount you pay before the plan pays, enrollment fee $50.", "$50"],
  ["coinsurance figure in a deductible row", "annual-deductible", "{P}. Coinsurance: 80% after deductible.", "80%"],
  ["fee inside the telehealth label", "telehealth", "{P}. Telehealth administrative fee: $100.", "$100"],
  ["penalty inside the deductible label", "annual-deductible", "{P}. Deductible penalty: $50", "$50"],
];

const LEGIT: [string, string, string, string][] = [
  ["telehealth copay", "telehealth", "{P}. Telehealth: $0 copay per visit.", "$0"],
  ["coinsurance after deductible", "coinsurance", "{P}. Coinsurance: 80% after deductible.", "80%"],
  ["deductible per period", "annual-deductible", "{P}. Deductible: $500 per Period of Coverage.", "$500"],
];

const quoteFor = (path: Path, template: string) =>
  path === "mention" ? template.replace("{P}", "Acme Plan") : template.replace(/^\{P\}[.:]?\s*(?:—\s*)?/, "");

describe.each<Path>(["mention", "inferred"])("%s path", (path) => {
  it.each(BYPASSES)("bypass %s is not a verified-plan fact", async (_label, fact, template, display) => {
    const { status, value, state } = await run(path, fact, quoteFor(path, template), display);
    expect(status).toBe(200);
    expect(value?.planId).toBeUndefined();
    expect(state).not.toBe("verified-plan");
  });

  // Policy 2026-11-14: line values are never attributed by mention or by
  // document ownership (measured ~2/16 correct on real PDFs); they remain
  // displayed, cited document text. Table cells carry plan attribution.
  it.each(LEGIT)("well-formed %s line stays displayed but unattributed", async (_label, fact, template, display) => {
    const { status, value, state } = await run(path, fact, quoteFor(path, template), display);
    expect(status).toBe(200);
    expect(value?.display).toBe(display);
    expect(value?.planId).toBeUndefined();
    expect(state).not.toBe("verified-plan");
  });
});

describe("claimed path", () => {
  it.each([
    ["telehealth", "$0"],
    ["annual-deductible", "$500"],
    ["coinsurance", "80%"],
  ])("labelled %s line stays verified-plan", async (fact, display) => {
    const { planId, value, state } = await run("claimed", fact, `Plan name: Acme Plan; ${fact}: ${display}`, display);
    expect(value?.planId).toBe(planId);
    expect(state).toBe("verified-plan");
  });

  it.each(BYPASSES)("claimed planId on bypass %s never yields a verified-plan fact", async (_label, fact, template, display) => {
    const { status, value, state } = await run("claimed", fact, quoteFor("mention", template), display);
    // Schema validation rejects an unproven claim outright; if a future
    // change lets it through, Stage E must still abstain.
    if (status === 200) {
      expect(value?.planId).toBeUndefined();
      expect(state).not.toBe("verified-plan");
    } else {
      expect(status).toBe(500);
    }
  });
});

/** OpenCode contract corrections. Claimed inputs are the exact labelled line
 *  hasPlanValueProof accepts, so they pass validateTable and reach Stage E
 *  (asserted: status 200); the decision under test is Stage E's, not a 500. */
describe("contract corrections", () => {
  const CLAIMED_COPAY_CONTROL = "Plan name: Acme Plan; telehealth: $0 copay";

  it("claimed control reaches Stage E and is verified", async () => {
    const { status, planId, value, state } = await run("claimed", "telehealth", CLAIMED_COPAY_CONTROL, "$0 copay");
    expect(status).toBe(200);
    expect(value?.planId).toBe(planId);
    expect(state).toBe("verified-plan");
  });

  describe("1. an amount stated with exclusion wording is not an affirmative benefit", () => {
    it.each<[string, Path, string | string[], string]>([
      ["claimed, full display", "claimed", "Plan name: Acme Plan; telehealth: $50 copay, not covered", "$50 copay, not covered"],
      ["mention, full display", "mention", "Acme Plan. Telehealth: $50 copay, not covered", "$50 copay, not covered"],
      ["mention, amount only", "mention", "Acme Plan. Telehealth: $50 copay, not covered", "$50"],
      ["inferred, amount only", "inferred", "Telehealth: $50 copay, not covered", "$50"],
    ])("%s", async (_label, path, quote, display) => {
      const { status, value, state, planId } = await run(path, "telehealth", quote, display);
      expect(status).toBe(200);
      if (path === "claimed") {
        // A labelled record's display is the whole stated value: the exclusion
        // wording is part of what is shown, never dropped to a bare amount.
        expect(value?.display).toContain("not covered");
        expect(value?.planId).toBe(planId);
        return;
      }
      expect(value?.planId).toBeUndefined();
      expect(state).not.toBe("verified-plan");
    });
  });

  describe("2. another occurrence of the same amount cannot justify a different claim", () => {
    const QUOTE = "Telehealth: $100 copay; annual membership fee: $100";
    it.each<[Path, string | string[]]>([
      ["claimed", ["Plan name: Acme Plan; telehealth: $100 annual membership fee", QUOTE]],
      ["mention", `Acme Plan. ${QUOTE}`],
      ["inferred", QUOTE],
    ])("%s", async (path, quote) => {
      const { status, value, state, planId } = await run(path, "telehealth", quote, "$100 annual membership fee");
      expect(status).toBe(200);
      if (path === "claimed") {
        // The labelled record itself states this display verbatim for the
        // fact; it is shown as stated ("annual membership fee" visible).
        expect(value?.planId).toBe(planId);
        return;
      }
      expect(value?.planId).toBeUndefined();
      expect(state).not.toBe("verified-plan");
    });

    it.each<[Path, string]>([["mention", `Acme Plan. ${QUOTE}`], ["inferred", QUOTE]])(
      "%s: the copay line stays displayed but unattributed", async (path, quote) => {
        const { value } = await run(path, "telehealth", quote, "$100 copay");
        expect(value?.display).toBe("$100 copay");
        expect(value?.planId).toBeUndefined();
      });
  });

  describe("3. a material network restriction must be preserved in validated qualifiers", () => {
    const cases: [Path, string, string][] = [
      ["claimed", "Plan name: Acme Plan; telehealth: In-network $0 copay", "In-network $0 copay"],
      ["mention", "Acme Plan. Telehealth, In-network: $0 copay.", "$0"],
      ["inferred", "Telehealth, In-network: $0 copay.", "$0"],
    ];
    it.each(cases)("%s with qualifiers {}: never a bare-amount plan fact", async (path, quote, display) => {
      const { status, value, state, planId } = await run(path, "telehealth", quote, display, {});
      expect(status).toBe(200);
      if (path === "claimed") {
        // The record's display itself states "In-network".
        expect(value?.display).toContain("In-network");
        expect(value?.planId).toBe(planId);
        return;
      }
      expect(value?.planId).toBeUndefined();
      expect(state).not.toBe("verified-plan");
    });
    it.each(cases)("%s with networkTier In-network", async (path, quote, display) => {
      const { planId, value, state } = await run(path, "telehealth", quote, display, { networkTier: "In-network" });
      if (path === "claimed") {
        expect(value?.planId).toBe(planId);
        expect(value?.qualifiers.networkTier).toBe("In-network");
        expect(state).toBe("verified-plan");
        return;
      }
      expect(value?.planId).toBeUndefined();
    });
    it.each(cases)("%s with the wrong networkTier abstains", async (path, quote, display) => {
      const { status, value, state } = await run(path, "telehealth", quote.replace("In-network", "In-network or Out-of-network"), display.replace("In-network", "In-network or Out-of-network"), { networkTier: "Out-of-network" });
      expect(status).toBe(200);
      expect(value?.planId).toBeUndefined();
      expect(state).not.toBe("verified-plan");
    });
  });
});
