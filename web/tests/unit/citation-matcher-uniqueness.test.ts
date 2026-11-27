import { describe, expect, it } from "vitest";
import {
  matchEvidencePassage,
  type PdfTextItemInput,
} from "@/app/lib/pdf/text-match";
// Legacy non-viewer reference only: pins that the deprecated locatePassage
// shares the canonical single-unique-match-or-fallback semantics. The viewer
// path (app/components, app/view) must use matchEvidencePassage exclusively.
import { locatePassage } from "@/app/lib/citation";

/** Project page text onto the canonical item stream (one item per line). */
function pageToItems(pageText: string): PdfTextItemInput[] {
  const lines = pageText.split("\n");
  return lines.map((line, index) => ({
    str: line,
    hasEOL: index < lines.length - 1,
    transform: [10, 0, 0, 10, 72, 700 - index * 20],
    width: Math.max(line.length * 5, 1),
    height: 10,
  }));
}

const PAGE =
  "Annual deductible: $250 in-network.\nAnnual out-of-pocket maximum: $3,000.";

describe("canonical matcher uniqueness semantics (text-match.ts)", () => {
  it("unique quote -> highlight rects on the canonical path", () => {
    const found = matchEvidencePassage(
      pageToItems(PAGE),
      "Annual deductible: $250 in-network."
    );
    expect(found.status).toBe("unique");
    if (found.status !== "unique") return;
    expect(found.rects.length).toBeGreaterThan(0);
    // Legacy rule agrees: exactly one match, so it also locates the passage.
    expect(locatePassage(PAGE, "Annual deductible: $250 in-network.")).not.toBeNull();
  });

  it("duplicate quote -> zero highlight rects + honest no-highlight fallback", () => {
    const dupPage = "Copay $10. Copay $10.";
    const found = matchEvidencePassage(pageToItems(dupPage), "Copay $10.");
    // Ambiguous carries no rects: the viewer renders the page with the
    // explicit multiple-match fallback message instead of highlighting.
    expect(found.status).toBe("ambiguous");
    expect(found).not.toHaveProperty("rects");
    // Legacy rule agrees: duplicate means null (no highlight), never a guess.
    expect(locatePassage(dupPage, "Copay $10.")).toBeNull();
  });

  it("absent quote -> no highlight on either path", () => {
    const found = matchEvidencePassage(
      pageToItems(PAGE),
      "Excluded until 12 months continuous coverage."
    );
    expect(found.status).toBe("none");
    expect(
      locatePassage(PAGE, "Excluded until 12 months continuous coverage.")
    ).toBeNull();
  });
});
