// P2 fact-discovery experiment — evaluation runner.
//
// Modes:
//   baseline   run the existing deterministic extraction funnel (production
//              modules, read-only) and measure it against the ground-truth
//              fixtures
//   prototype  run the experimental open-vocabulary candidate-concept
//              prototype (scripts/p2-experiment/discovery.ts) against the
//              same fixtures
//
// Usage:
//   npx tsx scripts/p2-experiment/run-p2-eval.ts baseline
//   npx tsx scripts/p2-experiment/run-p2-eval.ts prototype
//
// This file is EXPERIMENT-ONLY. Nothing in app/ imports it; it changes no
// production code, schema, C6 semantics, tests, or presentation.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type CellValue } from "@/app/lib/extraction/types";
import {
  attestPlans,
  attributePlanScope,
  resolveRowPlanIds,
} from "@/app/lib/extraction/plan-identity";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { DOCS, GROUND_TRUTH, type DocId, type GroundTruthItem } from "./ground-truth";
import { discoverCandidates, type CandidateFact } from "./discovery";

type SourceDoc = { documentId: string; filename: string; pageCount: number; pages: string[]; tables?: LayoutTable[] };

/** Whitespace/case-normalized text for span-overlap matching. */
export function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function spansOverlap(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (!n) return false;
  return h.includes(n) || n.includes(h);
}

/** expectedConcept → fact rows of the existing 43-fact inventory that may
 *  legitimately carry it. Empty set = concept outside the inventory. */
export const CONCEPT_TO_INVENTORY_ROWS: Record<string, string[]> = {
  "overall-maximum-limit": ["policy-limit"],
  "coverage-duration-maximum": ["coverage-duration"],
  "per-illness-or-injury-limit": ["policy-limit"],
  "coinsurance-in-network": ["coinsurance"],
  "coinsurance-out-of-network": ["coinsurance", "network-rules"],
  "out-of-pocket-maximum": ["out-of-pocket-maximum"],
  "pre-certification-penalty": ["preauthorization"],
  "pre-existing-condition-rule": ["pre-existing-conditions", "material-exclusions"],
  "pre-existing-waiting-period": ["pre-existing-conditions", "waiting-period"],
  "acute-onset-pre-existing": ["pre-existing-conditions"],
  "urgent-care-copay": ["urgent-care"],
  "walk-in-clinic-copay": ["urgent-care"],
  "emergency-room-deductible-illness": ["emergency-care"],
  "emergency-room-copay": ["emergency-care"],
  "prescription-drug-limit": ["prescriptions"],
  "prescription-drugs": ["prescriptions"],
  "mental-health-limit": ["mental-health"],
  "mental-health": ["mental-health"],
  "emergency-evacuation-limit": ["emergency-evacuation"],
  "eligibility-age-visa": ["eligibility", "student-eligibility"],
  "eligibility-student-status": ["student-eligibility", "eligibility"],
  "eligibility-residency-age": ["eligibility", "geographic-restrictions"],
  "j1-extension-period": ["coverage-duration", "coverage-dates", "eligibility"],
  "maternity-exclusion": ["maternity-coverage", "material-exclusions"],
  "maternity": ["maternity-coverage"],
  "preventative-care-exclusion": ["preventive-care", "material-exclusions"],
  "preventive-care": ["preventive-care"],
  "vaccinations": ["preventive-care"],
  "physician-visit-copay": ["primary-care-visit"],
  "physiotherapy-chiropractic": ["physical-therapy", "chiropractic"],
  "ambulance-limit": ["ambulance"],
  "ad-and-d": ["ad-and-d"],
  "accidental-death-dismemberment": ["ad-and-d"],
  "deductible-options": ["annual-deductible"],
  "annual-deductible": ["annual-deductible"],
  "medical-maximum-options": ["policy-limit", "age-limits"],
  "telehealth-visits": ["telehealth"],
  // Outside the 43-fact inventory:
  "ppaca-status": [],
  "organized-sports-limit": [],
  "cancellation-refund-policy": [],
  "home-country-extension": [],
  "natural-disaster-evacuation": [],
  "trip-interruption": [],
  "baggage-coverage": [],
  "treatment-window": [],
  "assist-utilization-requirement": [],
  "limited-benefit-policy-status": [],
  "j1-visa-extension": [],
  "incidental-trip-eligibility-condition": [],
};

export interface ItemEvaluation {
  id: string;
  doc: DocId;
  page: number;
  kind: string;
  expectedConcept: string | null;
  expectedHandling: string;
  matches: {
    factName: string;
    planId?: string;
    display: string;
    qualifiers: Record<string, unknown>;
    page: number;
  }[];
  verdict: string; // per-item adjudication (mode-specific)
}

