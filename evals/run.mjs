// R0 metric runner (todo 8): Recall@5/10, MRR@5/10, refusal accuracy for the
// CURRENT line-overlap retriever (app/lib/rag/answer.ts:60-82).
//
// SPLIT RULE (deterministic, stratified): the 30 golden items form 5 subsets
// (answerable / paraphrase / multi-doc / distractor / must-refuse) x 6 items.
// Within each subset, items sorted by id: first 2 -> dev, next 2 ->
// validation, last 2 -> test. Each partition therefore holds all five
// subsets (2 items each = 10 items per file).
// FROZEN DATASET SHAS (todo 7; any later change = versioned files + re-baseline):
//   dev        40bd26510a6e75e7cd08918a1f2eaa18470bd2a26e4e4a181a566942b84ecdfc
//   validation d401f9d377f376bb7a9f0785c5ebd0b2c0330bd49c22319d1cc3169569929341
//   test       4224d90c6d936089da8fedf3a793be761f65a34263784aa1f52ea4bcad9a09d5
// HARD INVARIANT: TEST is loadable/listable but EXCLUDED from default
// scoring output. First TEST scoring happens at F1 (todo 49).
// --partition=test exists ONLY as the F1 escape hatch and is FORBIDDEN
// during R0. R0 records DEV + VALIDATION only, reported SEPARATELY with
// partition labels; VALIDATION/TEST items never leak into tuning output
// beyond these aggregate gate metrics.
//
// RETRIEVER MIRROR: run.mjs is dependency-free plain node, so it cannot
// import the TS retriever. tokens()/retrieveCorpus() below replicate the
// EXACT call path of retrieve() in app/lib/rag/answer.ts:60-82 (same
// stopwords, same token filter len>2, same overlap count, same
// sort-desc + slice). app/lib/rag/* is NEVER modified by this runner.
// CORPUS: fixture truth lines from scripts/gen-fixtures.ts (recorded in
// tests/fixtures/README.md); golden expected passages quote these lines
// verbatim, so every table value below is computed from retriever output.
//
// METRIC SEMANTICS (sentence-transformers InformationRetrievalEvaluator):
//   recall@K = |relevant hits in top-K| / |relevant|
//   MRR@K   = 1 / rank-of-first-relevant-hit-in-top-K (0 when no hit)
// Refusal: an item "refuses" iff retrieval is empty (zero overlap lines),
// exactly the answerQuestion() empty-passages branch. Refusal accuracy is
// computed over ALL items; recall/MRR over answerable items only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const SUBSETS = ["answerable", "paraphrase", "multi-doc", "distractor", "must-refuse"];
const PARTITIONS = ["dev", "validation", "test"];
const KS = [5, 10];

// ---------------------------------------------------------------- corpus
// Fixture truth (scripts/gen-fixtures.ts). documentId doubles as filename,
// matching golden `doc` fields.
const CORPUS = [
  {
    documentId: "plan-a.pdf",
    pages: [
      [
        "ACME HEALTH PLAN A - SUMMARY OF BENEFITS",
        "Annual deductible: $250 in-network / $500 out-of-network.",
        "Annual out-of-pocket maximum: $3,000 in-network.",
        "Emergency care copay: $100, waived if admitted.",
      ].join("\n"),
      [
        "Prescription coverage: covered at a reasonable cost.",
        "International student eligibility: must hold a valid F-1 visa.",
        "Network: Acme Preferred Provider Network applies.",
      ].join("\n"),
    ],
  },
  {
    documentId: "plan-b.pdf",
    pages: [
      [
        "ACME HEALTH PLAN B - SUMMARY OF BENEFITS",
        "Annual deductible: $250 in-network / $500 out-of-network.",
        "Annual out-of-pocket maximum: $4,500 in-network.",
        "Emergency care copay: $250 per visit.",
      ].join("\n"),
      [
        "Pre-existing conditions: covered after a 6-month waiting period.",
        "Network: Acme Preferred Provider Network applies.",
      ].join("\n"),
    ],
  },
];

// ------------------------------------------------------- retriever mirror
// Verbatim mirror of app/lib/rag/answer.ts:39-82 (STOPWORDS, tokens,
// retrieve). Keep in sync by eye; never import TS here (no dependencies).
const STOPWORDS = new Set(
  "a,an,the,of,in,on,for,to,is,are,was,were,be,been,do,does,did,what,which,who,how,much,many,my,our,your,this,that,these,those,and,or,with,by,at,from,as,it,its,plan,coverage,cover,covered".split(",")
);

