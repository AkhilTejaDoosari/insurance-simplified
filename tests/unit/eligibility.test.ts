import { describe, expect, it } from "vitest";
import {
  buildEligibilityRow,
  ELIGIBILITY_ROW_NAME,
  withEligibilityRow,
} from "@/app/lib/extraction/eligibility";
import { extractFallback } from "@/app/lib/extraction/extract";
import type { TableRow } from "@/app/lib/extraction/types";

const row = (
  factName: string,
  verdict: TableRow["verdict"] = "NOT STATED",
  extra: Partial<TableRow> = {},
): TableRow => ({ factName, verdict, values: [], ...extra });

const v = (documentId: string, display: string, quote: string) => ({
  documentId,
  display,
  qualifiers: {},
  evidence: [{ documentId, page: 1, quote }],
});

describe("Eligibility for you composite", () => {
  it("is NOT STATED when no feeder has evidence", () => {
    const composite = buildEligibilityRow(
      [row("eligibility"), row("student-eligibility"), row("coverage-dates"), row("age-limits")],
      {},
    );
    expect(composite).toEqual({ factName: ELIGIBILITY_ROW_NAME, verdict: "NOT STATED", values: [] });
  });

  it("maps supported evidence to SUPPORTED with flattened cited values", () => {
    const composite = buildEligibilityRow(
      [
        row("eligibility", "SUPPORTED", { values: [v("doc-1", "Open enrollment", "Open enrollment.")] }),
        row("student-eligibility", "NOT STATED"),
      ],
      {},
    );
    expect(composite.verdict).toBe("SUPPORTED");
    expect(composite.values.map((x) => x.display)).toEqual(["Open enrollment"]);
  });

  it("propagates a context rule-out with its rationale", () => {
    const composite = buildEligibilityRow(
      [
        row("student-eligibility", "DOES NOT APPEAR TO FIT", {
          rationale: "User context field 'visaOrStatus' rules this fact out.",
          values: [v("doc-1", "F-1 only", "F-1 only.")],
        }),
      ],
      { visaOrStatus: "H-1B" },
    );
    expect(composite.verdict).toBe("DOES NOT APPEAR TO FIT");
    expect(composite.rationale).toContain("visaOrStatus");
  });

  it("appended once by the fallback with feeders retained for evidence", () => {
    const table = extractFallback(
      [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: ["Eligibility: open enrollment."] }],
      {},
    );
    const composites = table.rows.filter((r) => r.factName === ELIGIBILITY_ROW_NAME);
    expect(composites).toHaveLength(1);
    expect(composites[0].verdict).toBe("SUPPORTED");
    expect(table.rows.some((r) => r.factName === "eligibility")).toBe(true);
  });

  it("extracts the new coinsurance and policy-limit facts", () => {
    const table = extractFallback(
      [
        {
          documentId: "doc-1",
          filename: "a.pdf",
          pageCount: 1,
          pages: ["Coinsurance: you pay 20% after deductible.", "Lifetime maximum: $1,000,000 per person."],
        },
      ],
      {},
    );
    expect(table.rows.find((r) => r.factName === "coinsurance")?.verdict).toBe("SUPPORTED");
    expect(table.rows.find((r) => r.factName === "policy-limit")?.verdict).toBe("SUPPORTED");
  });
});
