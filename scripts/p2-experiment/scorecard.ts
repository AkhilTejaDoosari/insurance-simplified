// Extraction-quality scorecard — deterministic baseline over the preserved
// real-document corpus.
//
// Extends the P2 evaluation harness (./run-p2-eval.ts) instead of adding a
// parallel framework: it reuses runBaselineFunnel (the production /api/extract
// deterministic funnel, imported read-only), valuesOverlappingSpan and
// adjudicateBaseline over the existing brochure ground truth
// (./ground-truth.ts), and adds value-level gold targets for FEP Blue Focus,
// FEMA NFIP and the health-education guide (./ground-truth-real.ts).
//
// Offline and read-only: no LLM, no network, no DB, no storage, no env-based
// provider path. Missing PDFs are reported as SKIPPED, never as PASS.
//
// Usage:
//   REAL_PDFS_DIR=/path/to/preserved npm run eval:extraction
//   REAL_PDFS_DIR=... npx tsx scripts/p2-experiment/scorecard.ts [--out file.json]
//
// Default JSON output: test-results/extraction-scorecard.json (gitignored;
// contains short source quotes from licensed PDFs — do not commit it).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type CellValue } from "@/app/lib/extraction/types";
import { attestPlans } from "@/app/lib/extraction/plan-identity";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { GROUND_TRUTH } from "./ground-truth";
import {
  adjudicateBaseline,
  CONCEPT_TO_INVENTORY_ROWS,
  norm,
  runBaselineFunnel,
  spansOverlap,
  valuesOverlappingSpan,
} from "./run-p2-eval";
import { CLAIM_LABELS } from "./claim-labels";
import {
  CORPUS,
  NOISE_HEURISTICS,
  NOISE_TARGETS,
  VALUE_TARGETS,
  type CorpusDoc,
  type ValueTarget,
} from "./ground-truth-real";

type SourceDoc = { documentId: string; filename: string; pageCount: number; pages: string[]; tables?: LayoutTable[] };
type FinalValue = CellValue & { planId?: string };
type RowFacts = { factName: string; values: FinalValue[] }[];

const ratio = (n: number, d: number) => ({ n, d, value: d === 0 ? null : Math.round((n / d) * 1000) / 1000 });
const NOT_CALCULABLE = (reason: string) => ({ status: "NOT_CALCULABLE" as const, reason });

/** Strip ®/™/℠/SM marks and normalize whitespace/case for plan-name comparison. */
function planKey(name: string): string {
  return norm(name.replace(/[®™℠]/g, "").replace(/(?<=\w)SM\b/g, "").replace(/\s+/g, " "));
}

function figureIn(text: string, figure: string): boolean {
  const escaped = figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\$/, "\\$\\s?");
  return new RegExp(`${escaped}(?![\\d,])`, "i").test(text.replace(/\s+/g, " "));
}

function qualifierText(v: FinalValue): string {
  return Object.values(v.qualifiers ?? {}).map(String).join(" | ");
}

function labelIn(text: string, label: string): boolean {
  return new RegExp(`(?:^|[^a-z])${label.replace(/[-\s]+/g, "[-\\s]+")}(?:$|[^a-z])`, "i").test(text.replace(/\s+/g, " "));
}

async function loadDoc(meta: CorpusDoc, realDir: string): Promise<SourceDoc | null> {
  const path = meta.location === "repo" ? meta.file : join(realDir, meta.file);
  if (meta.location === "real" && !realDir) return null;
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { pageCount, pages, tables } = await extractPages(bytes, basename(path));
  return { documentId: meta.documentId, filename: basename(path), pageCount, pages, tables };
}

/** Mechanical citation verification over the RAW (pre-verification) table. */
function rawCitationStats(docs: SourceDoc[]) {
  const table = validateTable(extractFallback(docs, {}));
  let citations = 0, verified = 0, values = 0;
  for (const row of table.rows) for (const value of row.values) {
    values++;
    for (const e of value.evidence) {
      citations++;
      if (verifyEvidenceCitation(docs, e).ok) verified++;
    }
  }
  return { rawValues: values, citations, verified };
}