function tokens(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function retrieveCorpus(documents, question, maxPassages = 3) {
  const q = tokens(question);
  if (q.size === 0) return [];
  const scored = [];
  for (const doc of documents) {
    doc.pages.forEach((pageText, i) => {
      for (const line of pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
        const lt = tokens(line);
        let overlap = 0;
        for (const w of q) if (lt.has(w)) overlap++;
        if (overlap > 0) {
          scored.push({ documentId: doc.documentId, page: i + 1, quote: line, score: overlap });
        }
      }
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, maxPassages);
}

// ---------------------------------------------------------------- loader
function loadPartition(name) {
  const file = join(DIR, `golden-${name}.json`);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`eval: cannot read ${file}: ${err.message}`);
  }
  let items;
  try {
    items = JSON.parse(raw);
  } catch (err) {
    throw new Error(`eval: ${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(items)) throw new Error(`eval: ${file} root must be an array`);
  items.forEach((it, i) => validateEntry(file, i, it));
  return items;
}

function validateEntry(file, i, it) {
  const label = `${file}#${i}${it && it.id ? ` (id=${it.id})` : ""}`;
  if (!it || typeof it !== "object") throw new Error(`eval: corrupt entry ${label}: must be an object`);
  if (typeof it.id !== "string" || !it.id) throw new Error(`eval: corrupt entry ${label}: missing id`);
  if (!SUBSETS.includes(it.subset))
    throw new Error(`eval: corrupt entry ${label}: subset must be one of ${SUBSETS.join(", ")}`);
  if (typeof it.question !== "string" || !it.question.trim())
    throw new Error(`eval: corrupt entry ${label}: missing question`);
  if (it.mustRefuse === true) return;
  if (!Array.isArray(it.expected) || it.expected.length === 0)
    throw new Error(`eval: corrupt entry ${label}: expected passages required or mustRefuse:true`);
  it.expected.forEach((ex, j) => {
    if (!ex || typeof ex.doc !== "string" || typeof ex.page !== "number" || typeof ex.passage !== "string" || !ex.passage.trim())
      throw new Error(`eval: corrupt entry ${label}: expected[${j}] needs {doc, page, passage}`);
  });
}

function subsetCounts(items) {
  const c = {};
  for (const s of SUBSETS) c[s] = 0;
  for (const it of items) c[it.subset] += 1;
  return c;
}

// ---------------------------------------------------------------- metrics
function norm(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function passageKey(doc, page, passage) {
  return `${doc}#${page}#${norm(passage)}`;
}

function expectedKeys(it) {
  return it.expected.map((ex) => passageKey(ex.doc, ex.page, ex.passage));
}

function retrievedKeys(question, k) {
  return retrieveCorpus(CORPUS, question, k).map((p) =>
    passageKey(p.documentId, p.page, p.quote)
  );
}

// recall@K = |relevant hits in top-K| / |relevant|.
function computeRecallAtK(ranked, relevant, k) {
  if (relevant.length === 0) return 0;
  const rel = new Set(relevant);
  let hits = 0;
  for (const key of ranked.slice(0, k)) if (rel.has(key)) hits++;
  return hits / relevant.length;
}

// MRR@K = 1 / rank-of-first-relevant-hit-in-top-K (0 when no hit).
function computeMrrAtK(ranked, relevant, k) {
  const rel = new Set(relevant);
  const top = ranked.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (rel.has(top[i])) return 1 / (i + 1);
  }
  return 0;
}

// Pure refusal roll-up for self-test + partition scoring.
function refusalStats(pairs) {
  // pairs: [{ refused: boolean, mustRefuse: boolean }]
  let correct = 0;
  let falseRefusals = 0;
  let falseAcceptances = 0;
  for (const p of pairs) {
    if (p.mustRefuse && p.refused) correct++;
    else if (!p.mustRefuse && !p.refused) correct++;
    else if (!p.mustRefuse && p.refused) falseRefusals++;
    else falseAcceptances++;
  }
  return {
    accuracy: pairs.length === 0 ? 0 : correct / pairs.length,
    falseRefusals,
    falseAcceptances,
  };
}

function scorePartition(items) {
  const perSubset = {};
  for (const s of SUBSETS) perSubset[s] = { n: 0, answerable: 0, recall5: 0, recall10: 0, mrr5: 0, mrr10: 0 };
  let answerable = 0;
  let sumR5 = 0;
  let sumR10 = 0;
  let sumM5 = 0;
  let sumM10 = 0;
  const pairs = [];
  for (const it of items) {
    const mustRefuse = it.mustRefuse === true;
    const ranked10 = retrievedKeys(it.question, 10);
    const refused = ranked10.length === 0;
    pairs.push({ refused, mustRefuse });
    const cell = perSubset[it.subset];
    cell.n++;
    if (!mustRefuse) {
      const rel = expectedKeys(it);
      const r5 = computeRecallAtK(ranked10, rel, 5);
      const r10 = computeRecallAtK(ranked10, rel, 10);
      const m5 = computeMrrAtK(ranked10, rel, 5);
      const m10 = computeMrrAtK(ranked10, rel, 10);
      answerable++;
      sumR5 += r5;
      sumR10 += r10;
      sumM5 += m5;
      sumM10 += m10;
      cell.answerable++;
      cell.recall5 += r5;
      cell.recall10 += r10;
      cell.mrr5 += m5;
      cell.mrr10 += m10;
    }
  }
  const refusal = refusalStats(pairs);
  const mean = (s) => (answerable === 0 ? 0 : s / answerable);
  const cellMean = (cell) => ({
    n: cell.n,
    answerable: cell.answerable,
    recall5: cell.answerable === 0 ? 0 : cell.recall5 / cell.answerable,
    recall10: cell.answerable === 0 ? 0 : cell.recall10 / cell.answerable,
    mrr5: cell.answerable === 0 ? 0 : cell.mrr5 / cell.answerable,
    mrr10: cell.answerable === 0 ? 0 : cell.mrr10 / cell.answerable,
  });
  return {
    n: items.length,
    answerable,
    recall5: mean(sumR5),
    recall10: mean(sumR10),
    mrr5: mean(sumM5),
    mrr10: mean(sumM10),
    refusalAccuracy: refusal.accuracy,
    falseRefusals: refusal.falseRefusals,
    falseAcceptances: refusal.falseAcceptances,
    perSubset: Object.fromEntries(Object.entries(perSubset).map(([s, c]) => [s, cellMean(c)])),
  };
}

function fmt(x) {
  return x.toFixed(4);
}

function printTable(partition, r) {
  console.log(`partition=${partition} n=${r.n} answerable=${r.answerable}`);
  console.log(`overall recall@5=${fmt(r.recall5)} recall@10=${fmt(r.recall10)} mrr@5=${fmt(r.mrr5)} mrr@10=${fmt(r.mrr10)}`);
  console.log(
    `overall refusal-accuracy=${fmt(r.refusalAccuracy)} false-refusals=${r.falseRefusals} false-acceptances=${r.falseAcceptances}`
  );
  for (const s of SUBSETS) {
    const c = r.perSubset[s];
    // must-refuse subsets have no answerable items: recall/MRR are n/a, never 0.
    const m = (x) => (c.answerable === 0 ? "n/a" : fmt(x));
    console.log(
      `  subset=${s} n=${c.n} answerable=${c.answerable} recall@5=${m(c.recall5)} recall@10=${m(c.recall10)} mrr@5=${m(c.mrr5)} mrr@10=${m(c.mrr10)}`
    );
  }
}

// -------------------------------------------------------------- self-test
function approx(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}

function runSelfTest() {
  const checks = [];
  const check = (name, actual, want) => {
    const ok = approx(actual, want);
    checks.push({ name, actual, want, ok });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: got=${actual} want=${want}`);
  };

  // Perfect ranking scores 1.0.
  const rel2 = ["A", "B"];
  const perfect = ["A", "B", "C"];
  check("perfect recall@5", computeRecallAtK(perfect, rel2, 5), 1.0);
  check("perfect recall@10", computeRecallAtK(perfect, rel2, 10), 1.0);
  check("perfect mrr@5", computeMrrAtK(perfect, rel2, 5), 1.0);
  check("perfect mrr@10", computeMrrAtK(perfect, rel2, 10), 1.0);

  // Empty ranking scores 0.0 without crash.
  check("empty recall@5", computeRecallAtK([], ["A"], 5), 0.0);
  check("empty recall@10", computeRecallAtK([], ["A"], 10), 0.0);
  check("empty mrr@5", computeMrrAtK([], ["A"], 5), 0.0);
  check("empty mrr@10", computeMrrAtK([], ["A"], 10), 0.0);

  // Mixed ranking, hand-computed: relevant={A,B,C}, ranked=[X,B,Y,A].
  // Recall@5 = 2/3, MRR@5 = 1/2 (first hit B at rank 2).
  // Recall@2 = 1/3, MRR@2 = 1/2.
  const rel3 = ["A", "B", "C"];
  const mixed = ["X", "B", "Y", "A"];
  check("mixed recall@5", computeRecallAtK(mixed, rel3, 5), 2 / 3);
  check("mixed mrr@5", computeMrrAtK(mixed, rel3, 5), 1 / 2);
  check("mixed recall@2", computeRecallAtK(mixed, rel3, 2), 1 / 3);
  check("mixed mrr@2", computeMrrAtK(mixed, rel3, 2), 1 / 2);

  // Miss within K: first hit beyond K scores 0 for MRR@K and is cut from recall@K.
  check("beyond-K recall@2", computeRecallAtK(["X", "Y", "A"], ["A"], 2), 0.0);
  check("beyond-K mrr@2", computeMrrAtK(["X", "Y", "A"], ["A"], 2), 0.0);
  check("beyond-K recall@3", computeRecallAtK(["X", "Y", "A"], ["A"], 3), 1.0);
  check("beyond-K mrr@3", computeMrrAtK(["X", "Y", "A"], ["A"], 3), 1 / 3);

  // Refusal roll-up: 1 true-refusal, 1 true-answer, 1 false-refusal, 1 false-acceptance.
  const rs = refusalStats([
    { refused: true, mustRefuse: true },
    { refused: false, mustRefuse: false },
    { refused: true, mustRefuse: false },
    { refused: false, mustRefuse: true },
  ]);
  check("refusal accuracy", rs.accuracy, 0.5);
  check("refusal false-refusals", rs.falseRefusals, 1);
  check("refusal false-acceptances", rs.falseAcceptances, 1);

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`self-test: ${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) {
    console.error(`self-test FAILED (${failed} checks)`);
    process.exitCode = 1;
  }
  return { checks, failed };
}

// ------------------------------------------------- real-doc benchmark
// R0 real-document benchmark (todo 52): SECOND optional benchmark over the
// three local PDFs (patriot-exchange-brochure.pdf,
// patriot-travel-brochure-2026-dynamic.pdf, OPTima_26_27_A.pdf). Scores ONLY
// when REAL_PDFS_DIR contains all three files, else prints SKIP (never fake
// zeros, never fails). PDFs are never committed; only questions/metadata in
// evals/realbench/ are tracked. Retrieval mirror (tokens/retrieveCorpus) is
// shared with the fixture path above; matching is normalized containment of
// the verified anchor inside a retrieved line (anchors are verbatim
// single-line substrings of extractPages() output).

const REAL_FILES = [
  "patriot-exchange-brochure.pdf",
  "patriot-travel-brochure-2026-dynamic.pdf",
  "OPTima_26_27_A.pdf",
];

function loadRealbench(name) {
  const file = join(DIR, "realbench", name);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`eval: cannot read ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`eval: ${file} is not valid JSON: ${err.message}`);
  }
}

async function extractRealCorpus(dir) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const docs = [];
  for (const f of REAL_FILES) {
    const buf = readFileSync(join(dir, f));
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t) =>
      typeof t === "string" ? t : String(t ?? "")
    );
    docs.push({ documentId: f, pages });
  }
  return docs;
}

function scoreRealbench(documents, questions, expected) {
  const byId = new Map();
  for (const ex of expected) {
    if (!ex || typeof ex.id !== "string" || typeof ex.file !== "string" ||
        typeof ex.page !== "number" || typeof ex.anchor !== "string" || !ex.anchor.trim())
      throw new Error(`eval: corrupt realbench expected entry ${JSON.stringify(ex)}`);
    if (!byId.has(ex.id)) byId.set(ex.id, []);
    byId.get(ex.id).push(ex);
  }
  const perQuestion = [];
  let sumR5 = 0;
  let sumR10 = 0;
  let sumM5 = 0;
  let sumM10 = 0;
  let answerable = 0;
  for (const q of questions) {
    const exs = byId.get(q.id) ?? [];
    if (exs.length === 0) throw new Error(`eval: realbench question ${q.id} has no expected entries`);
    const ranked = retrieveCorpus(documents, q.question, 10);
    const norms = ranked.map((p) => norm(p.quote));
    const anchorNorms = exs.map((e) => norm(e.anchor));
    // recall@K = fraction of expected anchors contained in top-K lines.
    const recallAt = (k) => {
      const top = norms.slice(0, k);
      let hits = 0;
      for (const a of anchorNorms) if (top.some((line) => line.includes(a))) hits++;
      return anchorNorms.length === 0 ? 0 : hits / anchorNorms.length;
    };
    // MRR@K = 1 / rank of first line containing any expected anchor.
    const mrrAt = (k) => {
      const top = norms.slice(0, k);
      for (let i = 0; i < top.length; i++) {
        if (anchorNorms.some((a) => top[i].includes(a))) return 1 / (i + 1);
      }
      return 0;
    };
    const r = { id: q.id, r5: recallAt(5), r10: recallAt(10), m5: mrrAt(5), m10: mrrAt(10) };
    perQuestion.push(r);
    answerable++;
    sumR5 += r.r5;
    sumR10 += r.r10;
    sumM5 += r.m5;
    sumM10 += r.m10;
  }
  const mean = (s) => (answerable === 0 ? 0 : s / answerable);
  return { n: questions.length, recall5: mean(sumR5), recall10: mean(sumR10), mrr5: mean(sumM5), mrr10: mean(sumM10), perQuestion };
}

function printRealbench(r) {
  console.log(`realbench partition=real n=${r.n}`);
  console.log(`realbench overall recall@5=${fmt(r.recall5)} recall@10=${fmt(r.recall10)} mrr@5=${fmt(r.mrr5)} mrr@10=${fmt(r.mrr10)}`);
  for (const q of r.perQuestion) {
    console.log(`  realbench question=${q.id} recall@5=${fmt(q.r5)} recall@10=${fmt(q.r10)} mrr@5=${fmt(q.m5)} mrr@10=${fmt(q.m10)}`);
  }
}

async function runRealBench() {
  const dir = process.env.REAL_PDFS_DIR;
  if (!dir) {
    console.log("realbench: SKIP (REAL_PDFS_DIR unset; supply a dir containing all three PDFs to score)");
    return;
  }
  const missing = [];
  for (const f of REAL_FILES) {
    try {
      readFileSync(join(dir, f));
    } catch {
      missing.push(f);
    }
  }
  if (missing.length > 0) {
    console.log(`realbench: SKIP (missing ${missing.join(", ")} in REAL_PDFS_DIR=${dir})`);
    return;
  }
  const questions = loadRealbench("questions.json");
  const expected = loadRealbench("expected.json");
  const documents = await extractRealCorpus(dir);
  const pages = documents.reduce((n, d) => n + d.pages.length, 0);
  console.log(`realbench: corpus=${documents.length} files pages=${pages} dir=${dir}`);
  printRealbench(scoreRealbench(documents, questions, expected));
}

// ------------------------------------------------- chunk baseline
// R1 chunk-based second baseline (todo 14): MEASUREMENT ONLY. retrieve()
// ranking in app/lib/rag/answer.ts is UNCHANGED — this flag re-uses the
// EXACT same tokens()/overlap/sort-desc scoring, only the retrieval UNIT
// changes from lines to page-preserving chunks (mirror of
// app/lib/rag/chunks.ts chunkDocument with 512/64 whitespace tokens, never
// crossing page boundaries). Fixture pages are tiny, so every page yields
// exactly one chunk (4 chunks total); the inventory line proves it.
//
// WHAT THE CHUNK NUMBERS MEAN vs THE LINE NUMBERS: line recall/MRR score
// exact-line units (a hit needs the expected line ranked top-K); chunk
// recall/MRR score page-chunk units (a hit needs any chunk CONTAINING the
// expected passage ranked top-K — normalized containment, same norm()).
// Chunk units are coarser, so chunk scores are an upper-envelope view of the
// same ranking behavior, NOT a new ranker. Refusal is identical by
// construction (chunk tokens = union of line tokens, so empty chunk
// retrieval <=> empty line retrieval). Default output (no flag) is
// byte-identical to R0; this path only runs with --granularity=chunk and
// never scores TEST (DEV + VALIDATION only).

const CHUNK_TARGET_TOKENS = 512;
const CHUNK_OVERLAP_TOKENS = 64;

function chunkPageMirror(documentId, page, pageText, target = CHUNK_TARGET_TOKENS, overlap = CHUNK_OVERLAP_TOKENS) {
  const spans = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(pageText)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  if (spans.length === 0) return [];
  const chunks = [];
  const step = target - overlap;
  let order = 0;
  for (let start = 0; start < spans.length; start += step, order++) {
    const window = spans.slice(start, start + target);
    const begin = window[0].start;
    const end = window[window.length - 1].end;
    chunks.push({
      documentId,
      page,
      order,
      text: pageText.slice(begin, end),
    });
    if (start + target >= spans.length) break;
  }
  return chunks;
}

function chunkCorpusMirror(documents) {
  return documents.flatMap((doc) =>
    doc.pages.flatMap((pageText, i) => chunkPageMirror(doc.documentId, i + 1, pageText))
  );
}

function chunkKey(c) {
  return `${c.documentId}#${c.page}#${c.order}`;
}

// Same ranking behavior as retrieveCorpus: same tokens(), same overlap
// count, same sort-desc + slice. Only the unit differs (chunk vs line).
function retrieveChunks(chunks, question, maxPassages = 10) {
  const q = tokens(question);
  if (q.size === 0) return [];
  const scored = [];
  for (const c of chunks) {
    const ct = tokens(c.text);
    let overlap = 0;
    for (const w of q) if (ct.has(w)) overlap++;
    if (overlap > 0) {
      scored.push({ ...c, score: overlap });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, maxPassages);
}

// An expected passage maps to every same-doc+page chunk whose normalized
// text contains it (with 1 chunk/page this is exactly one chunk).
function expectedChunkKeys(item, chunks) {
  return item.expected.flatMap((ex) => {
    const anchor = norm(ex.passage);
    return chunks
      .filter((c) => c.documentId === ex.doc && c.page === ex.page && norm(c.text).includes(anchor))
      .map(chunkKey);
  });
}

function scorePartitionChunks(items, chunks) {
  const perSubset = {};
  for (const s of SUBSETS) perSubset[s] = { n: 0, answerable: 0, recall5: 0, recall10: 0, mrr5: 0, mrr10: 0 };
  let answerable = 0;
  let sumR5 = 0;
  let sumR10 = 0;
  let sumM5 = 0;
  let sumM10 = 0;
  const pairs = [];
  for (const it of items) {
    const mustRefuse = it.mustRefuse === true;
    const ranked10 = retrieveChunks(chunks, it.question, 10).map(chunkKey);
    const refused = ranked10.length === 0;
    pairs.push({ refused, mustRefuse });
    const cell = perSubset[it.subset];
    cell.n++;
    if (!mustRefuse) {
      const rel = expectedChunkKeys(it, chunks);
      const r5 = computeRecallAtK(ranked10, rel, 5);
      const r10 = computeRecallAtK(ranked10, rel, 10);
      const m5 = computeMrrAtK(ranked10, rel, 5);
      const m10 = computeMrrAtK(ranked10, rel, 10);
      answerable++;
      sumR5 += r5;
      sumR10 += r10;
      sumM5 += m5;
      sumM10 += m10;
      cell.answerable++;
      cell.recall5 += r5;
      cell.recall10 += r10;
      cell.mrr5 += m5;
      cell.mrr10 += m10;
    }
  }
  const refusal = refusalStats(pairs);
  const mean = (s) => (answerable === 0 ? 0 : s / answerable);
  const cellMean = (cell) => ({
    n: cell.n,
    answerable: cell.answerable,
    recall5: cell.answerable === 0 ? 0 : cell.recall5 / cell.answerable,
    recall10: cell.answerable === 0 ? 0 : cell.recall10 / cell.answerable,
    mrr5: cell.answerable === 0 ? 0 : cell.mrr5 / cell.answerable,
    mrr10: cell.answerable === 0 ? 0 : cell.mrr10 / cell.answerable,
  });
  return {
    n: items.length,
    answerable,
    recall5: mean(sumR5),
    recall10: mean(sumR10),
    mrr5: mean(sumM5),
    mrr10: mean(sumM10),
    refusalAccuracy: refusal.accuracy,
    falseRefusals: refusal.falseRefusals,
    falseAcceptances: refusal.falseAcceptances,
    perSubset: Object.fromEntries(Object.entries(perSubset).map(([s, c]) => [s, cellMean(c)])),
  };
}

function printChunkTable(partition, r) {
  console.log(`chunk partition=${partition} n=${r.n} answerable=${r.answerable}`);
  console.log(`chunk overall recall@5=${fmt(r.recall5)} recall@10=${fmt(r.recall10)} mrr@5=${fmt(r.mrr5)} mrr@10=${fmt(r.mrr10)}`);
  console.log(
    `chunk overall refusal-accuracy=${fmt(r.refusalAccuracy)} false-refusals=${r.falseRefusals} false-acceptances=${r.falseAcceptances}`
  );
  for (const s of SUBSETS) {
    const c = r.perSubset[s];
    const m = (x) => (c.answerable === 0 ? "n/a" : fmt(x));
    console.log(
      `  chunk subset=${s} n=${c.n} answerable=${c.answerable} recall@5=${m(c.recall5)} recall@10=${m(c.recall10)} mrr@5=${m(c.mrr5)} mrr@10=${m(c.mrr10)}`
    );
  }
}

function runChunkBaseline(parts) {
  const chunks = chunkCorpusMirror(CORPUS);
  const pages = CORPUS.reduce((n, d) => n + d.pages.length, 0);
  console.log(
    `chunkconfig target=${CHUNK_TARGET_TOKENS} overlap=${CHUNK_OVERLAP_TOKENS} chunks=${chunks.length} pages=${pages}`
  );
  printChunkTable("dev", scorePartitionChunks(parts.dev, chunks));
  printChunkTable("validation", scorePartitionChunks(parts.validation, chunks));
  console.log(`chunk test: ${parts.test.length} items FROZEN, unscored until F1 (todo 49)`);
}

// ------------------------------------------------- BM25 baseline
// R2 BM25-over-chunks measurement (todo 17): MEASUREMENT ONLY. Mirrors the
// EXACT ranking of retrieve() in app/lib/rag/answer.ts (same stopwords, same
// token filter len>2, k1=1.2 b=0.75 fixed, natural-log IDF floored at 0,
// same deterministic tie-break documentId/page/order, same empty->[]
// contract), only re-implemented dependency-free in plain node. Retrieval
// unit is the R1 chunk (chunkPageMirror 512/64, never crossing pages).
// Chunk-unit scoring (containment, same norm()) matches the R1 chunk
// baseline; refusal is empty BM25 retrieval. Default output (no flag) is
// byte-identical to R0/R1; this path only runs with --retriever=bm25 and
// never scores TEST (DEV + VALIDATION only). Keep/revert SURVIVOR decision
// is todo 20's job, NOT this todo's.

const BM25_K1 = 1.2;
const BM25_B = 0.75;

function termFreqsMirror(text) {
  const tf = new Map();
  for (const w of text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))) {
    tf.set(w, (tf.get(w) ?? 0) + 1);
  }
  return tf;
}

// Same ranking behavior as retrieve() in app/lib/rag/answer.ts. Only the
// chunk identity differs (mirror chunks lack content-hash IDs; ordering by
// documentId/page/order is identical and deterministic).
function retrieveBm25(chunks, question, maxPassages = 10) {
  const q = tokens(question);
  if (q.size === 0) return [];
  if (chunks.length === 0) return [];
  const tfs = chunks.map((c) => termFreqsMirror(c.text));
  const dls = tfs.map((tf) => [...tf.values()].reduce((n, v) => n + v, 0));
  const avgdl = dls.reduce((n, v) => n + v, 0) / dls.length;
  if (avgdl === 0) return [];
  const df = new Map();
  for (const term of q) {
    let n = 0;
    for (const tf of tfs) if (tf.has(term)) n++;
    df.set(term, n);
  }
  const scored = [];
  chunks.forEach((c, i) => {
    let score = 0;
    for (const term of q) {
      const tf = tfs[i].get(term) ?? 0;
      if (tf === 0) continue;
      const idf = Math.max(0, Math.log(1 + (chunks.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5)));
      score += (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * dls[i]) / avgdl));
    }
    if (score > 0) scored.push({ ...c, score });
  });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0) ||
        a.page - b.page ||
        a.order - b.order
    )
    .slice(0, maxPassages);
}

