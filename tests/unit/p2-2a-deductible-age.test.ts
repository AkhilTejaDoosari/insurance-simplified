// P2.2-A regressions: FEP calendar-year deductible detection and the
// page-number-as-age misclassification. Passages are the exact extracted text
// of FEP Blue Focus (tests/fixtures/fep-pages/fep-blue-focus-p17.txt and the
// single lines below, verbatim from PDF p4, p11, p29 and p36). The real
// deterministic engine, attestation, citation verification and Stage E run
// unmocked; no LLM or network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { extractFallback } from "@/app/lib/extraction/extract";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { POST } from "@/app/api/extract/route";
import { indexFacts, type ActiveView } from "@/app/lib/presentation/adaptive";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests/fixtures/fep-pages", name), "utf8");
const FEP_P1 = fixture("fep-blue-focus-p1.txt");
const FEP_P17 = fixture("fep-blue-focus-p17.txt");
const HEALTH_P1 = fixture("health-guide-p1.txt");

// Verbatim FEP lines.
const P36_DEDUCTIBLE =
  "• The calendar year deductibles: $1,000 per person ($2,000 per Self Plus One or Self and Family enrollment).";
const P29_DEFINITION =
  "Adeductible is a fixed amount of covered expenses you must incur for certain covered services and";
const P11_TOC = "• Changes for 2027: Page 15\n• Summary of Benefits: Page 131";
const HEALTH_P12_DEFINITION =
  "Deductible: A dollar amount that you must pay each year before your plan will provide coverage.";

const ENROLLMENT = ["Self Only", "Self Plus One", "Self and Family"];

const ageLimit = FACTS.find((f) => f.name === "age-limits")!;
const isAgeLimit = (line: string) => ageLimit.patterns.some((p) => new RegExp(p, "i").test(line));

const doc = (documentId: string, pages: string[]) => ({
  documentId,
  filename: `${documentId}.pdf`,
  pageCount: pages.length,
  pages,
});
const row = (table: ReturnType<typeof extractFallback>, name: string) =>
  table.rows.find((r) => r.factName === name)!;

describe("age-limits pattern token boundaries", () => {
  it.each([
    ["FEP p17 'see page 27'", "deductible is now $2,000 (see page 27)."],
    ["FEP p17 'see page 127' variant", "Plan allowance (up to a maximum of $1,700) for 31 to 90-day supply (see page 127)."],
    ["FEP p11 TOC 'Page 15'", "• Changes for 2027: Page 15"],
    ["FEP p11 TOC 'Page 131'", "• Summary of Benefits: Page 131"],
  ])("does not read a page reference as an age: %s", (_label, line) => {
    expect(isAgeLimit(line)).toBe(false);
  });

  it.each([
    "Coverage ends at age 27.",
    "Your child age 26 or over",
    "children under age 26",
    "dependents under 19",
    "members over 65",
    "Age 65 and older",
  ])("still matches a legitimate age statement: %s", (line) => {
    expect(isAgeLimit(line)).toBe(true);
  });

  it("preserves existing behavior for 'aged 27' (never matched)", () => {
    expect(isAgeLimit("Applicants aged 27")).toBe(false);
  });
});