function verifiedPlans(docs: SourceDoc[]) {
  return attestPlans(docs).filter((p) => p.sources.every((s) => verifyEvidenceCitation(docs, s).ok));
}

// --------------------------------------------------------------- per-target
function scoreValueTarget(target: ValueTarget, docId: string, rowFacts: RowFacts, planIdsOfDoc: string[]) {
  const onPage = (v: FinalValue) => v.documentId === docId && v.evidence.some((e) => target.pages.includes(e.page));
  const carriesFigures = (v: FinalValue) => target.figures.every((f) => figureIn(v.display, f));
  const citesFigures = (v: FinalValue) => target.figures.every((f) => figureIn(v.evidence.map((e) => e.quote).join(" "), f));
  // Candidates: values on a gold page whose display OR cited quote carries the figures.
  const candidates: { row: string; v: FinalValue }[] = [];
  for (const row of rowFacts) for (const v of row.values) if (onPage(v) && (carriesFigures(v) || citesFigures(v))) candidates.push({ row: row.factName, v });
  const inRow = candidates.filter((c) => target.rows.includes(c.row));
  // Best candidate: figure in display first, then most required qualifiers present structurally.
  const qualScore = (v: FinalValue) => (carriesFigures(v) ? 100 : 0) + target.requiredQualifiers.filter((q) => labelIn(qualifierText(v), q)).length;
  const best = [...inRow].sort((a, b) => qualScore(b.v) - qualScore(a.v))[0];

  const conceptMatch = inRow.length > 0;
  const valueCorrect = best ? carriesFigures(best.v) : false;
  const structuredQualifiers = best ? target.requiredQualifiers.filter((q) => labelIn(qualifierText(best.v), q)) : [];
  const displayQualifiers = best ? target.requiredQualifiers.filter((q) => labelIn(best.v.display, q)) : [];
  const forbidden = best ? (target.forbiddenQualifiers ?? []).filter((q) => labelIn(qualifierText(best.v), q)) : [];
  const quotes = best ? best.v.evidence.map((e) => e.quote).join(" ") : "";
  const citationTiesFigure = best ? target.figures.every((f) => figureIn(quotes, f)) : false;
  const citationTiesQualifiers = best ? target.requiredQualifiers.every((q) => labelIn(quotes, q)) : false;
  const attributed = best?.v.planId;
  let attribution: string;
  if (!best) attribution = "n/a (no value)";
  else if (target.attribution === "none") attribution = attributed ? "WRONG: attributed program/educational value" : "correct: unattributed";
  else if (attributed && planIdsOfDoc.includes(attributed)) {
    attribution = structuredQualifiers.length === target.requiredQualifiers.length
      ? "correct: attributed with complete scope"
      : "WRONG: attributed with incomplete scope";
  } else if (attributed) attribution = "WRONG: attributed to another document's plan";
  else attribution = "abstained";

  return {
    id: target.id,
    importance: target.importance,
    verdict: !candidates.length ? "missed" : !conceptMatch ? `wrong-row(${[...new Set(candidates.map((c) => c.row))].join("|")})` : valueCorrect ? "found" : "found-wrong-value",
    conceptMatch,
    valueCorrect,
    qualifiersComplete: best && valueCorrect ? structuredQualifiers.length === target.requiredQualifiers.length && forbidden.length === 0 : false,
    qualifiersPresentStructured: structuredQualifiers,
    qualifiersPresentInDisplayOnly: displayQualifiers.filter((q) => !structuredQualifiers.includes(q)),
    qualifiersMissing: target.requiredQualifiers.filter((q) => !structuredQualifiers.includes(q)),
    forbiddenQualifiersPresent: forbidden,
    citation: best ? { page: best.v.evidence[0]?.page, tiesFigure: citationTiesFigure, tiesQualifiers: citationTiesQualifiers } : null,
    attribution,
    candidateCount: candidates.length,
    best: best ? { row: best.row, display: best.v.display.slice(0, 160), qualifiers: best.v.qualifiers, planId: best.v.planId ?? null } : null,
    note: target.note,
  };
}