function scorePartitionBm25(items, chunks) {
  const perSubset = {};
  for (const s of SUBSETS) perSubset[s] = { n: 0, answerable: 0, recall5: 0, recall10: 0, mrr5: 0, mrr10: 0 };
  let answerable = 0;
  let sumR5 = 0;
  let sumR10 = 0;
  let sumM5 = 0;
  let sumM10 = 0;
  const pairs = [];
  for (const it of items) {
    const mustRefuse = it.mustRefuse === true;
    const ranked10 = retrieveBm25(chunks, it.question, 10).map(chunkKey);
    const refused = ranked10.length === 0;
    pairs.push({ refused, mustRefuse });
    const cell = perSubset[it.subset];
    cell.n++;
    if (!mustRefuse) {
      const rel = expectedChunkKeys(it, chunks);
      const r5 = computeRecallAtK(ranked10, rel, 5);
      const r10 = computeRecallAtK(ranked10, rel, 10);
      const m5 = computeMrrAtK(ranked10, rel, 5);
      const m10 = computeMrrAtK(ranked10, rel, 10);
      answerable++;
      sumR5 += r5;
      sumR10 += r10;
      sumM5 += m5;
      sumM10 += m10;
      cell.answerable++;
      cell.recall5 += r5;
      cell.recall10 += r10;
      cell.mrr5 += m5;
      cell.mrr10 += m10;
    }
  }
  const refusal = refusalStats(pairs);
  const mean = (s) => (answerable === 0 ? 0 : s / answerable);
  const cellMean = (cell) => ({
    n: cell.n,
    answerable: cell.answerable,
    recall5: cell.answerable === 0 ? 0 : cell.recall5 / cell.answerable,
    recall10: cell.answerable === 0 ? 0 : cell.recall10 / cell.answerable,
    mrr5: cell.answerable === 0 ? 0 : cell.mrr5 / cell.answerable,
    mrr10: cell.answerable === 0 ? 0 : cell.mrr10 / cell.answerable,
  });
  return {
    n: items.length,
    answerable,
    recall5: mean(sumR5),
    recall10: mean(sumR10),
    mrr5: mean(sumM5),
    mrr10: mean(sumM10),
    refusalAccuracy: refusal.accuracy,
    falseRefusals: refusal.falseRefusals,
    falseAcceptances: refusal.falseAcceptances,
    perSubset: Object.fromEntries(Object.entries(perSubset).map(([s, c]) => [s, cellMean(c)])),
  };
}

