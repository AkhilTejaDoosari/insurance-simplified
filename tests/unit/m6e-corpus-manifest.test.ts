// M6 corpus manifest builder: synthetic tiny PDFs only (no real documents).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CorpusError,
  countFilenameLeaks,
  emptyManifest,
  emptyMapping,
  freezeSplit,
  reconcile,
  serializeManifest,
  validateManifest,
  type Candidate,
} from "@/scripts/corpus/corpus";
import { parseSource, scanSources, sha256Hex } from "@/scripts/corpus/scan";

async function tinyPdf(pages: number, marker: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(marker); // distinct bytes per file
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

const sha = (c: string) => c.repeat(64);
const cand = (source: string, s: string, family: Candidate["family"] = "sbc", pages = 2): Candidate => ({
  source,
  sha256: sha(s),
  bytes: 100,
  pages,
  family,
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "m6e-corpus-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scanSources", () => {
  it("walks subfolders recursively and records sha256, bytes and page count", async () => {
    mkdirSync(join(root, "FolderA", "nested"), { recursive: true });
    mkdirSync(join(root, "FolderB"));
    const a = await tinyPdf(3, "a");
    const b = await tinyPdf(1, "b");
    writeFileSync(join(root, "FolderA", "nested", "Acme Gold Plan.pdf"), a);
    writeFileSync(join(root, "FolderB", "other.PDF"), b);
    writeFileSync(join(root, "FolderB", "notes.txt"), "ignored");
    const got = await scanSources(root, [parseSource("FolderA=sbc"), parseSource("FolderB=nonstandard")]);
    expect(got).toEqual([
      { source: "FolderA/nested/Acme Gold Plan.pdf", sha256: sha256Hex(a), bytes: a.length, pages: 3, family: "sbc" },
      { source: "FolderB/other.PDF", sha256: sha256Hex(b), bytes: b.length, pages: 1, family: "nonstandard" },
    ]);
  });

  it("rejects a family outside the generic list (folder names never become families)", () => {
    expect(() => parseSource("Acme=acme-insurance")).toThrow(CorpusError);
  });

  it("fails on an unreadable PDF without echoing its filename", async () => {
    mkdirSync(join(root, "F"));
    writeFileSync(join(root, "F", "Secret Insurer.pdf"), "not a pdf");
    const err = await scanSources(root, [{ dir: "F", family: "sbc" }]).catch((e) => e);
    expect(err).toBeInstanceOf(CorpusError);
    expect(String(err.message)).not.toMatch(/Secret|Insurer/);
  });
});

describe("reconcile", () => {
  it("assigns neutral ids ordered by sha256, independent of filenames", () => {
    const r = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("z/Zeta.pdf", "a"), cand("a/Alpha.pdf", "b")], "dev");
    expect(r.manifest.documents.map((d) => [d.id, d.sha256])).toEqual([
      ["doc-001", sha("a")],
      ["doc-002", sha("b")],
    ]);
    expect(r.mapping.entries.find((e) => e.id === "doc-001")!.source).toBe("z/Zeta.pdf");
    expect(r.manifest.documents.every((d) => d.split === "dev")).toBe(true);
  });

  it("is deterministic: re-running on the same files changes nothing", () => {
    const files = [cand("x/1.pdf", "a"), cand("x/2.pdf", "b", "nonstandard")];
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), files, "dev");
    const second = reconcile(first.manifest, first.mapping, [...files].reverse(), undefined);
    expect(serializeManifest(second.manifest)).toBe(serializeManifest(first.manifest));
    expect(second.added).toEqual([]);
    expect(second.unchanged.sort()).toEqual(["doc-001", "doc-002"]);
  });

  it("errors when a registered file's bytes change (never silently overwritten)", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], "dev");
    expect(() => reconcile(first.manifest, first.mapping, [cand("x/1.pdf", "c")], "dev")).toThrow(/sha256 mismatch/);
  });

  it("errors on a byte change in a frozen split too", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], "dev");
    const frozen = freezeSplit(first.manifest, "dev", "2026-11-19");
    expect(() => reconcile(frozen, first.mapping, [cand("x/1.pdf", "c")], undefined)).toThrow(/sha256 mismatch/);
  });

  it("refuses to add documents to a frozen split", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], "dev");
    const frozen = freezeSplit(first.manifest, "dev", "2026-11-19");
    expect(() => reconcile(frozen, first.mapping, [cand("x/1.pdf", "a"), cand("x/2.pdf", "b")], "dev")).toThrow(/frozen/);
  });

  it("requires a split for new documents", () => {
    expect(() => reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], undefined)).toThrow(/--split/);
  });

  it("refuses two scanned files with identical bytes", () => {
    expect(() =>
      reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a"), cand("y/copy.pdf", "a")], "dev")
    ).toThrow(/identical bytes/);
  });

  it("refuses a new file duplicating a registered document's bytes", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], "dev");
    expect(() =>
      reconcile(first.manifest, first.mapping, [cand("x/1.pdf", "a"), cand("y/copy.pdf", "a")], "validation")
    ).toThrow(CorpusError);
  });

  it("tracks a renamed file by sha256 and updates only the private mapping", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/old.pdf", "a")], "dev");
    const r = reconcile(first.manifest, first.mapping, [cand("x/new.pdf", "a")], undefined);
    expect(r.moved).toEqual(["doc-001"]);
    expect(serializeManifest(r.manifest)).toBe(serializeManifest(first.manifest));
    expect(r.mapping.entries[0].source).toBe("x/new.pdf");
  });

  it("keeps a missing document in an open split, errors for a frozen one", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a"), cand("x/2.pdf", "b")], "dev");
    const open = reconcile(first.manifest, first.mapping, [cand("x/1.pdf", "a")], undefined);
    expect(open.missing).toEqual(["doc-002"]);
    expect(open.manifest.documents).toHaveLength(2);
    const frozen = freezeSplit(first.manifest, "dev", "2026-11-19");
    expect(() => reconcile(frozen, first.mapping, [cand("x/1.pdf", "a")], undefined)).toThrow(/not found/);
  });

  it("continues numbering after existing ids", () => {
    const first = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], "dev");
    const r = reconcile(first.manifest, first.mapping, [cand("x/1.pdf", "a"), cand("x/2.pdf", "0")], "held-out");
    expect(r.added).toEqual(["doc-002"]);
    expect(r.manifest.documents.find((d) => d.id === "doc-002")!.split).toBe("held-out");
  });
});

