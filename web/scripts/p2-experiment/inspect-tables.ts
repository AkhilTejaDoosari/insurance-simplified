// Inspect header-anchored tables the layout reader detects in a PDF.
// Usage: npx tsx scripts/p2-experiment/inspect-tables.ts <file.pdf> [pages,comma,separated]
// Prints licensed PDF text to the terminal only; never commit its output.
import { readFileSync } from "node:fs";
import { getDocumentProxy } from "unpdf";
import { detectTables, positionItems } from "@/app/lib/pdf/layout-tables";
(async () => {
  const [file, pages] = process.argv.slice(2);
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const wanted = pages ? pages.split(",").map(Number) : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  for (const p of wanted) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const { text, items } = positionItems(tc.items as any);
    for (const t of detectTables(text, items, p)) {
      console.log(`\n### page ${p} columns: ${t.columns.map((c) => `[${c.text}]`).join(" ")}`);
      if (t.preamble) console.log(`  preamble: ${t.preamble.text.slice(0, 120)}`);
      for (const r of t.rows) console.log(`  ${r.section ? `[${r.section.text.slice(0, 24)}] ` : ""}${r.label.text.slice(0, 50).padEnd(50)} | ` + r.cells.map((c) => `{${c.columns.join(",")}} ${c.text.slice(0, 60)}`).join(" || "));
      for (const f of t.footnotes ?? []) console.log(`  footnote ${f.marker} complete=${f.complete}: ${f.text.slice(0, 140)}`);
      console.log(`  withheld spans: ${(t.withheld ?? []).length}`);
    }
  }
})();