// ------------------------------------------------------------------ main
async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx > 0 ? process.argv[outIdx + 1] : "test-results/extraction-scorecard.json";
  const realDir = process.env.REAL_PDFS_DIR ?? "";

  const skipped: { key: string; reason: string }[] = [];
  const loaded = new Map<string, { meta: CorpusDoc; doc: SourceDoc }>();
  for (const meta of CORPUS) {
    const doc = await loadDoc(meta, realDir);
    if (!doc) {
      skipped.push({ key: meta.key, reason: meta.location === "real" && !realDir ? "REAL_PDFS_DIR unset" : `file not found: ${meta.file}` });
      continue;
    }
    loaded.set(meta.key, { meta, doc });
  }

  const sessions = [...new Set(CORPUS.map((c) => c.session))];
  const perDoc: Record<string, unknown>[] = [];
  const allTargets: ReturnType<typeof scoreValueTarget>[] = [];
  const brochureItems: Record<string, unknown>[] = [];
  const noiseResults: Record<string, unknown>[] = [];
  let crossDocAttributions = 0;
  /** Every attributed (verified-plan) claim, adjudicated against claim-labels.ts. */
  const claimTally = { correct: 0, "concept-adjacent": 0, "missing-qualifier": 0, "wrong-concept": 0, incorrect: 0, unlabelled: [] as string[] };
  /** Unstructured line values whose display is not their own cited text. */
  let nonVerbatimLineDisplays = 0;
  const squashed = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

  for (const session of sessions) {
    const members = CORPUS.filter((c) => c.session === session);
    if (members.some((m) => !loaded.has(m.key))) {
      for (const m of members) if (loaded.has(m.key)) skipped.push({ key: m.key, reason: `session ${session} incomplete` });
      continue;
    }
    const docs = members.map((m) => loaded.get(m.key)!.doc);
    const t0 = Date.now();
    const rowFacts: RowFacts = await runBaselineFunnel(docs);
    const ms = Date.now() - t0;
    const plans = verifiedPlans(docs);
    const raw = rawCitationStats(docs);

    for (const meta of members) {
      const doc = loaded.get(meta.key)!.doc;
      const docPlans = plans.filter((p) => p.sources.every((s) => s.documentId === meta.documentId));
      const docPlanIds = docPlans.map((p) => p.planId);
      const values = rowFacts.flatMap((r) => r.values.filter((v) => v.documentId === meta.documentId).map((v) => ({ row: r.factName, v })));
      const attributed = values.filter((x) => x.v.planId);
      const foreign = attributed.filter((x) => !docPlanIds.includes(x.v.planId!));
      crossDocAttributions += foreign.length;
      for (const { v } of values) {
        if (!v.anchor && !squashed(v.evidence.map((e) => e.quote).join(" ")).includes(squashed(v.display))) nonVerbatimLineDisplays++;
      }
      for (const { row, v } of attributed) {
        const q = v.qualifiers ?? {};
        const scope = (["planTier", "networkTier", "conditions"] as const).filter((k) => q[k] !== undefined).map((k) => `${k}=${q[k]}`).join(" | ");
        const key = `${meta.documentId}|${row}|${scope}|${v.display}`;
        const label = CLAIM_LABELS[key];
        if (!label) claimTally.unlabelled.push(key);
        else claimTally[label.verdict]++;
      }

      // Heuristic noise flags across every emitted value.
      const flagged = { "table-of-contents": [] as string[], "educational-definition": [] as string[] };
      let attributedNoise = 0;
      for (const { row, v } of values) {
        const quote = v.evidence.map((e) => e.quote).join(" ");
        const kinds = new Set(NOISE_HEURISTICS.filter((h) => h.re.test(quote)).map((h) => h.kind));
        for (const k of kinds) flagged[k as keyof typeof flagged].push(`${row} p${v.evidence[0].page}: ${quote.slice(0, 100)}`);
        if (kinds.size && v.planId) attributedNoise++;
      }
      const distinctQuotes = new Set(values.map((x) => `${x.v.evidence[0].page}|${norm(x.v.evidence[0].quote)}`)).size;

      const expected = meta.expectedPlans.map(planKey).sort();
      const actual = docPlans.map((p) => planKey(p.name)).sort();
      const identityCorrect = JSON.stringify(expected) === JSON.stringify(actual);
      const roleCorrect = (meta.role === "plan-document") === (docPlans.length > 0);

      perDoc.push({
        key: meta.key,
        documentId: meta.documentId,
        session,
        pages: doc.pageCount,
        pageCountMatchesLabel: doc.pageCount === meta.pageCount,
        extractionMs: ms,
        role: { expected: meta.role, proxy: docPlans.length > 0 ? "plan-document" : "non-plan", correct: roleCorrect },
        planIdentity: { expected: meta.expectedPlans, attested: docPlans.map((p) => p.name), correct: identityCorrect },
        emitted: {
          values: values.length,
          rowsPopulated: new Set(values.map((x) => x.row)).size,
          distinctSourceLines: distinctQuotes,
          duplicateValuesAcrossRows: values.length - distinctQuotes,
          attributed: attributed.length,
          attributedToForeignPlan: foreign.length,
        },
        noiseHeuristic: {
          tableOfContents: flagged["table-of-contents"].length,
          educationalDefinition: flagged["educational-definition"].length,
          attributedNoise,
          flaggedShare: ratio(new Set([...flagged["table-of-contents"], ...flagged["educational-definition"]]).size, values.length),
          samples: { toc: flagged["table-of-contents"].slice(0, 5), definition: flagged["educational-definition"].slice(0, 5) },
        },
      });

      // Value-level gold targets.
      for (const target of VALUE_TARGETS.filter((t) => t.doc === meta.key)) {
        allTargets.push({ ...scoreValueTarget(target, meta.documentId, rowFacts, docPlanIds), doc: meta.key } as ReturnType<typeof scoreValueTarget>);
      }

      // Noise targets: must not be emitted as a fact (any row).
      for (const n of NOISE_TARGETS.filter((t) => t.doc === meta.key)) {
        const hits = values.filter((x) => x.v.evidence.some((e) => e.page === n.page && spansOverlap(e.quote, n.span)));
        noiseResults.push({ id: n.id, kind: n.kind, emitted: hits.length > 0, rows: [...new Set(hits.map((h) => h.row))], attributed: hits.some((h) => h.v.planId) });
      }
    }

    // Existing span-level ground truth for the three brochures (same adjudication as run-p2-eval baseline).
    if (session === "brochures-3") {
      for (const item of GROUND_TRUTH) {
        const doc = docs.find((d) => d.documentId === item.doc)!;
        const matches = valuesOverlappingSpan(rowFacts, item, doc.pages[item.page - 1]);
        const { verdict, correct } = adjudicateBaseline(item, matches);
        const rows = CONCEPT_TO_INVENTORY_ROWS[item.expectedConcept] ?? [];
        const right = matches.filter((m) => rows.includes(m.factName));
        const figures = item.span.match(/\$\s?[\d,]+(?:\.\d+)?|\d+%/g) ?? [];
        brochureItems.push({
          id: item.id, doc: item.doc, kind: item.kind, handling: item.expectedHandling, concept: item.expectedConcept,
          inInventory: rows.length > 0, verdict, correct,
          valueCorrect: item.expectedHandling !== "display" || figures.length === 0 || right.length === 0
            ? null
            : right.some((m) => figures.every((f) => figureIn(m.display, f))),
          attributed: right.some((m) => m.planId),
        });
      }
    }
  }

  // ------------------------------------------------------------ aggregates
  const display = brochureItems.filter((i) => i.handling === "display");
  const displayInInv = display.filter((i) => i.inInventory);
  const withhold = brochureItems.filter((i) => i.handling !== "display");
  const valueChecked = display.filter((i) => i.valueCorrect !== null);
  const found = allTargets.filter((t) => t.conceptMatch);
  const planTargets = allTargets.filter((t) => VALUE_TARGETS.find((v) => v.id === t.id)!.attribution === "plan");
  const fepDocs = perDoc.find((d) => d.key === "fep");

  // Row-scoped precision where the gold set is exhaustive: FEP annual-deductible
  // and out-of-pocket-maximum. Every source statement of those amounts is in
  // VALUE_TARGETS, so any emitted value in those rows without a gold figure is
  // a false positive for that concept.
  const rowPrecision: Record<string, unknown> = {};
  if (fepDocs && loaded.has("fep")) {
    const rf = await runBaselineFunnel([loaded.get("fep")!.doc]);
    for (const row of ["annual-deductible", "out-of-pocket-maximum"]) {
      const goldFigures = VALUE_TARGETS.filter((t) => t.doc === "fep" && t.rows.includes(row)).flatMap((t) => t.figures);
      const vals = rf.find((r) => r.factName === row)?.values ?? [];
      const tp = vals.filter((v) => goldFigures.some((f) => figureIn(v.display, f))).length;
      rowPrecision[`fep:${row}`] = { ...ratio(tp, vals.length), goldFigures };
    }
  }

  const scorecard = {
    generatedAt: new Date().toISOString(),
    engine: "deterministic-fallback (production funnel via runBaselineFunnel; no LLM)",
    command: "REAL_PDFS_DIR=<dir> npm run eval:extraction",
    skipped,
    documents: perDoc,
    metrics: {
      documentRole: {
        measured: ratio(perDoc.filter((d) => (d.role as { correct: boolean }).correct).length, perDoc.length),
        definition: "proxy: plan-document ⇔ ≥1 verified attested plan. Program-brochure vs educational-guide is NOT distinguishable: the engine emits no role.",
      },
      planIdentity: { measured: ratio(perDoc.filter((d) => (d.planIdentity as { correct: boolean }).correct).length, perDoc.length) },
      factConceptRecall: {
        brochureDisplaySpans: ratio(display.filter((i) => i.correct).length, display.length),
        brochureDisplaySpansInInventory: ratio(displayInInv.filter((i) => i.correct).length, displayInInv.length),
        valueTargets: ratio(found.length, allTargets.length),
        criticalValueTargets: ratio(found.filter((t) => t.importance === "critical").length, allTargets.filter((t) => t.importance === "critical").length),
      },
      factConceptPrecision: {
        corpusWide: NOT_CALCULABLE("emitted values are not exhaustively labeled (e.g. FEP emits >1,500 values)"),
        rowScopedExhaustive: rowPrecision,
        labeledWithholdSpansCorrectlyHandled: ratio(withhold.filter((i) => i.correct).length, withhold.length),
        noiseTargetsSuppressed: ratio(noiseResults.filter((n) => !n.emitted).length, noiseResults.length),
      },
      valueCorrectness: {
        brochureDisplaySpansWithFigures: ratio(valueChecked.filter((i) => i.valueCorrect).length, valueChecked.length),
        valueTargetsGivenConceptFound: ratio(found.filter((t) => t.valueCorrect).length, found.length),
        valueTargets: ratio(allTargets.filter((t) => t.valueCorrect).length, allTargets.length),
      },
      qualifierCompleteness: {
        valueTargetsStructured: ratio(allTargets.filter((t) => t.qualifiersComplete).length, allTargets.length),
        brochureSpans: NOT_CALCULABLE("ground-truth.ts `applicability` is free text, not machine-checkable labels"),
      },
      citationCorrectness: {
        mechanicalVerification: "see documents[].emitted; raw→verified counts below",
        semanticOnTargets: ratio(found.filter((t) => t.citation?.tiesFigure && t.citation?.tiesQualifiers).length, found.length),
      },
      planAttribution: {
        crossDocumentAttributions: crossDocAttributions,
        nonVerbatimLineDisplays,
        verifiedClaims: {
          ...claimTally,
          unlabelledCount: claimTally.unlabelled.length,
          strictPrecision: ratio(claimTally.correct, claimTally.correct + claimTally["concept-adjacent"] + claimTally["missing-qualifier"] + claimTally["wrong-concept"] + claimTally.incorrect),
          incorrect: claimTally.incorrect,
        },
        brochureWithholdOrOptionalAttributed: withhold.filter((i) => /^(?:unsupported-attribution|optional-attributed-as-base)/.test(String(i.verdict))).length,
        brochureDisplaySpansAttributed: ratio(display.filter((i) => i.attributed).length, display.filter((i) => i.correct).length),
        planValueTargetsCorrectlyAttributed: ratio(planTargets.filter((t) => t.attribution.startsWith("correct")).length, planTargets.length),
        wrongAttributions: allTargets.filter((t) => t.attribution.startsWith("WRONG")).map((t) => t.id),
      },
      missingImportantFacts: allTargets.filter((t) => !t.valueCorrect).map((t): { id: string; importance: string; verdict: string } => ({ id: t.id, importance: t.importance, verdict: t.verdict }))
        .concat(display.filter((i) => !i.correct).map((i) => ({ id: String(i.id), importance: "brochure-display", verdict: String(i.verdict) }))),
    },
    valueTargets: allTargets,
    noiseTargets: noiseResults,
    brochureSpans: brochureItems,
  };

  // Mechanical citation counts per session (recomputed cheaply for the report).
  const mech: Record<string, unknown> = {};
  for (const session of sessions) {
    const members = CORPUS.filter((c) => c.session === session);
    if (members.some((m) => !loaded.has(m.key))) continue;
    const s = rawCitationStats(members.map((m) => loaded.get(m.key)!.doc));
    mech[session] = { ...s, rate: ratio(s.verified, s.citations).value };
  }
  (scorecard.metrics.citationCorrectness as Record<string, unknown>).mechanicalVerification = mech;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(scorecard, null, 2));
  printSummary(scorecard);
  console.log(`\nJSON scorecard: ${outPath}`);
}