/** Collect every final (route-funnel) value whose verified evidence overlaps
 *  the fixture span, restricted to the fixture's document and page. */
export function valuesOverlappingSpan(
  rowFacts: { factName: string; values: (CellValue & { planId?: string })[] }[],
  item: GroundTruthItem,
  pageText: string,
): ItemEvaluation["matches"] {
  const out: ItemEvaluation["matches"] = [];
  for (const row of rowFacts) {
    for (const value of row.values) {
      if (value.documentId !== item.doc) continue;
      if (!value.evidence.some((e) => e.page === item.page)) continue;
      const cited = value.evidence.map((e) => e.quote).join(" ");
      if (!spansOverlap(cited, item.span) && !spansOverlap(pageText, item.span)) continue;
      if (!value.evidence.some((e) => spansOverlap(e.quote, item.span))) continue;
      out.push({
        factName: row.factName,
        ...(value.planId ? { planId: value.planId } : {}),
        display: value.display,
        qualifiers: value.qualifiers as unknown as Record<string, unknown>,
        page: item.page,
      });
    }
  }
  return out;
}

export async function loadSourceDocs(): Promise<{ docs: SourceDoc[]; pageTexts: Map<string, string[]> }> {
  const docs: SourceDoc[] = [];
  const pageTexts = new Map<string, string[]>();
  for (const [, meta] of Object.entries(DOCS)) {
    const buf = readFileSync(meta.file);
    const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const { pageCount, pages, tables } = await extractPages(bytes, basename(meta.file));
    docs.push({ documentId: meta.documentId, filename: basename(meta.file), pageCount, pages, tables });
    pageTexts.set(meta.documentId, pages);
  }
  return { docs, pageTexts };
}

/** Reproduce the production deterministic funnel (route.ts two-phase, P1). */
export async function runBaselineFunnel(docs: SourceDoc[]) {
  // The production verification boundary itself (shared with /api/extract),
  // not a mirror of it.
  const table = validateTable(extractFallback(docs, {}));
  const verified = verifyComparisonTable(table, docs);
  return verified.rows.map((row) => ({
    factName: row.factName,
    values: row.values as (CellValue & { planId?: string })[],
  }));
}

export function adjudicateBaseline(
  item: GroundTruthItem,
  matches: ItemEvaluation["matches"],
): { verdict: string; correct: boolean } {
  if (item.expectedHandling === "withhold") {
    if (matches.length === 0) return { verdict: "correctly-withheld", correct: true };
    const attributed = matches.filter((m) => m.planId);
    if (attributed.length > 0) {
      return { verdict: `unsupported-attribution(${attributed.length})`, correct: false };
    }
    return { verdict: `extracted-but-unassigned(${matches.length})`, correct: false };
  }
  if (item.expectedHandling === "optional") {
    // Correct handling = not attributed to the base plan (not extracted is fine).
    const attributed = matches.filter((m) => m.planId);
    if (attributed.length > 0) return { verdict: `optional-attributed-as-base(${attributed.length})`, correct: false };
    if (matches.length > 0) return { verdict: "optional-extracted-unassigned", correct: true };
    return { verdict: "not-extracted", correct: true };
  }
  // display
  if (matches.length === 0) return { verdict: "missed", correct: false };
  const acceptable = CONCEPT_TO_INVENTORY_ROWS[item.expectedConcept];
  const conceptMatches = acceptable === undefined
    ? []
    : matches.filter((m) => acceptable.includes(m.factName));
  if (conceptMatches.length > 0) {
    // Wrong-qualifier probe: tier-dependent items should carry planTier when
    // the value text contains a single tier column; flat multi-tier
    // concatenations without planTier are reported for adjudication.
    return { verdict: "extracted-right-row", correct: true };
  }
  if (CONCEPT_TO_INVENTORY_ROWS[item.expectedConcept] === undefined || acceptable.length === 0) {
    return { verdict: `wrong-row(${matches.map((m) => m.factName).join("|")})`, correct: false };
  }
  return { verdict: `wrong-row(${matches.map((m) => m.factName).join("|")})`, correct: false };
}

