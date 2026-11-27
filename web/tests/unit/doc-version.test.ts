import { describe, expect, it } from "vitest";
import {
  isDeterministicVersionPair,
  orderByAuthority,
  preferCurrent,
  type DocVersionMeta,
} from "@/app/lib/rag/doc-version";

function doc(over: Partial<DocVersionMeta> & { documentId: string }): DocVersionMeta {
  return {
    source_type: "other",
    plan_key: "",
    status: "unknown",
    ...over,
  };
}

describe("doc-version", () => {
  it("superseded-not-preferred: deterministic superseded doc is dropped", () => {
    const docs = [
      doc({ documentId: "old", plan_key: "plan-A", status: "superseded", superseded_by: "new", effective_from: "2024-01-01" }),
      doc({ documentId: "new", plan_key: "plan-A", status: "current", effective_from: "2025-01-01" }),
    ];
    const out = preferCurrent(docs);
    expect(out.map((d) => d.documentId)).toEqual(["new"]);
  });

  it("current-wins-when-deterministic: effective dates + same plan_key", () => {
    const a = doc({ documentId: "v1", plan_key: "plan-B", status: "superseded", effective_from: "2023-01-01" });
    const b = doc({ documentId: "v2", plan_key: "plan-B", status: "current", effective_from: "2024-01-01" });
    expect(isDeterministicVersionPair(a, b)).toBe(true);
    expect(preferCurrent([a, b]).map((d) => d.documentId)).toEqual(["v2"]);
  });

  it("non-deterministic pair returns both untouched (no dates, no edge)", () => {
    const a = doc({ documentId: "x", plan_key: "plan-C", status: "superseded" });
    const b = doc({ documentId: "y", plan_key: "plan-C", status: "current" });
    expect(isDeterministicVersionPair(a, b)).toBe(false);
    expect(preferCurrent([a, b]).map((d) => d.documentId)).toEqual(["x", "y"]);
  });

  it("higher-authority-wins-in-scope only as opt-in (certificate > sbc > brochure)", () => {
    const docs = [
      doc({ documentId: "bro", source_type: "brochure", plan_key: "p", status: "current" }),
      doc({ documentId: "sbc", source_type: "sbc", plan_key: "p", status: "current" }),
      doc({ documentId: "cert", source_type: "certificate", plan_key: "p", status: "current" }),
    ];
    // Default: no re-ranking
    expect(orderByAuthority(docs).map((d) => d.documentId)).toEqual(["bro", "sbc", "cert"]);
    // Opt-in: precedence applies
    expect(orderByAuthority(docs, { applyPrecedence: true }).map((d) => d.documentId)).toEqual([
      "cert",
      "sbc",
      "bro",
    ]);
  });

  it("unknown-searchable: unknown docs are always retained", () => {
    const docs = [
      doc({ documentId: "u1", plan_key: "plan-D", status: "unknown", effective_from: "2024-06-01" }),
      doc({ documentId: "c1", plan_key: "plan-D", status: "current", effective_from: "2025-01-01" }),
    ];
    const out = preferCurrent(docs);
    expect(out.map((d) => d.documentId)).toContain("u1");
  });

  it("cross-plan-differences-NOT-conflicts: different plan_keys untouched", () => {
    const docs = [
      doc({ documentId: "a", plan_key: "plan-X", status: "superseded", effective_from: "2023-01-01" }),
      doc({ documentId: "b", plan_key: "plan-Y", status: "current", effective_from: "2025-01-01" }),
    ];
    expect(preferCurrent(docs).map((d) => d.documentId)).toEqual(["a", "b"]);
  });
});
