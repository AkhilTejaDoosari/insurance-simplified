// R0 eval loader (provisional; todo 8 builds the real metric runner).
// SPLIT RULE (deterministic, stratified): the 30 golden items form 5 subsets
// (answerable / paraphrase / multi-doc / distractor / must-refuse) x 6 items.
// Within each subset, items sorted by id: first 2 -> dev, next 2 ->
// validation, last 2 -> test. Each partition therefore holds all five
// subsets (2 items each = 10 items per file).
// HARD INVARIANT: TEST is loadable/listable but EXCLUDED from default
// scoring output. First TEST scoring happens at F1 (todo 49). R0 records
// DEV + VALIDATION only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const SUBSETS = ["answerable", "paraphrase", "multi-doc", "distractor", "must-refuse"];
const PARTITIONS = ["dev", "validation", "test"];

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

const args = process.argv.slice(2);
const all = Object.fromEntries(PARTITIONS.map((p) => [p, loadPartition(p)]));

if (args.includes("--list")) {
  for (const p of PARTITIONS) {
    console.log(`${p}: ${all[p].length} items ${JSON.stringify(subsetCounts(all[p]))}`);
  }
} else {
  // Default output: DEV + VALIDATION only. TEST is frozen and unscored until F1.
  for (const p of ["dev", "validation"]) {
    console.log(`${p}: ${all[p].length} items ${JSON.stringify(subsetCounts(all[p]))} (scoring lands in todo 8)`);
  }
  console.log(`test: ${all.test.length} items FROZEN, unscored until F1 (todo 49)`);
}
