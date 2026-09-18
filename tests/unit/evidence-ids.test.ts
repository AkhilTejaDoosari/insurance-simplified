import { describe, expect, it } from "vitest";
import { createSession, deleteSession, getEvidenceRecord, registerEvidence } from "@/app/lib/session";
import { evidenceIdFor, withEvidenceId } from "@/app/lib/evidence-ids";
// locatePassage below is an explicit non-viewer legacy use (parity pin only);
// the viewer path must use matchEvidencePassage from app/lib/pdf/text-match.ts.
import { isMatchingEvidence, locatePassage } from "@/app/lib/citation";
import { extractFallback } from "@/app/lib/extraction/extract";

describe("evidenceIdFor", () => {
  it("is deterministic and opaque", () => {
    const a = evidenceIdFor("doc-1", 2, "Some quote.");
    expect(a).toBe(evidenceIdFor("doc-1", 2, "Some quote."));
    expect(a).toMatch(/^ev-[0-9a-f]{16}$/);
    expect(a).not.toContain("Some quote.");
  });

  it("changes when any input changes", () => {
    const base = evidenceIdFor("doc-1", 2, "Some quote.");
    expect(evidenceIdFor("doc-2", 2, "Some quote.")).not.toBe(base);
    expect(evidenceIdFor("doc-1", 3, "Some quote.")).not.toBe(base);
    expect(evidenceIdFor("doc-1", 2, "Other quote.")).not.toBe(base);
  });
});

describe("session-bound evidence registry", () => {
  it("round-trips registered passages and stays idempotent", () => {
    const session = createSession([], {});
    try {
      const entry = { documentId: "doc-1", page: 2, quote: "Some quote." };
      registerEvidence(session.sessionId, [entry, entry]);
      const id = evidenceIdFor("doc-1", 2, "Some quote.");
      expect(getEvidenceRecord(session.sessionId, id)).toEqual(entry);
      expect(Object.keys(getEvidenceRecord(session.sessionId, id) ?? {}).length).toBeGreaterThan(0);
    } finally {
      deleteSession(session.sessionId);
    }
  });

  it("returns undefined for unknown or malformed IDs", () => {
    const session = createSession([], {});
    try {
      expect(getEvidenceRecord(session.sessionId, "ev-0000000000000000")).toBeUndefined();
      expect(getEvidenceRecord(session.sessionId, "not-an-id")).toBeUndefined();
      expect(getEvidenceRecord(session.sessionId, "../../etc")).toBeUndefined();
    } finally {
      deleteSession(session.sessionId);
    }
  });

  it("does not resolve one session's evidence from another session", () => {
    const a = createSession([], {});
    const b = createSession([], {});
    try {
      registerEvidence(a.sessionId, [{ documentId: "doc-1", page: 1, quote: "Shared quote." }]);
      const id = evidenceIdFor("doc-1", 1, "Shared quote.");
      expect(getEvidenceRecord(a.sessionId, id)).toEqual({
        documentId: "doc-1",
        page: 1,
        quote: "Shared quote.",
      });
      expect(getEvidenceRecord(b.sessionId, id)).toBeUndefined();
    } finally {
      deleteSession(a.sessionId);
      deleteSession(b.sessionId);
    }
  });
});

describe("extraction stays session-agnostic", () => {
  it("fallback evidence carries no opaque navigation IDs", () => {
    const table = extractFallback(
      [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["Annual deductible: $250."] }],
      {}
    );
    const row = table.rows.find((r) => r.factName === "annual-deductible");
    expect(row?.values).toHaveLength(1);
    for (const e of row!.values[0].evidence) {
      expect(e).toEqual({ documentId: "doc-1", page: 1, quote: "Annual deductible: $250." });
    }
  });

  it("withEvidenceId enriches a core citation without mutating it", () => {
    const core = { documentId: "doc-1", page: 1, quote: "Annual deductible: $250." };
    const enriched = withEvidenceId(core);
    expect(enriched.evidenceId).toBe(evidenceIdFor("doc-1", 1, "Annual deductible: $250."));
    expect(core).toEqual({ documentId: "doc-1", page: 1, quote: "Annual deductible: $250." });
  });
});

describe("isMatchingEvidence (viewer validation)", () => {
  const record = { documentId: "doc-1", page: 2, quote: "Some quote." };

  it("accepts the exact cited document and page", () => {
    expect(isMatchingEvidence(record, "doc-1", 2)).toBe(true);
  });

  it("rejects a different document", () => {
    expect(isMatchingEvidence(record, "doc-2", 2)).toBe(false);
  });

  it("rejects a different page", () => {
    expect(isMatchingEvidence(record, "doc-1", 3)).toBe(false);
  });

  it("rejects unknown IDs", () => {
    expect(isMatchingEvidence(undefined, "doc-1", 2)).toBe(false);
  });
});

describe("locatePassage", () => {
  const page = "Annual deductible: $250 in-network.\nAnnual out-of-pocket maximum: $3,000.";

  it("splits out a uniquely occurring passage", () => {
    expect(locatePassage(page, "Annual deductible: $250 in-network.")).toEqual({
      before: "",
      match: "Annual deductible: $250 in-network.",
      after: "\nAnnual out-of-pocket maximum: $3,000.",
    });
  });

  it("tolerates whitespace differences between quote and page text", () => {
    const located = locatePassage("Annual   deductible:\n$250 in-network.", "Annual deductible: $250 in-network.");
    expect(located).not.toBeNull();
    expect(located?.match).toBe("Annual   deductible:\n$250 in-network.");
  });

  it("returns null when the passage occurs zero times", () => {
    expect(locatePassage(page, "Excluded until 12 months continuous coverage.")).toBeNull();
  });

  it("returns null when the passage occurs more than once, never guessing", () => {
    expect(locatePassage("Copay $10. Copay $10.", "Copay $10.")).toBeNull();
  });

  it("returns null for empty quotes or empty pages", () => {
    expect(locatePassage(page, "   ")).toBeNull();
    expect(locatePassage("", "Copay $10.")).toBeNull();
  });
});