describe("FEP calendar-year deductible detection (fallback engine)", () => {
  const docs = [doc("fep", [FEP_P1, FEP_P17, P36_DEDUCTIBLE, P29_DEFINITION, P11_TOC])];
  const table = extractFallback(docs, {});

  it("extracts the p17 $1,000 deductible under annual-deductible with verified evidence", () => {
    const values = row(table, "annual-deductible").values.filter((v) => v.evidence.some((e) => e.page === 2));
    const hit = values.find((v) => v.display.includes("$1,000"));
    expect(hit, JSON.stringify(values)).toBeDefined();
    expect(hit!.display).toContain("calendar year deductible is now $1,000");
    for (const e of hit!.evidence) {
      const verified = verifyEvidenceCitation(docs, e);
      expect(verified.ok).toBe(true);
      expect(verified.ok && verified.quote).toContain("$1,000");
    }
  });

  it("extracts the p36 line with both amounts and their enrollment wording intact", () => {
    const hit = row(table, "annual-deductible").values.find((v) => v.evidence.some((e) => e.page === 3));
    expect(hit).toBeDefined();
    expect(hit!.display).toContain("$1,000 per person");
    expect(hit!.display).toContain("$2,000 per Self Plus One or Self and Family enrollment");
    expect(hit!.evidence.every((e) => verifyEvidenceCitation(docs, e).ok)).toBe(true);
  });

  it("does not file the p17 '$2,000 (see page 27)' continuation, or TOC page refs, as age limits", () => {
    const ages = row(table, "age-limits").values;
    expect(ages.filter((v) => /page\s+\d+/i.test(v.display))).toEqual([]);
  });

  it("does not read the p29 worked-example amount ($80) as the deductible", () => {
    const example = "have not paid any amount toward meeting your calendar year deductible, you must pay $80. We will";
    const t = extractFallback([doc("fep", [example])], {});
    expect(row(t, "annual-deductible").values).toEqual([]);
  });

  it.each([
    ["p17", "• For Self Only contracts, the calendar year deductible is now $1,000. For Self Plus One, and Self and Family contracts, the"],
    ["p29", "The calendar year deductible is $1,000 per person.After the deductible amount is satisfied for an"],
    ["p36", P36_DEDUCTIBLE],
    ["p55", "• The calendar year deductible is: $1,000 per person ($2,000 per Self Plus One or Self and Family"],
  ])("matches the verbatim FEP %s deductible statement", (_page, line) => {
    const t = extractFallback([doc("fep", [line])], {});
    expect(row(t, "annual-deductible").values.map((v) => v.display)).toEqual([line]);
  });

  it("does not turn the p29 deductible definition into a deductible value", () => {
    const def = row(table, "annual-deductible").values.filter((v) => v.evidence.some((e) => e.page === 4));
    expect(def).toEqual([]);
  });
});

describe("route: no incomplete enrollment scope or definition becomes verified-plan", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const id of created.splice(0)) deleteSession(id);
  });

  async function run(documentId: string, pages: string[]) {
    const { session, capability } = createSession([doc(documentId, pages)], {});
    created.push(session.sessionId);
    const res = await POST(new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
      body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
    }));
    expect(res.status).toBe(200);
    return (await res.json()) as RegisteredComparisonTable;
  }

  it("FEP deductible values naming enrollment categories stay unattributed unless conditions preserve them", async () => {
    const table = await run("fep", [FEP_P1, FEP_P17, P36_DEDUCTIBLE, P29_DEFINITION, P11_TOC]);
    expect(table.plans?.map((p) => p.name)).toEqual(["FEP® Blue Focus"]);
    const deductibles = table.rows.find((r) => r.factName === "annual-deductible")!.values;
    expect(deductibles.some((v) => v.display.includes("$1,000"))).toBe(true);
    const view: ActiveView = { mode: "understand", documentId: "fep", planIds: [table.plans![0].planId], tiers: {} };
    for (const fact of indexFacts(table, view)) {
      if (fact.state !== "verified-plan") continue;
      const quotes = fact.value.evidence.map((e) => e.quote).join(" ").replace(/\s+/g, " ");
      for (const c of ENROLLMENT.filter((name) => quotes.includes(name))) {
        expect(fact.value.qualifiers.conditions ?? "", `${fact.concept}: ${fact.value.display}`).toContain(c);
      }
    }
    expect(table.rows.find((r) => r.factName === "age-limits")!.values.filter((v) => /page\s+\d+/i.test(v.display))).toEqual([]);
  });

  it("an educational deductible definition acquires no plan attribution", async () => {
    const table = await run("health", [HEALTH_P1, HEALTH_P12_DEFINITION]);
    expect(table.plans ?? []).toEqual([]);
    expect(table.rows.flatMap((r) => r.values).filter((v) => v.planId)).toEqual([]);
  });
});