function printBm25Table(partition, r) {
  console.log(`bm25 partition=${partition} n=${r.n} answerable=${r.answerable}`);
  console.log(`bm25 overall recall@5=${fmt(r.recall5)} recall@10=${fmt(r.recall10)} mrr@5=${fmt(r.mrr5)} mrr@10=${fmt(r.mrr10)}`);
  console.log(
    `bm25 overall refusal-accuracy=${fmt(r.refusalAccuracy)} false-refusals=${r.falseRefusals} false-acceptances=${r.falseAcceptances}`
  );
  for (const s of SUBSETS) {
    const c = r.perSubset[s];
    const m = (x) => (c.answerable === 0 ? "n/a" : fmt(x));
    console.log(
      `  bm25 subset=${s} n=${c.n} answerable=${c.answerable} recall@5=${m(c.recall5)} recall@10=${m(c.recall10)} mrr@5=${m(c.mrr5)} mrr@10=${m(c.mrr10)}`
    );
  }
}

function runBm25Baseline(parts) {
  const chunks = chunkCorpusMirror(CORPUS);
  console.log(
    `bm25config k1=${BM25_K1} b=${BM25_B} target=${CHUNK_TARGET_TOKENS} overlap=${CHUNK_OVERLAP_TOKENS} chunks=${chunks.length}`
  );
  printBm25Table("dev", scorePartitionBm25(parts.dev, chunks));
  printBm25Table("validation", scorePartitionBm25(parts.validation, chunks));
  console.log(`bm25 test: ${parts.test.length} items FROZEN, unscored until F1 (todo 49)`);
}

