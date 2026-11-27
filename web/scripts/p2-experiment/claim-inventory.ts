// Inventory of ACTUAL verified-plan claims emitted by the tree this script
// runs in: every plan-attributed value of the six-document corpus, with its
// scope, evidence and final presentation state. Used to diff two trees
// (claim-diff.ts) — never the label inventory.
//
// Usage: REAL_PDFS_DIR=... npx tsx scripts/p2-experiment/claim-inventory.ts <out.json>
// Fails (exit 2) unless ALL corpus documents are present: no partial corpus.
// Output contains short licensed-PDF quotes: write it outside the repo or
// under test-results/ (gitignored) only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { indexFacts } from "@/app/lib/presentation/adaptive";
import { realFixture } from "./real-fixtures";
import type { GroundTruthRealModule } from "./fixture-types";

const { CORPUS } = realFixture<GroundTruthRealModule>("ground-truth-real");

export interface InventoryClaim {
  key: string;
  documentId: string;
  fact: string;
  planId: string;
  scope: string;
  display: string;
  evidence: { page: number; quote: string }[];
  anchor?: string;
  /** Presentation states this value is shown in (understand mode, its plan). */
  states: string[];
}

export const claimKey = (documentId: string, fact: string, scope: string, display: string) => `${documentId}|${fact}|${scope}|${display}`;

(async () => {
  const out = process.argv[2];
  if (!out) { console.error("usage: claim-inventory.ts <out.json>"); process.exit(1); }
  const realDir = process.env.REAL_PDFS_DIR ?? "";
  const missing = CORPUS.map((m) => (m.location === "repo" ? m.file : join(realDir, m.file))).filter((p) => !existsSync(p));
  if (missing.length) { console.error(`INCOMPLETE CORPUS (${missing.length} missing): ${missing.map((p) => basename(p)).join(", ")}`); process.exit(2); }

  const claims: InventoryClaim[] = [];
  for (const session of [...new Set(CORPUS.map((c) => c.session))]) {
    const docs = [];
    for (const m of CORPUS.filter((c) => c.session === session)) {
      const p = m.location === "repo" ? m.file : join(realDir, m.file);
      docs.push({ documentId: m.documentId, filename: basename(p), ...(await extractPages(new Uint8Array(readFileSync(p)), basename(p))) });
    }
    const t = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
    const reg = { ...t, rows: t.rows.map((r) => ({ ...r, values: r.values.map((v) => ({ ...v, evidence: v.evidence.map((e, i) => ({ ...e, evidenceId: `ev-${i}` })) })) })) } as RegisteredComparisonTable;
    const states = new Map<string, Set<string>>();
    for (const plan of t.plans ?? []) {
      const documentId = plan.sources[0].documentId;
      for (const f of indexFacts(reg, { mode: "understand", documentId, planIds: [plan.planId], tiers: {} })) {
        if (!f.value.planId) continue;
        const k = `${f.value.documentId}|${f.value.display}`;
        (states.get(k) ?? states.set(k, new Set()).get(k)!).add(f.state);
      }
    }
    for (const row of t.rows) for (const v of row.values) if (v.planId) {
      const q = v.qualifiers ?? {};
      const scope = (["planTier", "networkTier", "conditions"] as const).filter((k) => q[k] !== undefined).map((k) => `${k}=${q[k]}`).join(" | ");
      claims.push({
        key: claimKey(v.documentId, row.factName, scope, v.display),
        documentId: v.documentId, fact: row.factName, planId: v.planId, scope, display: v.display,
        evidence: v.evidence.map((e) => ({ page: e.page, quote: e.quote })),
        ...(v.anchor ? { anchor: v.anchor.kind } : {}),
        states: [...(states.get(`${v.documentId}|${v.display}`) ?? [])].sort(),
      });
    }
  }
  writeFileSync(out, JSON.stringify(claims, null, 1));
  console.log(`${claims.length} verified-plan claims -> ${out}`);
})();
