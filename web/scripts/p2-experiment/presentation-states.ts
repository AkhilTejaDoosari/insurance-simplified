// Presentation-state breakdown of attributed values (what users see):
// verified-plan / needs-verification / conflicting-evidence, per document,
// through indexFacts in understand mode for each verified plan.
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { indexFacts } from "@/app/lib/presentation/adaptive";
import { realFixture } from "./real-fixtures";
import type { GroundTruthRealModule } from "./fixture-types";

const { CORPUS } = realFixture<GroundTruthRealModule>("ground-truth-real");
(async () => {
  const realDir = process.env.REAL_PDFS_DIR ?? "";
  const tally: Record<string, number> = {};
  const nv: string[] = [];
  for (const session of [...new Set(CORPUS.map((c) => c.session))]) {
    const docs = [];
    for (const m of CORPUS.filter((c) => c.session === session)) {
      const p = m.location === "repo" ? m.file : join(realDir, m.file);
      if (existsSync(p)) docs.push({ documentId: m.documentId, filename: basename(p), ...(await extractPages(new Uint8Array(readFileSync(p)), basename(p))) });
    }
    const t = verifyComparisonTable(validateTable(extractFallback(docs, {})), docs);
    const reg = { ...t, rows: t.rows.map((r) => ({ ...r, values: r.values.map((v) => ({ ...v, evidence: v.evidence.map((e, i) => ({ ...e, evidenceId: `ev-${i}` })) })) })) } as RegisteredComparisonTable;
    for (const plan of t.plans ?? []) {
      const documentId = plan.sources[0].documentId;
      for (const f of indexFacts(reg, { mode: "understand", documentId, planIds: [plan.planId], tiers: {} })) {
        if (!f.value.planId) continue;
        tally[f.state] = (tally[f.state] ?? 0) + 1;
        if (f.state !== "verified-plan") nv.push(`${f.state} ${documentId} ${f.concept}: ${f.value.display.slice(0, 90)}`);
      }
    }
  }
  console.log(JSON.stringify(tally));
  if (process.argv.includes("--list")) for (const l of nv) console.log(l);
})();