function fmt(r: { n: number; d: number; value: number | null }) {
  return `${r.n}/${r.d}${r.value === null ? "" : ` (${(r.value * 100).toFixed(1)}%)`}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printSummary(s: any) {
  const m = s.metrics;
  console.log("===== EXTRACTION QUALITY SCORECARD (deterministic baseline) =====");
  for (const sk of s.skipped) console.log(`SKIPPED ${sk.key}: ${sk.reason}`);
  console.log("\n-- documents --");
  for (const d of s.documents) {
    console.log(`${d.key.padEnd(13)} pages=${d.pages} values=${d.emitted.values} rows=${d.emitted.rowsPopulated} attributed=${d.emitted.attributed} dupAcrossRows=${d.emitted.duplicateValuesAcrossRows} role=${d.role.correct ? "OK" : "WRONG"} identity=${d.planIdentity.correct ? "OK" : `WRONG(${JSON.stringify(d.planIdentity.attested)})`} tocFlags=${d.noiseHeuristic.tableOfContents} defFlags=${d.noiseHeuristic.educationalDefinition}`);
  }
  console.log("\n-- metrics --");
  console.log(`document role (proxy)            ${fmt(m.documentRole.measured)}`);
  console.log(`plan identity                    ${fmt(m.planIdentity.measured)}`);
  console.log(`concept recall: brochure spans   ${fmt(m.factConceptRecall.brochureDisplaySpans)}  (in-inventory ${fmt(m.factConceptRecall.brochureDisplaySpansInInventory)})`);
  console.log(`concept recall: value targets    ${fmt(m.factConceptRecall.valueTargets)}  (critical ${fmt(m.factConceptRecall.criticalValueTargets)})`);
  console.log(`precision corpus-wide            NOT_CALCULABLE — ${m.factConceptPrecision.corpusWide.reason}`);
  for (const [k, v] of Object.entries(m.factConceptPrecision.rowScopedExhaustive)) console.log(`precision ${k.padEnd(23)}${fmt(v as never)}`);
  console.log(`withhold/optional spans handled  ${fmt(m.factConceptPrecision.labeledWithholdSpansCorrectlyHandled)}`);
  console.log(`noise targets suppressed         ${fmt(m.factConceptPrecision.noiseTargetsSuppressed)}`);
  console.log(`value correct: brochure figures  ${fmt(m.valueCorrectness.brochureDisplaySpansWithFigures)}`);
  console.log(`value correct: value targets     ${fmt(m.valueCorrectness.valueTargets)}  (given concept found ${fmt(m.valueCorrectness.valueTargetsGivenConceptFound)})`);
  console.log(`qualifiers complete (targets)    ${fmt(m.qualifierCompleteness.valueTargetsStructured)}`);
  console.log(`qualifiers complete (brochures)  NOT_CALCULABLE — ${m.qualifierCompleteness.brochureSpans.reason}`);
  for (const [k, v] of Object.entries(m.citationCorrectness.mechanicalVerification)) {
    const x = v as { verified: number; citations: number; rawValues: number };
    console.log(`citations mechanical ${k.padEnd(12)}${x.verified}/${x.citations} verified (raw values ${x.rawValues})`);
  }
  console.log(`citations semantic (targets)     ${fmt(m.citationCorrectness.semanticOnTargets)}`);
  console.log(`cross-document attributions      ${m.planAttribution.crossDocumentAttributions}`);
  console.log(`non-verbatim line displays       ${m.planAttribution.nonVerbatimLineDisplays}`);
  const vc = m.planAttribution.verifiedClaims;
  console.log(`verified-plan claims (labelled)   correct ${vc.correct} / concept-adjacent ${vc["concept-adjacent"]} / MISSING-QUALIFIER ${vc["missing-qualifier"]} / WRONG-CONCEPT ${vc["wrong-concept"]} / INCORRECT ${vc.incorrect} / UNLABELLED ${vc.unlabelledCount}`);
  for (const k of vc.unlabelled.slice(0, 20)) console.log(`  UNLABELLED ${k.slice(0, 150)}`);
  console.log(`brochure withhold attributed     ${m.planAttribution.brochureWithholdOrOptionalAttributed}`);
  console.log(`plan value targets attributed OK ${fmt(m.planAttribution.planValueTargetsCorrectlyAttributed)}`);
  console.log("\n-- value targets --");
  for (const t of s.valueTargets) {
    console.log(`${t.id.padEnd(32)} ${t.verdict.padEnd(10)} quals=${t.qualifiersComplete ? "complete" : `missing[${t.qualifiersMissing.join(",")}]`}${t.qualifiersPresentInDisplayOnly.length ? ` displayOnly[${t.qualifiersPresentInDisplayOnly.join(",")}]` : ""}${t.forbiddenQualifiersPresent.length ? ` LEAK[${t.forbiddenQualifiersPresent}]` : ""} cite=${t.citation ? `p${t.citation.page} fig=${t.citation.tiesFigure} qual=${t.citation.tiesQualifiers}` : "-"} attr=${t.attribution} cands=${t.candidateCount}`);
  }
  console.log("\n-- noise targets --");
  for (const n of s.noiseTargets) console.log(`${n.id.padEnd(24)} ${n.emitted ? `EMITTED in ${n.rows.join(",")}${n.attributed ? " (ATTRIBUTED)" : ""}` : "suppressed"}`);
  console.log("\n-- missing important facts --");
  for (const x of m.missingImportantFacts) console.log(`${x.id} [${x.importance}] ${x.verdict}`);
}

void main().catch((err) => {
  console.error("scorecard failed:", err);
  process.exit(1);
});