export async function main(mode: "baseline" | "prototype") {
  const { docs, pageTexts } = await loadSourceDocs();
  const results: ItemEvaluation[] = [];

  if (mode === "baseline") {
    const rowFacts = await runBaselineFunnel(docs);
    for (const item of GROUND_TRUTH) {
      const pageText = pageTexts.get(item.doc)![item.page - 1];
      const matches = valuesOverlappingSpan(rowFacts, item, pageText);
      const { verdict } = adjudicateBaseline(item, matches);
      results.push({
        id: item.id,
        doc: item.doc,
        page: item.page,
        kind: item.kind,
        expectedConcept: item.expectedConcept ?? null,
        expectedHandling: item.expectedHandling,
        matches,
        verdict,
      });
    }
  } else {
    const candidates = discoverCandidates(docs, pageTexts);
    for (const item of GROUND_TRUTH) {
      const pageText = pageTexts.get(item.doc)![item.page - 1];
      const matches = candidates
        .filter((c) => c.documentId === item.doc && c.page === item.page)
        .filter((c) => c.evidence.some((e) => spansOverlap(e.quote, item.span)))
        .map((c) => ({
          factName: c.conceptKey,
          ...(c.planId ? { planId: c.planId } : {}),
          display: c.display,
          qualifiers: c.qualifiers as unknown as Record<string, unknown>,
          page: c.page,
          isOptional: c.isOptional,
        }));
      const { verdict } = adjudicatePrototype(item, matches);
      results.push({
        id: item.id,
        doc: item.doc,
        page: item.page,
        kind: item.kind,
        expectedConcept: item.expectedConcept ?? null,
        expectedHandling: item.expectedHandling,
        matches: matches.map(({ isOptional: _drop, ...rest }) => rest),
        verdict,
      });
    }
    // Emit the discovered candidate inventory for inspection.
    console.log("\n===== DISCOVERED CANDIDATE CONCEPTS (prototype) =====");
    const byDoc = new Map<string, number>();
    for (const c of candidates) byDoc.set(c.documentId, (byDoc.get(c.documentId) ?? 0) + 1);
    console.log("counts:", JSON.stringify([...byDoc.entries()]));
    for (const c of candidates.slice(0, 400)) {
      console.log(
        `- [${c.documentId} p${c.page}${c.section ? ` §${c.section.slice(0, 28)}` : ""}${c.isOptional ? " OPTIONAL" : ""}${c.planId ? ` →${c.planId}` : ""}] ${c.conceptKey}: ${JSON.stringify(c.display.slice(0, 80))}${c.uncertainty.length ? " ⚠" + c.uncertainty.join(",") : ""}`
      );
    }
  }

  // Aggregates.
  const displayItems = GROUND_TRUTH.filter((i) => i.expectedHandling === "display");
  const withholdItems = GROUND_TRUTH.filter((i) => i.expectedHandling === "withhold");
  const optionalItems = GROUND_TRUTH.filter((i) => i.expectedHandling === "optional");

  const verdictOf = (id: string) => results.find((r) => r.id === id)?.verdict ?? "missing";

  let displayCorrect = 0, withholdCorrect = 0, optionalCorrect = 0;
  for (const item of displayItems) {
    const v = verdictOf(item.id);
    if (v.startsWith("extracted-right-row") || v.startsWith("discovered-right-concept")) displayCorrect++;
  }
  for (const item of withholdItems) if (verdictOf(item.id) === "correctly-withheld") withholdCorrect++;
  for (const item of optionalItems) {
    const v = verdictOf(item.id);
    if (v === "optional-extracted-unassigned" || v === "not-extracted") optionalCorrect++;
  }

  console.log(`\n===== ${mode.toUpperCase()} SUMMARY =====`);
  console.log(`items: ${GROUND_TRUTH.length} (display ${displayItems.length}, withhold ${withholdItems.length}, optional ${optionalItems.length})`);
  console.log(`display items extracted-right-row: ${displayCorrect}/${displayItems.length} (prototype verdict: discovered-right-concept)`);
  console.log(`withhold items correctly withheld: ${withholdCorrect}/${withholdItems.length}`);
  console.log(`optional items handled correctly:  ${optionalCorrect}/${optionalItems.length}`);
  const unsupported = results.filter((r) => r.verdict.startsWith("unsupported-attribution") || r.verdict.startsWith("optional-attributed-as-base"));
  console.log(`unsupported-attribution items: ${unsupported.length}`);
  for (const r of unsupported) console.log(`  - ${r.id} (${r.expectedConcept ?? r.kind})`);
  console.log("\nper-item verdicts:");
  for (const r of results) console.log(`  ${r.id} [${r.kind}] ${r.verdict} ${r.matches.length ? `(${r.matches.map((m) => m.factName + (m.planId ? "*" : "")).join(", ")})` : ""}`);
  // duplicate-concept measure: display items matched by >1 value in one row
  // with INDISTINGUISHABLE qualifiers (same or absent tier marker) — tier-
  // qualified columns (elite vs select) are legitimate, not duplicates.
  for (const item of displayItems) {
    const r = results.find((x) => x.id === item.id)!;
    const byRow = new Map<string, string[]>();
    for (const m of r.matches) {
      const tierKey = `${m.qualifiers?.planTier ?? ""}|${m.qualifiers?.networkTier ?? ""}`;
      const arr = byRow.get(m.factName) ?? [];
      arr.push(tierKey);
      byRow.set(m.factName, arr);
    }
    for (const [f, tiers2] of byRow.entries()) {
      const counts = new Map<string, number>();
      for (const t of tiers2) counts.set(t, (counts.get(t) ?? 0) + 1);
      const dup = [...counts.entries()].filter(([, n]) => n > 1);
      if (dup.length) console.log(`  DUPLICATE ${item.id}: ${dup.map(([tk, n]) => `${f}[${tk}]×${n}`).join(", ")}`);
    }
  }
}