// ------------------------------------------------- semantic leg
// R3 semantic-only measurement (todo 24): MEASUREMENT ONLY, no fusion.
// Embeds the R1 fixture chunk corpus (chunkCorpusMirror, 4 chunks) + each
// DEV/VALIDATION question against a LOCAL Ollama OpenAI-compatible
// endpoint using the EXACT contract of app/lib/rag/embeddings.ts (POST
// {baseUrl}/embeddings {model, input}, batch size 32, retry on
// 408/409/429/500/502/503/504 up to 3 attempts with base delay 1500ms +
// retry-after, ragged-vector DimensionError), then ranks with the EXACT
// math of InMemoryCosineIndex (L2-normalize once at insert, normalize the
// query, dot product, tie-break chunkId/documentId/page, top-K slice).
// Chunk-unit scoring (containment, same norm()) matches R1/R2. Refusal is
// empty cosine retrieval — with a non-empty index cosine always ranks, so
// must-refuse items surface as false-acceptances; that is RECORDED, not
// tuned away (no similarity threshold exists in the app path and adding
// one here would be tuning against VALIDATION). Env is parsed from
// .env.local at runtime (dotenv-style, no dependency; process env wins);
// the API key value is NEVER printed. Missing config or an unreachable
// endpoint prints SKIP (never fake zeros) and never scores TEST (DEV +
// VALIDATION only). Default output (no flag) is byte-identical to
// R0/R1/R2; this path only runs with --leg=semantic.

