// Independent completeness audit for table claims. Uses raw pdf.js lines (not
// the reader's row assignment): every unrotated label-column line between a
// table's first and last row must appear in some emitted row label; a missing
// line located between an emitted row and the next emitted row is reported
// against that row. Output contains licensed text: terminal only.
import { readFileSync } from "node:fs";
import { getDocumentProxy } from "unpdf";
import { extractPages } from "@/app/lib/pdf/extract-pages";
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
(async () => {
  for (const file of process.argv.slice(2)) {
    const bytes = new Uint8Array(readFileSync(file));
    const { tables } = await extractPages(bytes, "x");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    let issues = 0;
    for (const t of tables) {
      const items = ((await (await pdf.getPage(t.page)).getTextContent()).items as any[])
        .filter((i) => i.str?.trim() && Math.abs(i.transform[1]) < 1e-6 && Math.abs(i.transform[2]) < 1e-6);
      const labelLimit = t.columns[0].x0;
      const lines = new Map<number, string[]>();
      for (const it of items) if (it.transform[4] + it.width <= labelLimit + 4) {
        const y = Math.round(it.transform[5]); const k = [...lines.keys()].find((q) => Math.abs(q - y) <= 2) ?? y;
        (lines.get(k) ?? lines.set(k, []).get(k)!).push(it.str);
      }
      const labels = t.rows.map((r) => squash(r.label.text));
      // Value columns: every unrotated value-zone line inside the table must
      // be part of some emitted cell.
      const cells = t.rows.flatMap((r) => r.cells.map((c) => squash(c.text)));
      const vlines: { y: number; text: string }[] = [];
      for (const it of items) if (it.transform[4] >= labelLimit - 4 && it.transform[4] < t.columns[t.columns.length - 1].x1) vlines.push({ y: it.transform[5], text: squash(it.str) });
      const rowY = t.rows.map((r) => {
        const first = squash(r.label.text).split(" • ")[0].slice(0, 20);
        return [...lines.entries()].find(([, s]) => squash(s.join(" ")).startsWith(first))?.[0];
      });
      const top = Math.max(...rowY.filter((y): y is number => y !== undefined));
      const bottom = Math.min(...rowY.filter((y): y is number => y !== undefined));
      for (const [y, strs] of lines) {
        if (y > top || y < bottom - 40) continue;
        const text = squash(strs.join(" ").replace(/^•\s*/, ""));
        if (!text || labels.some((l) => l.includes(text))) continue;
        const owner = rowY.map((ry, k) => ({ ry, k })).filter((o) => o.ry !== undefined && o.ry >= y).sort((a, b) => a.ry! - b.ry!)[0];
        issues++;
        console.log(`p${t.page} UNACCOUNTED "${text.slice(0, 70)}" below row: ${owner ? labels[owner.k].slice(0, 50) : "-"}`);
      }
      for (const v of vlines) {
        if (v.y > top + 4 || v.y < bottom - 40 || cells.some((c) => c.includes(v.text))) continue;
        const owner = rowY.map((ry, k) => ({ ry, k })).filter((o) => o.ry !== undefined && o.ry >= v.y - 4).sort((a, b) => a.ry! - b.ry!)[0];
        issues++;
        console.log(`p${t.page} CELL-UNACCOUNTED "${v.text.slice(0, 60)}" near row: ${owner ? labels[owner.k].slice(0, 50) : "-"}`);
      }
    }
    console.log(`${file.split("/").pop()}: ${issues} unaccounted lines inside tables`);
  }
})();