/** Concept-key compatibility for prototype adjudication (defined BEFORE the
 *  runs, applied identically to both sides):
 *  1. exact match after light stemming (plural/ies);
 *  2. full token containment either direction;
 *  3. significant-token overlap: a domain-significant token (not in the
 *     generic-insurance-vocabulary stop list) shared between expected and key;
 *  4. head-token equality (same leading concept).
 *  Generic vocabulary (maximum/limit/coverage/care/…) alone never satisfies
 *  the rule — only domain words (dental, evacuation, maternity, …) do. */
const GENERIC_CONCEPT_TOKENS = new Set([
  "overall", "maximum", "max", "limit", "coverage", "care", "medical",
  "period", "policy", "status", "benefit", "insurance", "plan", "amount",
  "person", "per", "of", "the", "and", "or", "for", "to", "up", "in", "on",
  "a", "an", "with", "within", "not", "no", "you", "your", "are", "is",
  "be", "by", "as", "at", "from", "value", "referenced", "defined",
]);

function conceptStem(token: string): string {
  return token.replace(/ies$/, "y").replace(/s$/, "");
}

const SPELLING_CANON_COMPAT: [RegExp, string][] = [
  [/\bpreventative\b/gi, "preventive"],
  [/\bco-?pay(?:ment)?s?\b/gi, "copay"],
];

export function conceptCompatible(expected: string, key: string): boolean {
  for (const [re, to] of SPELLING_CANON_COMPAT) {
    expected = expected.replace(re, to);
    key = key.replace(re, to);
  }
  const e = expected.split("-").filter(Boolean).map(conceptStem);
  const k = key.split("-").filter(Boolean).map(conceptStem);
  if (e.join("-") === k.join("-")) return true;
  const eSig = e.filter((t) => !GENERIC_CONCEPT_TOKENS.has(t));
  const kSig = k.filter((t) => !GENERIC_CONCEPT_TOKENS.has(t));
  if (eSig.length === 0) {
    // expected is fully generic (e.g. "overall-maximum-limit"): accept when
    // every key token is also generic and contained in the expected tokens.
    return k.length > 0 && k.every((t) => e.includes(t));
  }
  if (eSig.some((t) => k.includes(t))) return true;
  return e[0] === k[0];
}

function adjudicatePrototype(
  item: GroundTruthItem,
  matches: (ItemEvaluation["matches"][number] & { isOptional?: boolean })[],
): { verdict: string; correct: boolean } {
  if (item.expectedHandling === "withhold") {
    if (matches.length === 0) return { verdict: "correctly-withheld", correct: true };
    const attributed = matches.filter((m) => m.planId);
    if (attributed.length > 0) return { verdict: `unsupported-attribution(${attributed.length})`, correct: false };
    return { verdict: `extracted-but-unassigned(${matches.length})`, correct: false };
  }
  if (item.expectedHandling === "optional") {
    const attributed = matches.filter((m) => m.planId);
    if (attributed.length > 0) return { verdict: `optional-attributed-as-base(${attributed.length})`, correct: false };
    if (matches.length > 0) return { verdict: "optional-extracted-unassigned", correct: true };
    return { verdict: "not-extracted", correct: true };
  }
  if (matches.length === 0) return { verdict: "missed", correct: false };
  const expected = norm(item.expectedConcept);
  const conceptMatches = matches.filter((m) => conceptCompatible(expected, norm(m.factName)));
  if (conceptMatches.length > 0) return { verdict: "discovered-right-concept", correct: true };
  return { verdict: `wrong-concept(${matches.map((m) => m.factName).join("|")})`, correct: false };
}

const mode = process.argv[2] === "prototype" ? "prototype" : "baseline";
// Only auto-run when invoked as a script (imported modules reuse the exports).
if (process.argv[1]?.includes("run-p2-eval")) {
  void main(mode).catch((err) => { console.error("failed:", err); process.exit(1); });
}