const SEM_BATCH_SIZE = 32;
const SEM_MAX_ATTEMPTS = 3;
const SEM_BASE_DELAY_MS = 1500;
const SEM_RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

const semSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadEmbeddingEnv() {
  const fromFile = {};
  try {
    const raw = readFileSync(join(DIR, "..", ".env.local"), "utf8");
    for (const line of raw.split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      let v = t.slice(eq + 1).trim();
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        v = v.slice(1, -1);
      }
      fromFile[t.slice(0, eq).trim()] = v;
    }
  } catch {
    // No .env.local: fall back to process env only.
  }
  const baseUrl = process.env.EMBEDDING_BASE_URL ?? fromFile.EMBEDDING_BASE_URL;
  const apiKey = process.env.EMBEDDING_API_KEY ?? fromFile.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL ?? fromFile.EMBEDDING_MODEL ?? "default";
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model };
}

function parseSemBatchVectors(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("semantic leg: embedding response malformed: not an object");
  }
  const data = payload.data;
  if (!Array.isArray(data)) {
    throw new Error("semantic leg: embedding response malformed: data[] missing");
  }
  return data.map((item, i) => {
    const vec = item?.embedding;
    if (!Array.isArray(vec) || vec.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(`semantic leg: data[${i}].embedding must be number[]`);
    }
    return vec;
  });
}

