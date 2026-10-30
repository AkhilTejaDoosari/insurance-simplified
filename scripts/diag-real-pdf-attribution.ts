// P0 REAL-DOCUMENT DIAGNOSTIC (owner-authorized; audit docs/INSURANCE_ARCHITECTURE_AUDIT.md §7/§11).
//
// Local-only, deterministic-engine-only diagnostic that reproduces the
// production /api/extract funnel stage-by-stage over the three authorized
// real brochures in nonstandard/ and reports exactly where each proven plan
// identity and each fact value survives or disappears:
//
//   Stage A  plan candidate attestation        (attestPlans, plan-identity.ts)
//   Stage B  plan source citation verification (verifyEvidenceCitation, the
//            extract route's drop-any-failing-source filter)
//   Stage C  plan presence in the final validated table
//   Stage D  value attribution BEFORE the route's Stage E gate
//            (attributePlanScope mention-based C6)
//   Stage E  value attribution AFTER the route's gate: labelled
//            plan/fact/value proof (hasPlanValueProof, unchanged) or the P1
//            document-ownership proof (resolveRowPlanIds — the exact gate
//            app/api/extract/route.ts applies)
//   Stage F  value-level citation verification + display grounding
//            (the route's per-value fail-closed boundary)
//   Stage G  comparison completeness (attributed/comparable rows, tiers)
//   Stage H  document-isolation (alone vs. together value sets)
//
// It imports production modules READ-ONLY. It never mutates them, never
// touches the network, DB, storage, or env-based LLM paths. The LLM engine
// is NEVER invoked: findings are DETERMINISTIC-ENGINE-ONLY and must not be
// read as the behavior of the LLM extraction path.
//
// The four title regexes below are a diagnostic MIRROR of
// app/lib/extraction/plan-identity.ts:27-36 (copied verbatim) so per-line
// match attribution can be reported. A consistency assertion cross-checks
// the mirror against the real attestPlans() output and reports any drift.
//
// Usage: npx tsx scripts/diag-real-pdf-attribution.ts

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback, type ExtractInputDocument } from "@/app/lib/extraction/extract";
import {
  validateTable,
  type CellValue,
  type ComparisonTable,
  type ProvenPlan,
} from "@/app/lib/extraction/types";
import {
  attestPlans,
  attributePlanScope,
  resolveRowPlanIds,
} from "@/app/lib/extraction/plan-identity";
import { checkDisplayGrounding, verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";

const AUTHORIZED_PDFS = [
  { file: "nonstandard/01_img_patriot_exchange_2026.pdf", documentId: "doc-1", label: "IMG Patriot Exchange" },
  { file: "nonstandard/03_worldtrips_studentsecure.pdf", documentId: "doc-2", label: "WorldTrips StudentSecure" },
  { file: "nonstandard/04_seven_corners_travel_medical_usa.pdf", documentId: "doc-3", label: "Seven Corners Travel Medical (USA)" },
] as const;

// ---------------------------------------------------------- diagnostic mirrors
// VERBATIM copies of plan-identity.ts:27-36 (label: diagnostic mirror; the
// consistency check below fails loudly if they drift from the real engine).
const M_DECLARATION = /^\s*(?:Policy|Plan) name:\s*([\w][\w &'().,-]{0,99}?)(?:\s*;\s*Policy ID:\s*([A-Za-z0-9][A-Za-z0-9-]{0,63}))?(?:\s*;\s*Issuer:\s*([\w][\w &'().,-]{0,99}))?\s*$/i;
const M_STUDENTSECURE = /^\s*Get\s+([A-Z][\w®-]*)\s+insurance\s+from\s+[A-Z][\w &'().,-]+\s*$/i;
const M_SEVENCORNERS = /^\s*Seven Corners (Travel Medical(?: Including the USA)?)\s*$/i;
const M_PROGRAM = /^\s*([\w][\w &'().,-]{2,90}?\s+Program(?:SM|℠)?)\s*$/i;

type SourceDoc = { documentId: string; filename: string; pageCount: number; pages: string[] };
type LoadedDoc = SourceDoc & ExtractInputDocument & { file: string; label: string; totalChars: number };

interface CitationOutcome { documentId: string; page: number; quote: string; ok: boolean; note?: string }

interface PlanFunnel {
  name: string;
  planId: string;
  stage: "A-attested" | "B-dropped-source-citation" | "C-in-table" | "D-mention-attributed" | "E-proof-gated";
  sources: { documentId: string; page: number; quote: string }[];
  sourceOutcomes: CitationOutcome[];
  /** Values mention-attributed to this plan (Stage D, before the route gate). */
  mentionAttributed: number;
  /** Values still attributed after the route's hasPlanValueProof gate (Stage E). */
  proofGated: number;
  /** Values whose evidence page contains the plan name even where attribution failed (P1 ownership-signal probe). */
  pageNameSignal: number;
}

interface DocFunnel {
  file: string;
  documentId: string;
  label: string;
  pageCount: number;
  totalChars: number;
  candidatePlans: PlanFunnel[];
  plansInTable: string[];
  rowsWithValues: number;
  verdictCounts: Record<string, number>;
  valueCitations: { checked: number; verified: number; failed: number };
  valuesKept: number;
  valuesDroppedNoVerifiedCitation: number;
  groundingUnsupported: number;
  attributedPreGate: number;
  attributedPostGate: number;
  tieredValues: number;
  comparableRowsDocuments: number;
  comparableRowsPlans: number;
  conflictRows: number;
}

async function loadDoc(entry: (typeof AUTHORIZED_PDFS)[number]): Promise<LoadedDoc> {
  const buf = readFileSync(entry.file);
  const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { pageCount, pages } = await extractPages(bytes, basename(entry.file));
  return {
    documentId: entry.documentId,
    filename: basename(entry.file),
    label: entry.label,
    file: entry.file,
    pageCount,
    pages,
    totalChars: pages.join("\n").length,
  };
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/** Diagnostic mirror scan: which mirrored pattern (if any) matched each line.
 *  `names` records the CAPTURED plan name (what attestPlans() would use), not
 *  the full line, so the consistency check compares like with like. */
function mirrorScan(docs: readonly SourceDoc[]): {
  matches: { documentId: string; page: number; lineIndex: number; pattern: string; name: string; text: string }[];
  patriotNearMisses: { documentId: string; page: number; lineIndex: number; text: string; firstLine?: boolean }[];
} {
  const matches: { documentId: string; page: number; lineIndex: number; pattern: string; name: string; text: string }[] = [];
  const patriotNearMisses: { documentId: string; page: number; lineIndex: number; text: string; firstLine?: boolean }[] = [];
  for (const doc of docs) {
    doc.pages.forEach((pageText, pageIdx) => {
      const lines = pageText.split(/\r?\n/);
      lines.forEach((line, lineIndex) => {
        const decl = M_DECLARATION.exec(line);
        const secure = decl ? null : M_STUDENTSECURE.exec(line);
        const corners = !decl && !secure ? M_SEVENCORNERS.exec(line) : null;
        const program = !decl && !secure && !corners && lineIndex === 0 ? M_PROGRAM.exec(line) : null;
        if (decl) matches.push({ documentId: doc.documentId, page: pageIdx + 1, lineIndex, pattern: "declaration", name: decl[1].trim(), text: line.trim() });
        else if (secure) matches.push({ documentId: doc.documentId, page: pageIdx + 1, lineIndex, pattern: "studentSecureTitle", name: secure[1], text: line.trim() });
        else if (corners) matches.push({ documentId: doc.documentId, page: pageIdx + 1, lineIndex, pattern: "sevenCornersTitle", name: corners[1], text: line.trim() });
        else if (program) {
          const secondIsCertificate = /^\s*Certificate of Insurance\s*$/i.test(lines[1] ?? "");
          matches.push({
            documentId: doc.documentId,
            page: pageIdx + 1,
            lineIndex,
            pattern: secondIsCertificate ? "programTitle+certificate" : "programTitle(NO certificate second line — real engine rejects)",
            name: secondIsCertificate ? program[1].trim() : "",
            text: line.trim(),
          });
        }
        if (/patriot/i.test(line) && matches.every((m) => m.text !== line.trim())) {
          patriotNearMisses.push({
            documentId: doc.documentId,
            page: pageIdx + 1,
            lineIndex,
            text: line.trim().slice(0, 120),
            ...(lineIndex === 0 ? { firstLine: true } : {}),
          });
        }
      });
    });
  }
  return { matches, patriotNearMisses };
}

/** Reproduce the exact per-value pipeline of app/api/extract/route.ts on a
 *  validated fallback table, reporting every drop with its stage. */
function runFunnel(docs: readonly LoadedDoc[], runLabel: string) {
  const sourceDocs: SourceDoc[] = docs.map(({ documentId, filename, pages, pageCount }) => ({ documentId, filename, pages, pageCount }));
  const fallbackTable = extractFallback([...docs], {});
  const table = validateTable(fallbackTable);

  // Stage A — candidates (route: proposedPlans = table.plans ?? attestPlans(...)).
  const candidates: ProvenPlan[] = attestPlans(sourceDocs);

  // Stage B — route filter: drop the whole plan if ANY source citation fails.
  const survived: ProvenPlan[] = [];
  const planFunnels: PlanFunnel[] = candidates.map((plan) => {
    const sourceOutcomes: CitationOutcome[] = plan.sources.map((source) => {
      const verified = verifyEvidenceCitation(sourceDocs, source);
      return verified.ok
        ? { ...source, ok: true }
        : { ...source, ok: false, note: "source citation not uniquely verifiable on its claimed page" };
    });
    const ok = sourceOutcomes.every((o) => o.ok);
    const funnel: PlanFunnel = {
      name: plan.name,
      planId: plan.planId,
      stage: ok ? "C-in-table" : "B-dropped-source-citation",
      sources: plan.sources.map(({ documentId, page, quote }) => ({ documentId, page, quote })),
      sourceOutcomes,
      mentionAttributed: 0,
      proofGated: 0,
      pageNameSignal: 0,
    };
    if (ok) survived.push(plan);
    return funnel;
  });

  // Route value pipeline (verbatim semantics of extract/route.ts:124-185,
  // two-phase: verify+ground first, then Stage E plan attribution).
  const scoped = survived.length > 0 ? attributePlanScope({ ...table, plans: survived }, sourceDocs) : table;
  const planNameOf = new Map(survived.map((p) => [p.planId, p.name]));

  let citationChecked = 0, citationVerified = 0, citationFailed = 0;
  let valuesKept = 0, valuesDropped = 0, groundingUnsupported = 0;
  let attributedPreGate = 0, attributedPostGate = 0, tieredValues = 0, conflictRows = 0;
  const verdictCounts: Record<string, number> = {};
  const comparableDocRows: string[] = [];
  const comparablePlanRows: string[] = [];
  const perPlanAttribution = new Map<string, { mention: number; gated: number; pageName: number }>();

  for (const [rowIndex, row] of scoped.rows.entries()) {
    // Phase 1 — verify citations + display grounding (route-verbatim).
    const verifiedValues: { value: CellValue; evidence: { documentId: string; page: number; quote: string }[] }[] = [];
    for (const value of row.values) {
      const evidence: { documentId: string; page: number; quote: string }[] = [];
      for (const entry of value.evidence) {
        citationChecked++;
        const verified = verifyEvidenceCitation(sourceDocs, entry);
        if (verified.ok) {
          citationVerified++;
          evidence.push({ ...entry, quote: verified.quote });
        } else citationFailed++;
      }
      if (evidence.length === 0) {
        valuesDropped++;
        continue;
      }
      valuesKept++;
      if (value.qualifiers.planTier) tieredValues++;
      const grounding = checkDisplayGrounding(value.display, row.factName, evidence.map((e) => e.quote));
      if (!grounding.supported) groundingUnsupported++;
      verifiedValues.push({ value: { ...value, evidence }, evidence });
    }

    // Phase 2 — Stage E plan attribution: claimed labelled-line proof first
    // (hasPlanValueProof, unchanged), then the P1 document-ownership proof
    // (unique verified plan identity + applicability guards + conflict-free
    // peer group), via the same production helper the route calls.
    const planIds = resolveRowPlanIds(
      row.factName,
      verifiedValues.map((entry) => entry.value),
      survived,
      sourceDocs
    );
    const kept: CellValue[] = verifiedValues.map((entry, index) => {
      const preGatePlanId = entry.value.planId;
      const planId = planIds[index];
      if (planId) attributedPostGate++;
      if (preGatePlanId) {
        attributedPreGate++;
        const bucket = perPlanAttribution.get(preGatePlanId) ?? { mention: 0, gated: 0, pageName: 0 };
        bucket.mention++;
        if (planId) bucket.gated++;
        else {
          // P1 ownership-signal probe: does the plan name appear anywhere on the cited page?
          const citedPage = sourceDocs.find((d) => d.documentId === entry.value.documentId)?.pages[entry.evidence[0].page - 1] ?? "";
          const name = planNameOf.get(preGatePlanId);
          if (name && citedPage.toLowerCase().includes(name.toLowerCase())) bucket.pageName++;
        }
        perPlanAttribution.set(preGatePlanId, bucket);
      } else {
        // P1 ownership-signal probe for ALL unassigned values (including those
        // never mention-attributed): how often does a proven plan scoped to this
        // document appear on the value's own cited page? This measures the
        // page-level ownership signal available to a future generalized
        // plan-identity stage WITHOUT changing any production rule.
        const docPlans = survived.filter((p) => p.sources.some((s) => s.documentId === entry.value.documentId));
        const citedPage = sourceDocs.find((d) => d.documentId === entry.value.documentId)?.pages[entry.evidence[0].page - 1] ?? "";
        for (const p of docPlans) {
          const bucketP = perPlanAttribution.get(p.planId) ?? { mention: 0, gated: 0, pageName: 0 };
          if (planId === p.planId) bucketP.gated++;
          else if (citedPage.toLowerCase().includes(p.name.toLowerCase())) bucketP.pageName++;
          perPlanAttribution.set(p.planId, bucketP);
        }
      }
      const { planId: _claimedPlanId, ...unscoped } = entry.value;
      return { ...unscoped, ...(planId ? { planId } : {}), evidence: entry.evidence } as CellValue;
    });
    if (kept.length === 0) {
      verdictCounts["NOT STATED (flipped: all values lost citations)"] = (verdictCounts["NOT STATED (flipped: all values lost citations)"] ?? 0) + 1;
      continue;
    }
    const finalVerdict = groundingUnsupported > 0 && (row.verdict === "SUPPORTED" || row.verdict === "CONFLICTED") ? "NEEDS VERIFICATION" : row.verdict;
    verdictCounts[finalVerdict] = (verdictCounts[finalVerdict] ?? 0) + 1;
    const rowOut = { ...row, verdict: finalVerdict, values: kept };
    const docsInRow = new Set(rowOut.values.map((v) => v.documentId));
    if (docsInRow.size >= 2) comparableDocRows.push(`${rowIndex}:${row.factName}`);
    const planIdsInRow = new Set(rowOut.values.map((v) => v.planId).filter(Boolean));
    if (planIdsInRow.size >= 2) comparablePlanRows.push(`${rowIndex}:${row.factName}`);
    if (hasSameScopeContradiction(rowOut.values)) conflictRows++;
  }

  const funnel: {
    runLabel: string;
    documents: { documentId: string; filename: string; pageCount: number }[];
    stageA_candidates: { name: string; planId: string }[];
    stageB_survived: string[];
    stageC_plansInTable: string[];
    perPlan: PlanFunnel[];
    verdictCounts: Record<string, number>;
    citations: { checked: number; verified: number; failed: number };
    values: { kept: number; droppedNoVerifiedCitation: number; groundingUnsupported: number; attributedPreGate: number; attributedPostGate: number; tiered: number };
    comparison: { rowsWithValues: number; comparableAcrossDocuments: string[]; comparableAcrossPlans: string[]; conflictRows: number };
    compareModeAvailable: { enabled: boolean; reason: string };
  } = {
    runLabel,
    documents: table.documents,
    stageA_candidates: candidates.map(({ name, planId }) => ({ name, planId })),
    stageB_survived: survived.map((p) => p.name),
    stageC_plansInTable: survived.map((p) => p.name),
    perPlan: planFunnels.map((f) => {
      const bucket = perPlanAttribution.get(f.planId) ?? { mention: 0, gated: 0, pageName: 0 };
      const finalStage = !f.sourceOutcomes.every((o) => o.ok)
        ? "B-dropped-source-citation"
        : bucket.mention === 0
          ? "C-in-table(no value ever mentions the plan)"
          : bucket.gated === 0
            ? "E-proof-gated(no labelled-line or ownership proof survived)"
            : "E-proof-gated";
      return { ...f, mentionAttributed: bucket.mention, proofGated: bucket.gated, pageNameSignal: bucket.pageName, stage: finalStage as PlanFunnel["stage"] };
    }),
    verdictCounts,
    citations: { checked: citationChecked, verified: citationVerified, failed: citationFailed },
    values: {
      kept: valuesKept,
      droppedNoVerifiedCitation: valuesDropped,
      groundingUnsupported,
      attributedPreGate,
      attributedPostGate,
      tiered: tieredValues,
    },
    comparison: {
      rowsWithValues: Object.values(verdictCounts).reduce((a, b) => a + b, 0),
      comparableAcrossDocuments: comparableDocRows,
      comparableAcrossPlans: comparablePlanRows,
      conflictRows,
    },
    compareModeAvailable:
      survived.length >= 2
        ? { enabled: true, reason: `${survived.length} proven plans ≥ 2 (page.tsx:416 gate)` }
        : { enabled: false, reason: `only ${survived.length} proven plan(s) survived; compare requires ≥2 (page.tsx:416 gate)` },
  };
  return { funnel, table: scoped, candidates, survived };
}

/** Contamination check: per-document value sets alone vs. together. */
function valueSetKey(row: { factName: string }, value: CellValue): string {
  return JSON.stringify([row.factName, value.documentId, value.display, value.qualifiers, value.evidence.map((e) => [e.documentId, e.page, e.quote])]);
}

function docValueSet(table: ComparisonTable, documentId: string): Set<string> {
  const keys = new Set<string>();
  for (const row of table.rows)
    for (const value of row.values)
      if (value.documentId === documentId) keys.add(valueSetKey(row, value));
  return keys;
}

// ------------------------------------------------------------------- driver
async function main(): Promise<void> {
const all = await Promise.all(AUTHORIZED_PDFS.map(loadDoc));
const result: Record<string, unknown> = {};
result.engine = "DETERMINISTIC FALLBACK ONLY (extractFallback); LLM engine NOT invoked per owner authorization";
result.documents = all.map(({ documentId, file, label, pageCount, totalChars }) => ({ documentId, file, label, pageCount, totalChars }));

// Singles + trio funnels.
const singles = all.map((doc) => runFunnel([doc], `alone:${doc.documentId}`));
const trio = runFunnel(all, "together:all-3");
result.singles = singles.map(({ funnel }) => funnel);
result.trio = trio.funnel;

// Stage H — isolation: per-document value sets alone vs. together.
result.isolation = all.map((doc, i) => {
  const aloneSet = docValueSet(singles[i].table, doc.documentId);
  const togetherSet = docValueSet(trio.table, doc.documentId);
  let onlyAlone = 0;
  for (const key of aloneSet) if (!togetherSet.has(key)) onlyAlone++;
  let onlyTogether = 0;
  for (const key of togetherSet) if (!aloneSet.has(key)) onlyTogether++;
  return { documentId: doc.documentId, label: doc.label, aloneValues: aloneSet.size, togetherValues: togetherSet.size, onlyAlone, onlyTogether, identical: onlyAlone === 0 && onlyTogether === 0 };
});

// Mirror consistency: the diagnostic mirror must agree with the real attestPlans.
const mirror = mirrorScan(all);
const realNames = new Set(trio.candidates.map((p) => p.name));
const mirrorNames = new Set(
  mirror.matches
    .filter((m) => m.pattern !== "programTitle(NO certificate second line — real engine rejects)" && m.name)
    .map((m) => m.name),
);
result.mirrorScan = {
  matches: mirror.matches,
  patriotNearMisses: mirror.patriotNearMisses,
  consistency:
    realNames.size === mirrorNames.size && [...mirrorNames].every((n) => realNames.has(n))
      ? "mirror agrees with attestPlans()"
      : `DRIFT: attestPlans()=${[...realNames].join(" | ")} vs mirror=${[...mirrorNames].join(" | ")}`,
};

// Patriot deep-dive: first pages + candidate title lines around its Program℠ pattern.
const patriot = all[0];
result.patriotFocus = {
  file: patriot.file,
  firstFiveLinesOfPage1: patriot.pages[0]?.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5) ?? [],
  firstFiveLinesOfPage2: patriot.pages[1]?.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5) ?? [],
  linesContainingProgram: patriot.pages.flatMap((pageText, i) =>
    pageText.split(/\r?\n/).flatMap((line, lineIndex) =>
      /program/i.test(line) ? [{ page: i + 1, lineIndex, text: line.trim().slice(0, 120) }] : [],
    ),
  ).slice(0, 10),
};

console.log(JSON.stringify(result, null, 2));
}

void main().catch((err) => {
  console.error(`[diag-real-pdf-attribution] failed:`, err);
  process.exit(1);
});
