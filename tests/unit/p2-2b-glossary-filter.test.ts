// P2.2-B regressions (repositioned): glossary definitions and table-of-
// contents/index entries are removed from the FINAL displayed output after
// Stage E attribution, while exclusion headers and amount-bearing lines are
// preserved. Lines are verbatim from the extracted text of FEP Blue Focus
// (p4, p17, p36, p46), IMG Patriot Exchange (p2, p3, p27, p31) and the
// health-education guide (p12). Real route, deterministic fallback engine
// only; no LLM or network.
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { POST } from "@/app/api/extract/route";
import { isGlossaryDefinitionLine, isTocEntryLine } from "@/app/lib/extraction/noise-shapes";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
});

async function displayed(lines: string[]) {
  const pages = [lines.join("\n")];
  const { session, capability } = createSession(
    [{ documentId: "d", filename: "d.pdf", pageCount: pages.length, pages }],
    {},
  );
  created.push(session.sessionId);
  const res = await POST(new NextRequest("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
    body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
  }));
  expect(res.status).toBe(200);
  const table = (await res.json()) as RegisteredComparisonTable;
  return table.rows.flatMap((r) => r.values.map((v) => ({
    fact: r.factName,
    quotes: v.evidence.map((e) => e.quote).join(" "),
  })));
}

describe("glossary definitions and TOC entries are not displayed", () => {
  it.each([
    ["health p12 glossary", "Deductible: A dollar amount that you must pay each year before your plan will provide coverage."],
    ["health p12 glossary", "Provider: A physician, nurse practitioner, clinical nurse specialist, or physician assistant, as allowed under state"],
    ["IMG p27 glossary", "Deductible: The dollar amount, as selected on the Application and specified in the Declaration, that the Insured Person"],
    ["IMG p31 glossary (gt-119 withhold)", "Rider: Any exhibit, schedule, attachment, amendment, endorsement, Rider or other document attached to, issued in"],
    ["FEP p4 TOC", "Your catastrophic protection out-of-pocket maximum for deductibles, coinsurance, and copayments ...........................29"],
    ["IMG p2 TOC", "H. Accidental Death and Dismemberment .............................................................................. 17"],
  ])("%s: no displayed value cites it", async (_label, line) => {
    const out = await displayed([line]);
    expect(out.filter((v) => v.quotes.includes(line.slice(0, 40)))).toEqual([]);
  });
});

describe("real facts are still displayed", () => {
  it.each([
    ["FEP p46 exclusion header (lowercase label, not a glossary term)", "Not covered: The services listed below are not covered as treatments for", "material-exclusions"],
    ["IMG p3 schedule row (gt-105)", "Out of Pocket Maximum $1,000 Up to the Maximum", "out-of-pocket-maximum"],
    ["FEP p36 deductible with enrollment wording", "• The calendar year deductibles: $1,000 per person ($2,000 per Self Plus One or Self and Family enrollment).", "annual-deductible"],
    ["FEP p17 amount with page reference", "and Family contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $22,000 (see page 29).", "out-of-pocket-maximum"],
    ["glossary-shaped line carrying an amount", "Deductible: A $500 amount applies per Period of Coverage", "annual-deductible"],
    ["schedule row with dot leader and amount", "Annual deductible ........................ $1,000", "annual-deductible"],
  ])("%s", async (_label, line, fact) => {
    const out = await displayed([line]);
    expect(out.some((v) => v.fact === fact)).toBe(true);
  });
});

describe("shape predicates", () => {
  it("does not treat a lowercase exclusion label as glossary", () => {
    expect(isGlossaryDefinitionLine("Not covered: The services listed below are not covered as treatments for")).toBe(false);
  });
  it("recognizes an index entry with a page range", () => {
    expect(isTocEntryLine("Cosmetic surgery..........................54-55, 121")).toBe(true);
    expect(isTocEntryLine("Chiropractic manipulative treatment...51-52")).toBe(true);
  });
  it("never treats an amount-bearing dot-leader row as TOC", () => {
    expect(isTocEntryLine("Annual deductible ........................ $1,000")).toBe(false);
  });
});