async function semPostBatch(config, input) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;
  let res;
  for (let attempt = 1; attempt <= SEM_MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input }),
    });
    if (res.ok || !SEM_RETRYABLE.has(res.status) || attempt === SEM_MAX_ATTEMPTS) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : SEM_BASE_DELAY_MS * 2 ** (attempt - 1);
    console.warn(`semantic leg: status ${res.status}; retrying in ${delay}ms (attempt ${attempt}/${SEM_MAX_ATTEMPTS})`);
    await semSleep(delay);
  }
  if (!res || !res.ok) {
    throw new Error(`semantic leg: embedding request failed with status ${res?.status ?? "unknown"}`);
  }
  return parseSemBatchVectors(await res.json());
}

// Same batching + dimension validation as embedTexts() in
// app/lib/rag/embeddings.ts. Returns { vectors, dims }.
async function semEmbedTexts(config, texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += SEM_BATCH_SIZE) {
    const batch = await semPostBatch(config, texts.slice(i, i + SEM_BATCH_SIZE));
    out.push(...batch);
  }
  if (out.length === 0) return { vectors: out, dims: null };
  const expected = out[0].length;
  for (const vec of out) {
    if (vec.length !== expected) {
      throw new Error(`semantic leg: DimensionError expected ${expected}, received ${vec.length}`);
    }
  }
  return { vectors: out, dims: expected };
}

function semNormOf(vector) {
  let sum = 0;
  for (const n of vector) sum += n * n;
  return Math.sqrt(sum);
}

function semNormalize(vector) {
  const norm = semNormOf(vector);
  if (norm === 0) return vector.slice();
  return vector.map((n) => n / norm);
}

// Same ranking math as InMemoryCosineIndex.searchWithRanks(): normalized
// exhaustive cosine, tie-break chunkId/documentId/page, top-K slice.
// Mirror chunks carry chunkId = doc#page#order (deterministic; the app's
// content-hash IDs order identically within this corpus).
function retrieveCosine(entries, dims, query, topK) {
  if (entries.length === 0) return [];
  if (query.length !== dims) {
    throw new Error(`semantic leg: DimensionError expected ${dims}, received ${query.length}`);
  }
  const qn = semNormalize(query);
  const scored = entries.map((e) => {
    let dot = 0;
    for (let i = 0; i < qn.length; i++) dot += qn[i] * e.norm[i];
    return { chunk: e.chunk, score: dot };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.chunk.chunkId < b.chunk.chunkId ? -1 : a.chunk.chunkId > b.chunk.chunkId ? 1 : 0) ||
      (a.chunk.documentId < b.chunk.documentId ? -1 : a.chunk.documentId > b.chunk.documentId ? 1 : 0) ||
      a.chunk.page - b.chunk.page
  );
  const k = Math.max(0, Math.min(topK, scored.length));
  return scored.slice(0, k);
}

function scorePartitionSemantic(items, chunks, entries, dims, questionVectors) {
  const perSubset = {};
  for (const s of SUBSETS) perSubset[s] = { n: 0, answerable: 0, recall5: 0, recall10: 0, mrr5: 0, mrr10: 0 };
  let answerable = 0;
  let sumR5 = 0;
  let sumR10 = 0;
  let sumM5 = 0;
  let sumM10 = 0;
  const pairs = [];
  const detail = [];
  for (const it of items) {
    const mustRefuse = it.mustRefuse === true;
    const ranked = retrieveCosine(entries, dims, questionVectors.get(it.id), 10);
    const ranked10 = ranked.map((r) => chunkKey(r.chunk));
    const refused = ranked10.length === 0;
    pairs.push({ refused, mustRefuse });
    detail.push({
      id: it.id,
      top: ranked.slice(0, 3).map((r) => `${chunkKey(r.chunk)}@${r.score.toFixed(4)}`),
    });
    const cell = perSubset[it.subset];
    cell.n++;
    if (!mustRefuse) {
      const rel = expectedChunkKeys(it, chunks);
      const r5 = computeRecallAtK(ranked10, rel, 5);
      const r10 = computeRecallAtK(ranked10, rel, 10);
      const m5 = computeMrrAtK(ranked10, rel, 5);
      const m10 = computeMrrAtK(ranked10, rel, 10);
      answerable++;
      sumR5 += r5;
      sumR10 += r10;
      sumM5 += m5;
      sumM10 += m10;
      cell.answerable++;
      cell.recall5 += r5;
      cell.recall10 += r10;
      cell.mrr5 += m5;
      cell.mrr10 += m10;
    }
  }
  const refusal = refusalStats(pairs);
  const mean = (s) => (answerable === 0 ? 0 : s / answerable);
  const cellMean = (cell) => ({
    n: cell.n,
    answerable: cell.answerable,
    recall5: cell.answerable === 0 ? 0 : cell.recall5 / cell.answerable,
    recall10: cell.answerable === 0 ? 0 : cell.recall10 / cell.answerable,
    mrr5: cell.answerable === 0 ? 0 : cell.mrr5 / cell.answerable,
    mrr10: cell.answerable === 0 ? 0 : cell.mrr10 / cell.answerable,
  });
  return {
    n: items.length,
    answerable,
    recall5: mean(sumR5),
    recall10: mean(sumR10),
    mrr5: mean(sumM5),
    mrr10: mean(sumM10),
    refusalAccuracy: refusal.accuracy,
    falseRefusals: refusal.falseRefusals,
    falseAcceptances: refusal.falseAcceptances,
    perSubset: Object.fromEntries(Object.entries(perSubset).map(([s, c]) => [s, cellMean(c)])),
    detail,
  };
}

