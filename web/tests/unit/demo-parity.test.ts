/**
 * /demo must behave like the owner-approved demo (D-038). This runs the demo's own
 * script (docs/v2/demo/template.html) in a VM with the same bundle and compares its
 * results with the React port's logic, for many plan selections and needs settings.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { loadDemoBundle } from "@/app/demo/lib/demo-adapter";
import { demoChat, type ChatReply } from "@/app/demo/lib/demo-chat";
import { demoModel, initialNeeds, type NeedState } from "@/app/demo/lib/demo-logic";
import pdfs from "@/app/demo/data/demo-pdfs.json";

const B = loadDemoBundle();
const M = demoModel(B);
const chat = demoChat(M);

interface Original {
  score: (id: string, ids: string[]) => { p: number; unk: number; miss: string[]; li: string[] };
  stats: (doc: string) => { n: number; u: number; k: number };
  contacts: (ids: string[]) => string;
  capacity: () => number;
  QS: [string, (ids: string[]) => [string, string, [string, string]?]][];
  NEEDS: { th: number | null; must: boolean; on: boolean }[];
  setWidth: (w: number) => void;
}

function loadOriginal(): Original {
  const html = readFileSync(path.resolve(__dirname, "../../../docs/v2/demo/template.html"), "utf8");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const stub = { clientWidth: 1440, innerHTML: "", textContent: "", style: { setProperty() {} }, classList: { add() {}, remove() {} } };
  const win = { innerWidth: 1440, addEventListener() {}, scrollTo() {} };
  const ctx = vm.createContext({
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    Blob: class {},
    URL: { createObjectURL: () => "blob:x" },
    Uint8Array,
    document: { querySelector: () => stub, addEventListener() {}, documentElement: stub },
    window: win,
    setTimeout,
    clearInterval,
    setInterval: () => 0,
  });
  const src = script.replace("__BUNDLE__", JSON.stringify({ data: B, pdfs }));
  return vm.runInContext(
    `${src}\n;({score,stats,contacts,capacity,QS,NEEDS,setWidth:w=>{window.innerWidth=w;document.querySelector().clientWidth=w}})`,
    ctx,
  ) as Original;
}
const O = loadOriginal();

const glyph = { met: "✓", missed: "✗", unknown: "?", basis: "↔" } as const;
const toText = (r: ChatReply) =>
  r.lines.map((l) => l.map((s) => ("src" in s ? s.label : s.text)).join("")).join("\n");
const stripHtml = (h: string) =>
  h
    .replace(/<br>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');

const ALL = Object.keys(B.PLANS);
const subsets: string[][] = [];
for (let mask = 1; mask < 1 << ALL.length; mask++) subsets.push(ALL.filter((_, i) => mask & (1 << i)));

const needVariants: NeedState[][] = [
  initialNeeds(),
  initialNeeds().map((n, i) => ({ ...n, must: i % 2 == 0 ? !n.must : n.must })),
  initialNeeds().map((n, i) => ({ ...n, on: i != 1, th: n.th == null ? null : n.th * 2 })),
  initialNeeds().map((n) => ({ ...n, th: n.th == null ? null : 0 })),
];

describe("/demo parity with the approved demo script", () => {
  it("scores and breakdowns match for every plan selection and needs setting", () => {
    let checked = 0;
    for (const needs of needVariants) {
      needs.forEach((n, i) => Object.assign(O.NEEDS[i], n));
      for (const ids of subsets)
        for (const id of ids) {
          const mine = M.score(id, ids, needs);
          expect({ ...mine, li: mine.li.map((l) => `${glyph[l.mark]} ${l.text}`) }).toEqual(
            JSON.parse(JSON.stringify(O.score(id, ids))),
          );
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(700);
  });

  it("reading stats match for every document", () => {
    for (const d of B.DOCS) expect(M.readingStats(d.id)).toEqual(JSON.parse(JSON.stringify(O.stats(d.id))));
  });

  it("email drafts and question counts match", () => {
    initialNeeds().forEach((n, i) => Object.assign(O.NEEDS[i], n));
    for (const ids of subsets) {
      const html = O.contacts(ids);
      const hrefs = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => m[1]);
      const mine = M.contactCards(ids).flatMap((c) => [c.questionsHref, c.requestHref].filter(Boolean));
      expect(mine).toEqual(hrefs);
      const counts = [...html.matchAll(/Email my (\d+) open questions/g)].map((m) => +m[1]);
      expect(M.contactCards(ids).filter((c) => c.email).map((c) => c.questions.length)).toEqual(counts);
    }
  });

  it("plan-column capacity matches the demo's rule", () => {
    for (const w of [320, 339, 340, 390, 699, 700, 770, 1000, 1440, 2000]) {
      O.setWidth(w); // no #mainArea in the VM, so the demo falls back to window.innerWidth
      expect(M.capacity(w)).toBe(O.capacity());
    }
  });

  it("suggested chat answers match", () => {
    for (const ids of subsets)
      O.QS.forEach((q, i) => {
        const [tag, html, see] = q[1](ids);
        const mine = chat.ask(i, ids);
        expect(mine.tag).toBe(tag);
        expect(toText(mine).replace(/ +\n/g, "\n").trim()).toBe(stripHtml(html).replace(/ +\n/g, "\n").trim());
        // The demo shows a broken "See the page" link when no plan has a verified max; the port omits it.
        if (see && see[0] !== undefined) expect(mine.see).toEqual(see);
      });
  });
});
