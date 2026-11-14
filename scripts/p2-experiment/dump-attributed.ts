// Dump every plan-attributed value (the trust-critical "verified plan claims")
// for manual adjudication. Offline, deterministic. Output contains short
// licensed-PDF quotes: write it under test-results/ (gitignored) only.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { runBaselineFunnel } from "./run-p2-eval";
import { CORPUS } from "./ground-truth-real";

async function main() {
  const realDir = process.env.REAL_PDFS_DIR ?? "";
  const out: unknown[] = [];
  for (const session of [...new Set(CORPUS.map((c) => c.session))]) {
    const members = CORPUS.filter((c) => c.session === session);
    const docs = [];
    for (const m of members) {
      const p = m.location === "repo" ? m.file : join(realDir, m.file);
      if (!existsSync(p)) { console.error("SKIP", m.key); continue; }
      const buf = readFileSync(p);
      const { pageCount, pages, tables } = await extractPages(new Uint8Array(buf), basename(p));
      docs.push({ documentId: m.documentId, filename: basename(p), pageCount, pages, tables });
    }
    if (docs.length !== members.length) continue;
    for (const row of await runBaselineFunnel(docs)) for (const v of row.values) if (v.planId)
      out.push({ session, row: row.factName, doc: v.documentId, planId: v.planId, display: v.display, qualifiers: v.qualifiers, evidence: v.evidence.map((e) => ({ page: e.page, quote: e.quote })) });
  }
  const path = process.argv[2] ?? "test-results/attributed.json";
  writeFileSync(path, JSON.stringify(out, null, 1));
  console.log(`${out.length} attributed values -> ${path}`);
}
main();
