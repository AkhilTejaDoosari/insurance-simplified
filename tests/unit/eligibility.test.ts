import { describe, expect, it, vi } from "vitest";
import {
  buildEligibilityRow,
  ELIGIBILITY_ROW_NAME,
  withEligibilityRow,
} from "@/app/lib/extraction/eligibility";
import { extractFallback, extractViaLlm } from "@/app/lib/extraction/extract";
import { completeJson } from "@/app/lib/llm/client";
import type { TableRow } from "@/app/lib/extraction/types";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));

const mockedComplete = vi.mocked(completeJson);

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

describe("eligibility engine parity", () => {
  const DOCS = [
    {
      documentId: "doc-1",
      filename: "a.pdf",
      pageCount: 1,
      pages: ["International student eligibility: must hold a valid F-1 visa."],
    },
  ];

  const llmPayload = (verdict: string) => ({
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
    rows: [
      {
        factName: "student-eligibility",
        verdict,
        ...(verdict === "DOES NOT APPEAR TO FIT"
          ? { rationale: "model context judgment" }
          : {}),
        values: [
          {
            documentId: "doc-1",
            display: "must hold a valid F-1 visa",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 1,
                quote: "International student eligibility: must hold a valid F-1 visa.",
              },
            ],
          },
        ],
      },
    ],
  });

  const compositeOf = (table: { rows: TableRow[] }) =>
    table.rows.find((r) => r.factName === ELIGIBILITY_ROW_NAME)!;

  it("ruled-out context yields DOES NOT APPEAR TO FIT on both engines", async () => {
    const fallback = extractFallback(DOCS, { visaOrStatus: "H-1B" });
    mockedComplete.mockResolvedValue(llmPayload("SUPPORTED"));
    const viaLlm = await extractViaLlm(DOCS, { visaOrStatus: "H-1B" });
    expect(compositeOf(fallback).verdict).toBe("DOES NOT APPEAR TO FIT");
    expect(compositeOf(viaLlm).verdict).toBe("DOES NOT APPEAR TO FIT");
    expect(compositeOf(viaLlm).rationale).toContain("visaOrStatus");
  });

  it("matching context yields SUPPORTED on both engines", async () => {
    const fallback = extractFallback(DOCS, { visaOrStatus: "F-1" });
    mockedComplete.mockResolvedValue(llmPayload("SUPPORTED"));
    const viaLlm = await extractViaLlm(DOCS, { visaOrStatus: "F-1" });
    expect(compositeOf(fallback).verdict).toBe("SUPPORTED");
    expect(compositeOf(viaLlm).verdict).toBe("SUPPORTED");
  });
});
