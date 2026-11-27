// File IO for the corpus tools: walk source folders under REAL_PDFS_DIR,
// hash each PDF and count its pages. Reads bytes only; never extracts or
// prints document text.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getDocumentProxy } from "unpdf";
import {
  CorpusError,
  emptyManifest,
  emptyMapping,
  isFamily,
  validateManifest,
  validateMapping,
  type Candidate,
  type Family,
  type Manifest,
  type Mapping,
} from "./corpus";

export interface Source {
  /** Folder relative to the root (or "." for the root itself). */
  dir: string;
  family: Family;
}

/** Parse `--source <dir>=<family>` values. */
export function parseSource(value: string): Source {
  const eq = value.lastIndexOf("=");
  if (eq <= 0) throw new CorpusError(`--source expects <dir>=<family>, got "${value}"`);
  const dir = value.slice(0, eq);
  const family = value.slice(eq + 1);
  if (!isFamily(family)) throw new CorpusError(`unknown family "${family}"`);
  return { dir, family };
}

function walkPdfs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkPdfs(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) out.push(full);
  }
  return out;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  // unpdf may transfer the buffer; hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages = pdf.numPages;
  await pdf.cleanup?.();
  return pages;
}

/** Scan every PDF under each source folder (recursively). Paths are relative to root, "/"-separated. */
export async function scanSources(root: string, sources: Source[]): Promise<Candidate[]> {
  const absRoot = resolve(root);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const dir = resolve(absRoot, s.dir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new CorpusError(`source folder not found: ${s.dir}`);
    const rel = relative(absRoot, dir);
    if (rel.startsWith("..")) throw new CorpusError(`source folder must be inside the root: ${s.dir}`);
    for (const file of walkPdfs(dir).sort()) {
      const source = relative(absRoot, file).split(sep).join("/");
      if (seen.has(source)) throw new CorpusError("a file is covered by two --source folders");
      seen.add(source);
      const bytes = new Uint8Array(readFileSync(file));
      let pages: number;
      try {
        pages = await countPages(bytes);
      } catch {
        // Neutral message: do not echo the filename into logs that may be shared.
        throw new CorpusError(`could not read a PDF (sha256 ${sha256Hex(bytes).slice(0, 12)}…)`);
      }
      out.push({ source, sha256: sha256Hex(bytes), bytes: bytes.length, pages, family: s.family });
    }
  }
  return out;
}

export function loadManifest(path: string, name: string): Manifest {
  if (!existsSync(path)) return emptyManifest(name);
  const m = validateManifest(JSON.parse(readFileSync(path, "utf8")));
  if (m.name !== name) throw new CorpusError(`manifest at ${path} is named ${m.name}, expected ${name}`);
  return m;
}

export function loadMapping(path: string, name: string): Mapping {
  if (!existsSync(path)) return emptyMapping(name);
  return validateMapping(JSON.parse(readFileSync(path, "utf8")));
}

/** Write atomically (temp file + rename) so an interrupted run never leaves half a manifest. */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** REAL_FIXTURES_DIR/corpus/<name>.mapping.json, or undefined when the env var is unset. */
export function mappingPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.REAL_FIXTURES_DIR?.trim();
  return dir ? join(resolve(dir), "corpus", `${name}.mapping.json`) : undefined;
}
