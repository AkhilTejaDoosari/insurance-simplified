// M6 split-by-document tool: whole documents only, frozen splits immutable,
// no duplicate bytes across splits. Synthetic manifests only.
import { describe, expect, it } from "vitest";
import {
  assertFrozenUnchanged,
  assignSplit,
  emptyManifest,
  freezeSplit,
  validateManifest,
  type Manifest,
} from "@/scripts/corpus/corpus";

function manifest(): Manifest {
  const m = emptyManifest("t");
  m.documents = ["a", "b", "c"].map((c, i) => ({
    id: `doc-00${i + 1}`,
    sha256: c.repeat(64),
    bytes: 10,
    pages: 3,
    family: "sbc" as const,
    split: "dev" as const,
  }));
  return m;
}

describe("assignSplit", () => {
  it("moves whole documents between open splits without mutating the input", () => {
    const before = manifest();
    const after = assignSplit(before, ["doc-002", "doc-003"], "held-out");
    expect(after.documents.map((d) => d.split)).toEqual(["dev", "held-out", "held-out"]);
    expect(before.documents.every((d) => d.split === "dev")).toBe(true);
  });

  it("refuses to move a document out of a frozen split", () => {
    const frozen = freezeSplit(manifest(), "dev", "2026-11-19");
    expect(() => assignSplit(frozen, ["doc-001"], "validation")).toThrow(/frozen split dev/);
  });

  it("refuses to add a document to a frozen split", () => {
    const m = assignSplit(manifest(), ["doc-001"], "validation");
    const frozen = freezeSplit(m, "validation", "2026-11-19");
    expect(() => assignSplit(frozen, ["doc-002"], "validation")).toThrow(/frozen/);
  });

  it("rejects unknown and repeated ids", () => {
    expect(() => assignSplit(manifest(), ["doc-009"], "validation")).toThrow(/unknown/);
    expect(() => assignSplit(manifest(), ["doc-001", "doc-001"], "validation")).toThrow(/twice/);
  });

  it("refuses duplicate sha256 across splits", () => {
    const m = manifest();
    m.documents[2].sha256 = m.documents[0].sha256;
    m.documents[2].split = "held-out";
    expect(() => validateManifest(m)).toThrow(/same sha256/);
    expect(() => assignSplit(m, ["doc-002"], "validation")).toThrow(/same sha256/);
  });

  it("has no notion of page-level assignment: a page field is rejected", () => {
    const m = manifest() as unknown as { documents: Record<string, unknown>[] };
    m.documents[0].pageRange = [1, 2];
    expect(() => validateManifest(m)).toThrow(/unexpected fields/);
  });
});

describe("freezeSplit", () => {
  it("records the date and refuses re-freezing or freezing an empty split", () => {
    const frozen = freezeSplit(manifest(), "dev", "2026-11-19");
    expect(frozen.splits.dev).toEqual({ frozen: true, frozenAt: "2026-11-19" });
    expect(() => freezeSplit(frozen, "dev", "2026-11-20")).toThrow(/already frozen/);
    expect(() => freezeSplit(manifest(), "validation", "2026-11-19")).toThrow(/empty/);
    expect(() => freezeSplit(manifest(), "dev", "19/11/2026")).toThrow(/YYYY-MM-DD/);
  });
});

describe("assertFrozenUnchanged", () => {
  it("detects any change to a frozen split or an unfreeze", () => {
    const frozen = freezeSplit(manifest(), "dev", "2026-11-19");
    const edited = structuredClone(frozen);
    edited.documents[0].pages = 4;
    expect(() => assertFrozenUnchanged(frozen, edited)).toThrow(/changed/);
    const unfrozen = structuredClone(frozen);
    unfrozen.splits.dev = { frozen: false, frozenAt: null };
    expect(() => assertFrozenUnchanged(frozen, unfrozen)).toThrow(/unfrozen/);
    expect(() => assertFrozenUnchanged(frozen, structuredClone(frozen))).not.toThrow();
  });
});
