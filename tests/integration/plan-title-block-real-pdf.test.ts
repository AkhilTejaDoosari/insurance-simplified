import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { attestPlans } from "@/app/lib/extraction/plan-identity";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";
import { POST } from "@/app/api/extract/route";
import { indexFacts, type ActiveView } from "@/app/lib/presentation/adaptive";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

// P2.1 real-document checks. Run only when REAL_PDFS_DIR contains the three
// held-out PDFs; otherwise SKIPPED (never reported as a pass). The route
// check uses the deterministic fallback engine only — no LLM, no network.
const DIR = process.env.REAL_PDFS_DIR ?? "";
const FILES = {
  fep: "FEP-Blue-Focus-Brochure-2027-10-23.pdf",
  fema: "fema-nfip-protect-the-life-youve-built-brochure-09-2022.pdf",
  health: "Health Insurance Brochure DIGITAL.pdf",
};
const enabled = DIR !== "" && Object.values(FILES).every((f) => existsSync(join(DIR, f)));

async function pagesOf(filename: string): Promise<string[]> {
  const buf = readFileSync(join(DIR, filename));
  const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return (await extractPages(bytes, filename)).pages;
}

describe.runIf(enabled)("P2.1 title-block recognition on the real PDFs", () => {
  it("attests FEP Blue Focus and nothing for FEMA or the education guide", async () => {
    const doc = async (documentId: string, f: string) => ({ documentId, filename: f, pages: await pagesOf(f) });
    const fep = attestPlans([await doc("fep", FILES.fep)]);
    expect(fep.map((p) => p.name)).toEqual(["FEP® Blue Focus"]);
    expect(fep[0].sources).toEqual([{ documentId: "fep", page: 1, quote: "FEP® Blue Focus" }]);
    expect(attestPlans([await doc("fema", FILES.fema)])).toEqual([]);
    expect(attestPlans([await doc("health", FILES.health)])).toEqual([]);
  });

  it("full-document FEP deterministic extraction through the real route never attributes incomplete enrollment scope", async () => {
    const pages = await pagesOf(FILES.fep);
    // The held-out FEP brochure is 140 pages (docs/UNSEEN_DOCUMENT_GENERALIZATION.md §8);
    // extractPages keeps one entry per original page (mergePages: false).
    expect(pages).toHaveLength(140);
    const { session, capability } = createSession(
      [{ documentId: "fep", filename: FILES.fep, pageCount: pages.length, pages }],
      {},
    );
    try {
      const res = await POST(new NextRequest("http://localhost/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
        body: JSON.stringify({ sessionId: session.sessionId, engine: "fallback" }),
      }));
      const body = await res.json();
      // Recorded for the report; assertions below are the safety invariants.
      console.log("FEP-FULL status", res.status, JSON.stringify(res.status === 200
        ? { plans: body.plans?.map((p: { name: string }) => p.name), rows: body.rows.length,
            values: body.rows.reduce((n: number, r: { values: unknown[] }) => n + r.values.length, 0),
            attributed: body.rows.flatMap((r: { factName: string; values: { planId?: string; display: string; qualifiers: { conditions?: string } }[] }) =>
              r.values.filter((v) => v.planId).map((v) => `${r.factName}: ${v.display.slice(0, 60)} [conditions=${v.qualifiers.conditions ?? "-"}]`)) }
        : body));
      expect(res.status).toBe(200);
      const table = body as RegisteredComparisonTable;
      expect(table.documents.map((d) => d.pageCount)).toEqual([140]);
      expect(table.plans?.map((p) => p.name)).toEqual(["FEP® Blue Focus"]);
      const planId = table.plans![0].planId;
      const view: ActiveView = { mode: "understand", documentId: "fep", planIds: [planId], tiers: {} };
      const categories = ["Self Only", "Self Plus One", "Self and Family"];
      for (const fact of indexFacts(table, view)) {
        if (fact.state !== "verified-plan") continue;
        const named = categories.filter((c) =>
          new RegExp(`(?:^|[^a-z0-9])${c.replace(/ /g, "\\s+")}(?:$|[^a-z0-9])`, "i").test(
            fact.value.evidence.map((e) => e.quote).join(" ").replace(/\s+/g, " "))
          && fact.value.display.match(/\d/));
        // A verified-plan fact whose own evidence names an enrollment category
        // must carry that category in its supported conditions.
        for (const c of named) {
          const sentences = fact.value.evidence.map((e) => e.quote).join(" ").replace(/\s+/g, " ").split(/[.;!?]\s+/);
          const figure = fact.value.display.match(/\$\s?[\d,]+/)?.[0];
          const tied = !figure || sentences.some((s) => s.includes(figure) && new RegExp(c, "i").test(s));
          if (tied) expect(fact.qualifiers.conditions ?? "", `${fact.concept} ${fact.value.display}`).toMatch(new RegExp(c, "i"));
        }
      }
    } finally {
      deleteSession(session.sessionId);
    }
  }, 120_000);
});
