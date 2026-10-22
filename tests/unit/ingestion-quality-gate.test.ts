// P3-B quality-gate tests: broken extractions never become searchable.
import { describe, expect, it } from "vitest";
import {
  MAX_EXTRACTED_CHARS,
  MIN_EXTRACTED_CHARS,
  checkExtraction,
  classifyExtractorError,
  userVisibleMessage,
} from "@/app/lib/ingestion/quality-gate";

const GOOD_PAGE =
  "Annual deductible: $250 in-network. Emergency care copay: $100. " +
  "Out-of-pocket maximum: $3,000 per covered person per plan year.";

describe("checkExtraction", () => {
  it("passes readable pages", () => {
    expect(checkExtraction([GOOD_PAGE, GOOD_PAGE])).toEqual({ ok: true });
  });

  it("rejects zero-text extraction as document_unreadable (scanned fixture)", () => {
    // Image-only / blank-page fixture: no extractable text at all.
    expect(checkExtraction(["", "   \n\t  "])).toMatchObject({
      ok: false,
      reason: "document_unreadable",
    });
    expect(checkExtraction(["  ", ""])).toMatchObject({
      ok: false,
      reason: "document_unreadable",
    });
  });

  it("rejects throw/empty shapes as extraction_failed", () => {
    expect(checkExtraction([])).toMatchObject({ ok: false, reason: "extraction_failed" });
    expect(checkExtraction(undefined)).toMatchObject({
      ok: false,
      reason: "extraction_failed",
    });
    expect(checkExtraction(null)).toMatchObject({ ok: false, reason: "extraction_failed" });
    expect(checkExtraction("not-an-array")).toMatchObject({
      ok: false,
      reason: "extraction_failed",
    });
    expect(checkExtraction([GOOD_PAGE, 42])).toMatchObject({
      ok: false,
      reason: "extraction_failed",
    });
  });

  it("rejects corrupt/empty-buffer style input as extraction_failed, not ok", () => {
    // A corrupt PDF never yields a pages array — the extractor throws first;
    // if anything coerces that into an empty shape the gate still fails closed.
    expect(checkExtraction([]).ok).toBe(false);
  });

  it("guards implausible volume (heuristics, not spec)", () => {
    expect(MIN_EXTRACTED_CHARS).toBe(50);
    expect(MAX_EXTRACTED_CHARS).toBe(20_000_000);
    expect(checkExtraction(["hi"])).toMatchObject({ ok: false, reason: "implausible_volume" });
    expect(checkExtraction(["x".repeat(MIN_EXTRACTED_CHARS - 1)])).toMatchObject({
      ok: false,
      reason: "implausible_volume",
    });
    expect(checkExtraction(["x".repeat(MIN_EXTRACTED_CHARS)]).ok).toBe(true);
    expect(checkExtraction(["x".repeat(MAX_EXTRACTED_CHARS + 1)])).toMatchObject({
      ok: false,
      reason: "implausible_volume",
    });
  });
});

describe("classifyExtractorError", () => {
  function tagged(message: string, reason: string) {
    return Object.assign(new Error(message), { reason });
  }

  it("maps corrupt/encrypted signals to unsupported_document", () => {
    expect(classifyExtractorError(tagged("f is encrypted or corrupt", "encrypted"))).toMatchObject(
      { ok: false, reason: "unsupported_document" },
    );
    expect(classifyExtractorError(tagged("f is not a PDF", "not-pdf"))).toMatchObject({
      ok: false,
      reason: "unsupported_document",
    });
    // Header/trailer failure detected from the message even without a tag.
    expect(classifyExtractorError(new Error("Invalid PDF header: missing %PDF-"))).toMatchObject(
      { ok: false, reason: "unsupported_document" },
    );
    expect(classifyExtractorError(new Error("trailer/XRef parse failed"))).toMatchObject({
      ok: false,
      reason: "unsupported_document",
    });
  });

  it("maps empty-text rejection to document_unreadable", () => {
    expect(
      classifyExtractorError(tagged("f contains no extractable text", "unreadable")),
    ).toMatchObject({ ok: false, reason: "document_unreadable" });
  });

  it("maps size/page-limit rejections to implausible_volume", () => {
    expect(classifyExtractorError(tagged("exceeds the 20 MB limit", "over-size-limit"))).toMatchObject(
      { ok: false, reason: "implausible_volume" },
    );
    expect(classifyExtractorError(tagged("exceeds the 200-page limit", "over-page-limit"))).toMatchObject(
      { ok: false, reason: "implausible_volume" },
    );
  });

  it("falls back to extraction_failed for unknown throws", () => {
    expect(classifyExtractorError(new Error("boom"))).toMatchObject({
      ok: false,
      reason: "extraction_failed",
    });
  });
});

describe("userVisibleMessage", () => {
  it("uses plain language and never claims scanned-PDF support", () => {
    const unreadable = userVisibleMessage("document_unreadable");
    expect(unreadable).toMatch(/scanned/i);
    expect(unreadable).toMatch(/not implemented/i);
    for (const reason of [
      "document_unreadable",
      "extraction_failed",
      "unsupported_document",
      "implausible_volume",
    ] as const) {
      expect(userVisibleMessage(reason).length).toBeGreaterThan(10);
    }
  });
});
