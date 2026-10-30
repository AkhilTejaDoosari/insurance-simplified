// F1 regression (prototype, isolated workspace): the deterministic fallback
// derived `period: "annual"` from the collapsed-line token "nextAnnual"
// (source: "next" + line break + "Annual Coordinated Election"), and
// validateTable then threw because the cited quote contains no word-bounded
// "annual" token — aborting the entire FEP document. See
// docs/UNSEEN_DOCUMENT_GENERALIZATION.md recommendation 1.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { extractQualifiers } from "@/app/lib/extraction/fact-list";
import { validateTable } from "@/app/lib/extraction/types";

const COLLAPSED =
  "Prescription drug coverage is described for the nextAnnual Coordinated Election Period.";

describe("F1: qualifier derivation must not invent a period from a collapsed token", () => {
  it("extractQualifiers finds no period in a nextAnnual token", () => {
    expect(extractQualifiers(COLLAPSED).period).toBeUndefined();
  });

  it("extractQualifiers still finds genuine period phrases", () => {
    expect(extractQualifiers("Annual deductible: $1,000").period).toBe("annual");
    expect(extractQualifiers("Premium: $25 per visit").period).toBe("per visit");
    expect(extractQualifiers("Lifetime maximum: $1,000,000").period).toBe("lifetime");
    expect(extractQualifiers("Costs apply per year").period).toBe("per year");
  });

  it("fallback output for the nextAnnual shape passes validateTable", () => {
    const doc = {
      documentId: "doc-fep-shape",
      filename: "fep-shape.pdf",
      pageCount: 1,
      pages: [COLLAPSED],
    };
    const table = extractFallback([doc], {});
    const row = table.rows.find((r) => r.factName === "prescriptions");
    expect(row?.values.length).toBeGreaterThan(0);
    expect(row?.values[0].qualifiers.period).toBeUndefined();
    expect(() => validateTable(table)).not.toThrow();
  });
});
