import { describe, expect, it, vi } from "vitest";
import { summarizeCareDisplay } from "@/app/lib/extraction/care-display";
import { extractFallback, extractViaLlm } from "@/app/lib/extraction/extract";
import { completeJson } from "@/app/lib/llm/client";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));

const mockedComplete = vi.mocked(completeJson);

const doc = (pages: string[]) => ({
  documentId: "doc-1",
  filename: "a.pdf",
  pageCount: pages.length,
  pages,
});

describe("summarizeCareDisplay", () => {
  it("condenses visit copays to You pay per visit", () => {
    expect(summarizeCareDisplay("urgent-care", "Urgent care copay $20 per visit.")).toEqual({
      display: "You pay $20/visit",
      certain: true,
    });
  });

  it("condenses ER deductibles without inventing shares", () => {
    expect(
      summarizeCareDisplay("emergency-care", "Emergency room deductible $500 per visit."),
    ).toEqual({ display: "$500 ER deductible", certain: true });
  });

  it("names covered-after-deductible plainly", () => {
    expect(
      summarizeCareDisplay("hospitalization", "Inpatient care covered after deductible is met."),
    ).toEqual({ display: "Covered after deductible", certain: true });
  });

  it("bounds traumatic-only dental instead of implying routine coverage", () => {
    expect(
      summarizeCareDisplay("dental-coverage", "Dental injuries from accidents: traumatic dental only."),
    ).toEqual({ display: "Emergency/traumatic dental only", certain: true });
  });

  it("leaves unmatched prose untouched for evidence honesty", () => {
    const line = "Hospitalization: covered with prior authorization required.";
    expect(summarizeCareDisplay("hospitalization", line)).toEqual({
      display: line,
      certain: false,
    });
  });
});

describe("care parent consolidation", () => {
  it("emergency copay evidence feeds Emergency room, never a separate row", () => {
    const table = extractFallback(
      [doc(["Emergency copay: $100, waived if admitted."])],
      {},
    );
    expect(table.rows.some((r) => r.factName === "emergency-copay")).toBe(false);
    const row = table.rows.find((r) => r.factName === "emergency-care")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0].display).toBe("You pay $100 ER copay");
  });

  it("detail lines attach to parents: ICU, anesthesia, walk-in", () => {
    const table = extractFallback(
      [
        doc([
          "Intensive care unit: $1,000 per day.",
          "Anesthesia covered at 80% of allowed charges.",
          "Walk-in clinic visits: $20 copay.",
        ]),
      ],
      {},
    );
    expect(table.rows.find((r) => r.factName === "hospitalization")?.verdict).toBe("SUPPORTED");
    expect(table.rows.find((r) => r.factName === "surgery")?.verdict).toBe("SUPPORTED");
    const urgent = table.rows.find((r) => r.factName === "urgent-care")!;
    expect(urgent.values[0].display).toBe("You pay $20/visit");
  });

  it("evacuation-style benefits never become Care rows", () => {
    const table = extractFallback(
      [doc(["Emergency medical evacuation up to $1,000,000."])],
      {},
    );
    const careFacts = [
      "primary-care-visit", "specialist-visit", "urgent-care", "emergency-care",
      "hospitalization", "surgery", "prescriptions", "mental-health",
      "maternity-coverage", "preventive-care", "lab-and-imaging", "ambulance",
      "dental-coverage", "vision-coverage",
    ];
    for (const name of careFacts) {
      expect(table.rows.find((r) => r.factName === name)?.verdict).toBe("NOT STATED");
    }
  });

  it("LLM path rewrites care displays through the same interpreter", async () => {
    mockedComplete.mockResolvedValue({
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
      rows: [
        {
          factName: "urgent-care",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$20",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Urgent care copay $20 per visit." }],
            },
          ],
        },
      ],
    });
    const table = await extractViaLlm([doc(["Urgent care copay $20 per visit."])], {});
    const row = table.rows.find((r) => r.factName === "urgent-care")!;
    expect(row.values[0].display).toBe("You pay $20/visit");
  });
});
