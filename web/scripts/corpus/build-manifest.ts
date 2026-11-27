// Build or refresh the evaluation-corpus manifest (roadmap M6).
//
//   REAL_PDFS_DIR=<root> REAL_FIXTURES_DIR=<private dir> \
//     npx tsx scripts/corpus/build-manifest.ts \
//       --source SBCs=sbc --source nonstandard=nonstandard --split dev
//
// Options:
//   --name <name>        manifest name (default corpus-v1)
//   --root <dir>         overrides REAL_PDFS_DIR
//   --source <dir>=<family>  folder under the root (recursive) and its generic family; repeatable
//   --split <split>      split for NEW documents (dev | validation | held-out); must be open
//   --manifest <path>    tracked manifest (default evals/manifests/<name>.json)
//   --dry-run            report counts, write nothing
//
// Writes the tracked manifest (ids, sha256, bytes, pages, family, split) and
// the private id→filename mapping at REAL_FIXTURES_DIR/corpus/<name>.mapping.json.
// Prints counts and ids only — never filenames or document text.
import { resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  assertFrozenUnchanged,
  CorpusError,
  countFilenameLeaks,
  isSplit,
  reconcile,
  serializeManifest,
  serializeMapping,
} from "./corpus";
import { loadManifest, loadMapping, mappingPath, parseSource, scanSources, writeAtomic } from "./scan";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string", default: "corpus-v1" },
      root: { type: "string" },
      source: { type: "string", multiple: true },
      split: { type: "string" },
      manifest: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const name = values.name!;
  const root = (values.root ?? process.env.REAL_PDFS_DIR ?? "").trim();
  if (!root) throw new CorpusError("set REAL_PDFS_DIR (or --root) to the folder holding the real PDFs");
  const sources = (values.source ?? []).map(parseSource);
  if (sources.length === 0) throw new CorpusError("pass at least one --source <dir>=<family>");
  if (values.split !== undefined && !isSplit(values.split)) throw new CorpusError(`unknown split "${values.split}"`);
  const manifestFile = resolve(values.manifest ?? `evals/manifests/${name}.json`);
  const mapFile = mappingPath(name);
  if (!mapFile) throw new CorpusError("set REAL_FIXTURES_DIR: the id→filename mapping must live outside git");
  if (!relative(resolve("evals"), mapFile).startsWith("..")) throw new CorpusError("the private mapping may not be written under evals/");

  const before = loadManifest(manifestFile, name);
  const mapping = loadMapping(mapFile, name);
  const candidates = await scanSources(root, sources);
  const result = reconcile(before, mapping, candidates, values.split as never);
  assertFrozenUnchanged(before, result.manifest);

  const manifestText = serializeManifest(result.manifest);
  const leaks = countFilenameLeaks(manifestText, result.mapping.entries.map((e) => e.source));
  if (leaks > 0) throw new CorpusError(`manifest would contain ${leaks} filename fragment(s); refusing to write`);

  const byFamily = new Map<string, number>();
  for (const d of result.manifest.documents) byFamily.set(`${d.split}/${d.family}`, (byFamily.get(`${d.split}/${d.family}`) ?? 0) + 1);
  console.log(`scanned ${candidates.length} PDF(s): ${result.added.length} added, ${result.unchanged.length} unchanged, ${result.moved.length} moved, ${result.missing.length} not found (kept)`);
  if (result.added.length) console.log(`added: ${result.added.join(", ")}`);
  if (result.missing.length) console.log(`not found in this scan: ${result.missing.join(", ")}`);
  for (const [k, n] of [...byFamily].sort()) console.log(`  ${k}: ${n}`);
  console.log(`total pages: ${result.manifest.documents.reduce((s, d) => s + d.pages, 0)}`);

  if (values["dry-run"]) {
    console.log("dry run: nothing written");
    return;
  }
  writeAtomic(mapFile, serializeMapping(result.mapping));
  writeAtomic(manifestFile, manifestText);
  console.log(`wrote ${relative(process.cwd(), manifestFile)} and the private mapping under REAL_FIXTURES_DIR/corpus/`);
}

main().catch((err: unknown) => {
  console.error(err instanceof CorpusError ? `corpus: ${err.message}` : err);
  process.exit(1);
});