describe("tracked manifest privacy", () => {
  it("rejects any field beyond the neutral schema (e.g. a filename)", () => {
    const m = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("x/1.pdf", "a")], "dev").manifest;
    const bad = JSON.parse(serializeManifest(m));
    bad.documents[0].filename = "Acme Gold.pdf";
    expect(() => validateManifest(bad)).toThrow(/unexpected fields/);
  });

  it("counts filename fragments present in manifest text, ignoring sha256 hex and schema words", () => {
    const m = reconcile(emptyManifest("t"), emptyMapping("t"), [cand("Dev/Acme Gold SBC 2026.pdf", "b")], "dev").manifest;
    const text = serializeManifest(m);
    expect(countFilenameLeaks(text, ["Dev/Acme Gold SBC 2026.pdf"])).toBe(0);
    expect(countFilenameLeaks(text.replace('"sbc"', '"acme"'), ["Dev/Acme Gold SBC 2026.pdf"])).toBe(1);
    // a hex run inside a sha256 never counts as a leak
    expect(countFilenameLeaks(text, ["bbbb.pdf"])).toBe(0);
  });
});

describe("build-manifest CLI", () => {
  it("writes the neutral manifest in git and the filename mapping under REAL_FIXTURES_DIR", async () => {
    const pdfs = join(root, "pdfs");
    const priv = join(root, "private");
    mkdirSync(join(pdfs, "Insurer Folder"), { recursive: true });
    writeFileSync(join(pdfs, "Insurer Folder", "Brandname Platinum.pdf"), await tinyPdf(2, "x"));
    const manifest = join(root, "out", "m.json");
    const run = () =>
      execFileSync(
        "npx",
        ["tsx", "scripts/corpus/build-manifest.ts", "--name", "m6e", "--source", "Insurer Folder=sbc", "--split", "dev", "--manifest", manifest],
        { cwd: resolve(__dirname, "../.."), env: { ...process.env, REAL_PDFS_DIR: pdfs, REAL_FIXTURES_DIR: priv }, encoding: "utf8" }
      );
    const out = run();
    expect(out).not.toMatch(/Brandname|Insurer/);
    const text = readFileSync(manifest, "utf8");
    expect(text).not.toMatch(/brandname|platinum|insurer/i);
    expect(validateManifest(JSON.parse(text)).documents).toHaveLength(1);
    const mapping = JSON.parse(readFileSync(join(priv, "corpus", "m6e.mapping.json"), "utf8"));
    expect(mapping.entries[0]).toMatchObject({ id: "doc-001", source: "Insurer Folder/Brandname Platinum.pdf" });
    run(); // second run: deterministic, identical output
    expect(readFileSync(manifest, "utf8")).toBe(text);
  }, 60_000);
});