function printSemanticTable(partition, r) {
  console.log(`semantic partition=${partition} n=${r.n} answerable=${r.answerable}`);
  console.log(`semantic overall recall@5=${fmt(r.recall5)} recall@10=${fmt(r.recall10)} mrr@5=${fmt(r.mrr5)} mrr@10=${fmt(r.mrr10)}`);
  console.log(
    `semantic overall refusal-accuracy=${fmt(r.refusalAccuracy)} false-refusals=${r.falseRefusals} false-acceptances=${r.falseAcceptances}`
  );
  for (const s of SUBSETS) {
    const c = r.perSubset[s];
    const m = (x) => (c.answerable === 0 ? "n/a" : fmt(x));
    console.log(
      `  semantic subset=${s} n=${c.n} answerable=${c.answerable} recall@5=${m(c.recall5)} recall@10=${m(c.recall10)} mrr@5=${m(c.mrr5)} mrr@10=${m(c.mrr10)}`
    );
  }
  for (const d of r.detail) {
    console.log(`  semantic rank id=${d.id} top3=${d.top.join(" ")}`);
  }
}

async function runSemanticLeg(parts) {
  const config = loadEmbeddingEnv();
  if (!config) {
    console.log("semantic: SKIP (EMBEDDING_BASE_URL + EMBEDDING_API_KEY unset in env and .env.local; no fake zeros recorded)");
    return;
  }
  const chunks = chunkCorpusMirror(CORPUS).map((c) => ({ ...c, chunkId: chunkKey(c) }));
  let chunkVecs;
  let dims;
  try {
    const embedded = await semEmbedTexts(config, chunks.map((c) => c.text));
    chunkVecs = embedded.vectors;
    dims = embedded.dims;
  } catch (err) {
    console.log(`semantic: SKIP (embedding endpoint unreachable: ${err instanceof Error ? err.message : "unknown"}; no fake zeros recorded)`);
    return;
  }
  const entries = chunks.map((chunk, i) => ({ chunk, norm: semNormalize(chunkVecs[i]) }));
  const questions = [...parts.dev, ...parts.validation].map((it) => it.question);
  let questionVecs;
  try {
    questionVecs = (await semEmbedTexts(config, questions)).vectors;
  } catch (err) {
    console.log(`semantic: SKIP (question embedding failed: ${err instanceof Error ? err.message : "unknown"}; no fake zeros recorded)`);
    return;
  }
  const byId = new Map();
  [...parts.dev, ...parts.validation].forEach((it, i) => byId.set(it.id, questionVecs[i]));
  console.log(
    `semanticconfig provider=local-ollama model=${config.model} base=${config.baseUrl} dims=${dims} batch=${SEM_BATCH_SIZE} attempts=${SEM_MAX_ATTEMPTS} chunks=${chunks.length}`
  );
  printSemanticTable("dev", scorePartitionSemantic(parts.dev, chunks, entries, dims, byId));
  printSemanticTable("validation", scorePartitionSemantic(parts.validation, chunks, entries, dims, byId));
  console.log(`semantic test: ${parts.test.length} items FROZEN, unscored until F1 (todo 49)`);
}

// ------------------------------------------------------------------ cli
const args = process.argv.slice(2);
const all = Object.fromEntries(PARTITIONS.map((p) => [p, loadPartition(p)]));

if (args.includes("--bench=real")) {
  await runRealBench();
} else if (args.includes("--self-test")) {
  runSelfTest();
} else if (args.includes("--list")) {
  for (const p of PARTITIONS) {
    console.log(`${p}: ${all[p].length} items ${JSON.stringify(subsetCounts(all[p]))}`);
  }
} else if (args.includes("--partition=test")) {
  // ESCAPE HATCH FOR F1 (todo 49) ONLY — FORBIDDEN during R0.
  console.log("WARNING: TEST scoring is forbidden during R0; this hatch exists for F1 (todo 49) only.");
  printTable("test", scorePartition(all.test));
} else if (args.includes("--granularity=chunk")) {
  // R1 chunk baseline (todo 14): DEV + VALIDATION only, TEST stays frozen.
  runChunkBaseline(all);
} else if (args.includes("--retriever=bm25")) {
  // R2 BM25 measurement (todo 17): DEV + VALIDATION only, TEST stays frozen.
  runBm25Baseline(all);
} else if (args.includes("--leg=semantic")) {
  // R3 semantic-only measurement (todo 24): DEV + VALIDATION only, TEST stays frozen.
  await runSemanticLeg(all);
} else {
  // Default output: DEV + VALIDATION only. TEST is frozen and unscored until F1.
  printTable("dev", scorePartition(all.dev));
  printTable("validation", scorePartition(all.validation));
  console.log(`test: ${all.test.length} items FROZEN, unscored until F1 (todo 49)`);
}
