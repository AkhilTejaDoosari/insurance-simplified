// Assign whole documents to splits and freeze splits (roadmap M6).
//
//   npx tsx scripts/corpus/split.ts assign <split> <doc-id>... [--manifest <path>]
//   npx tsx scripts/corpus/split.ts freeze <split> [--date YYYY-MM-DD] [--manifest <path>]
//   npx tsx scripts/corpus/split.ts check [--manifest <path>]
//
// Documents move as a whole (never pages). A frozen split is immutable:
// nothing moves in or out. Identical bytes (sha256) may not appear twice.
// Touches only the tracked manifest; needs no real PDFs.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  assertFrozenUnchanged,
  assignSplit,
  CorpusError,
  freezeSplit,
  isSplit,
  serializeManifest,
  SPLITS,
  validateManifest,
  type Manifest,
  type Split,
} from "./corpus";
import { writeAtomic } from "./scan";

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string", default: "evals/manifests/corpus-v1.json" },
      date: { type: "string" },
    },
  });
  const [command, splitArg, ...ids] = positionals;
  const file = resolve(values.manifest!);
  if (!existsSync(file)) throw new CorpusError(`manifest not found: ${values.manifest}`);
  const before = validateManifest(JSON.parse(readFileSync(file, "utf8")));

  const split = (): Split => {
    if (!splitArg || !isSplit(splitArg)) throw new CorpusError(`expected a split: ${SPLITS.join(" | ")}`);
    return splitArg;
  };

  let after: Manifest;
  switch (command) {
    case "assign":
      if (ids.length === 0) throw new CorpusError("assign needs at least one document id");
      after = assignSplit(before, ids, split());
      break;
    case "freeze":
      after = freezeSplit(before, split(), values.date ?? new Date().toISOString().slice(0, 10));
      break;
    case "check": {
      for (const s of SPLITS) {
        const docs = before.documents.filter((d) => d.split === s);
        console.log(`${s}: ${docs.length} document(s), ${docs.reduce((n, d) => n + d.pages, 0)} page(s), ${before.splits[s].frozen ? `frozen ${before.splits[s].frozenAt}` : "open"}`);
      }
      console.log("check: ok");
      return;
    }
    default:
      throw new CorpusError("usage: split.ts assign <split> <id>... | freeze <split> | check");
  }
  assertFrozenUnchanged(before, after);
  writeAtomic(file, serializeManifest(after));
  console.log(`${command}: ok`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof CorpusError ? `corpus: ${err.message}` : err);
  process.exit(1);
}
