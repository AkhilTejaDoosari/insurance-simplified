// Score an inventory of ACTUAL verified claims (claim-inventory.ts) against
// the hand-written gold provisions (gold-provisions.ts), on seven dimensions:
//   concept · value · scope (tier/network) · restrictions complete ·
//   polarity/applicability · evidence complete · presentation state.
// A claim is FULLY CORRECT only when all seven hold; a matching amount alone
// is never enough.
//
// Usage: npx tsx scripts/p2-experiment/provision-score.ts <inventory.json> [--list]
import { readFileSync } from "node:fs";
import type { InventoryClaim } from "./claim-inventory";
import { realFixture } from "./real-fixtures";
import type { GoldProvision, GoldProvisionsModule } from "./fixture-types";

const { GOLD, WITHHELD_DOCUMENTS } = realFixture<GoldProvisionsModule>("gold-provisions");

const n = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const NEGATION = /\b(?:no|not|none|excluded|exclusion)\b/i;
const scopeString = (g: GoldProvision) =>
  (["planTier", "networkTier", "conditions"] as const).filter((k) => g.scope[k] !== undefined).map((k) => `${k}=${g.scope[k]}`).join(" | ");

type Dim = "concept" | "value" | "scope" | "restrictions" | "polarity" | "evidence" | "presentation";
const DIMS: Dim[] = ["concept", "value", "scope", "restrictions", "polarity", "evidence", "presentation"];

function grade(g: GoldProvision, claims: InventoryClaim[]) {
  const sameRow = claims.filter((c) => c.documentId === g.documentId && c.display.split("\n")[0].startsWith(g.label));
  const exact = sameRow.filter((c) => c.fact === g.fact && c.scope === scopeString(g));
  if (exact.length === 0) {
    // Same provision under another fact or scope is wrongly attributed.
    const wrong = sameRow.filter((c) => c.scope === scopeString(g) && c.fact !== g.fact && !GOLD.some((o) => o.fact === c.fact && o.label === g.label));
    return { status: wrong.length ? "wrongly-attributed" : "missing", failed: [] as Dim[], pendingOpen: [] as string[] };
  }
  const c = exact[0];
  const [head, ...rest] = c.display.split("\n");
  const display = n(c.display);
  const cited = c.evidence.map((e) => n(e.quote));
  const failed: Dim[] = [];
  if (!n(head).endsWith(n(g.value))) failed.push("value");
  // The cell (after the column heading for a table claim, the amount for a
  // statement); label sub-notes ("• Not subject to Deductible") are not it.
  const cut = head.lastIndexOf("): ");
  const cell = cut >= 0 ? head.slice(cut + 3) : head.slice(g.label.length);
  if (NEGATION.test(cell) && !NEGATION.test(g.value)) failed.push("polarity");
  if ((g.forbidden ?? []).some((f) => c.display.includes(f))) failed.push("polarity");
  if (!g.restrictions.every((r) => display.includes(n(r)))) failed.push("restrictions");
  if (!g.restrictions.every((r) => cited.some((q) => q.includes(n(r)))) || !g.pages.every((p) => c.evidence.some((e) => e.page === p))) failed.push("evidence");
  if (c.states.join() !== "verified-plan") failed.push("presentation");
  void rest;
  const pendingOpen = (g.pending ?? []).filter((r) => !display.includes(n(r)));
  return { status: failed.filter((d) => d !== "presentation").length ? "incomplete" : failed.length ? "correct-not-presented-as-verified" : "fully-correct", failed: [...new Set(failed)], pendingOpen };
}

const path = process.argv[2];
if (!path) { console.error("usage: provision-score.ts <inventory.json> [--list]"); process.exit(1); }
const claims = JSON.parse(readFileSync(path, "utf8")) as InventoryClaim[];
const tally: Record<string, number> = {};
const dimFails: Record<string, number> = {};
const lines: string[] = [];
let pending = 0;
for (const g of GOLD) {
  const r = grade(g, claims);
  tally[r.status] = (tally[r.status] ?? 0) + 1;
  for (const d of r.failed) dimFails[d] = (dimFails[d] ?? 0) + 1;
  if (r.pendingOpen.length) pending++;
  lines.push(`${r.status.padEnd(34)} ${g.id}${r.failed.length ? `  [${r.failed.join(",")}]` : ""}${r.pendingOpen.length ? "  (pending adjudication: catch-all rule not attached)" : ""}`);
}
const leaked = claims.filter((c) => (WITHHELD_DOCUMENTS as readonly string[]).includes(c.documentId));
console.log(`gold ${GOLD.length}: ${JSON.stringify(tally)}  failing dims ${JSON.stringify(dimFails)}  pending-adjudication ${pending}  verified claims in no-plan documents ${leaked.length}`);
if (process.argv.includes("--list")) for (const l of lines) console.log("  " + l);
void DIMS;
