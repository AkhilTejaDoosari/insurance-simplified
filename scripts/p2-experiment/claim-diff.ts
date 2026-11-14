// Claim-level diff between the ACTUAL emissions of two trees (inventories from
// claim-inventory.ts), not between the label inventory and one tree.
//
// Usage: npx tsx scripts/p2-experiment/claim-diff.ts <before.json> <after.json> [--list]
// A claim whose cell (first display line), document, fact and scope are
// unchanged but whose governing notes changed is reported as SUPERSEDED,
// never as both lost and new.
import { readFileSync } from "node:fs";
import type { InventoryClaim } from "./claim-inventory";
import { CLAIM_LABELS } from "./claim-labels";

const [beforePath, afterPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!beforePath || !afterPath) { console.error("usage: claim-diff.ts <before.json> <after.json> [--list]"); process.exit(1); }
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as InventoryClaim[];
const before = load(beforePath);
const after = load(afterPath);
const keys = (cs: InventoryClaim[]) => new Set(cs.map((c) => c.key));
const head = (c: InventoryClaim) => `${c.documentId}|${c.fact}|${c.scope}|${c.display.split("\n")[0]}`;
const b = keys(before);
const a = keys(after);
const afterHeads = new Map(after.map((c) => [head(c), c]));
const beforeHeads = new Set(before.map(head));

const kept = before.filter((c) => a.has(c.key));
const superseded = before.filter((c) => !a.has(c.key) && afterHeads.has(head(c)));
const lost = before.filter((c) => !a.has(c.key) && !afterHeads.has(head(c)));
const added = after.filter((c) => !b.has(c.key) && !beforeHeads.has(head(c)));
const stateOf = (c: InventoryClaim) => c.states.join("+") || "not-presented";
const tally = (cs: InventoryClaim[]) => cs.reduce<Record<string, number>>((t, c) => ((t[stateOf(c)] = (t[stateOf(c)] ?? 0) + 1), t), {});

console.log(`before ${before.length}  after ${after.length}  kept ${kept.length}  superseded ${superseded.length}  lost ${lost.length}  new ${added.length}`);
console.log(`presentation before ${JSON.stringify(tally(before))}`);
console.log(`presentation after  ${JSON.stringify(tally(after))}`);
const verdicts = (cs: InventoryClaim[]) => cs.reduce<Record<string, number>>((t, c) => {
  const v = CLAIM_LABELS[c.key]?.verdict ?? "UNLABELLED";
  t[v] = (t[v] ?? 0) + 1;
  if (CLAIM_LABELS[c.key]?.pending) t["(pending adjudication)"] = (t["(pending adjudication)"] ?? 0) + 1;
  return t;
}, {});
console.log(`labels before ${JSON.stringify(verdicts(before))}`);
console.log(`labels after  ${JSON.stringify(verdicts(after))}`);
const changedState = kept.filter((c) => stateOf(c) !== stateOf(after.find((x) => x.key === c.key)!));
console.log(`kept claims whose presentation state changed: ${changedState.length}`);
if (process.argv.includes("--list")) {
  for (const c of superseded) console.log(`SUPERSEDED ${head(c).slice(0, 160)}  (+${afterHeads.get(head(c))!.display.split("\n").length - c.display.split("\n").length} note lines)`);
  for (const c of lost) console.log(`LOST       ${c.key.slice(0, 200)}`);
  for (const c of added) console.log(`NEW        ${c.key.slice(0, 200)}`);
  for (const c of changedState) console.log(`STATE      ${stateOf(c)} -> ${stateOf(after.find((x) => x.key === c.key)!)}  ${c.key.slice(0, 150)}`);
}
