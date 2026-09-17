import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractViaLlm } from "@/app/lib/extraction/extract";
import { completeJson } from "@/app/lib/llm/client";

vi.mock("@/app/lib/llm/client", () => ({
  completeJson: vi.fn(),
  isLlmConfigured: () => true,
}));
const mockedComplete = vi.mocked(completeJson);

const DOCS = [
  { documentId: "doc-1", filename: "a.pdf", pageCount: 3, pages: ["x", "y", "z"] },
  { documentId: "doc-2", filename: "b.pdf", pageCount: 2, pages: ["x", "y"] },
  { documentId: "doc-3", filename: "c.pdf", pageCount: 1, pages: ["x"] },
];

const value = (documentId: string, display: string, qualifiers: Record<string, string> = {}) => ({
  documentId,
  display,
  qualifiers,
  evidence: [{ documentId, page: 1, quote: display }],
});

function payload(rows: unknown[], documents?: unknown[]) {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: documents ?? DOCS.map(({ documentId, filename, pageCount }) => ({ documentId, filename, pageCount })),
    rows,
  };
}

describe("LLM boundary reconciliation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps upload metadata even when the model rewrites filenames or page counts", async () => {
    mockedComplete.mockResolvedValue(
      payload([], [
        { documentId: "doc-1", filename: "Patriot Travel Series", pageCount: 99 },
        { documentId: "doc-2", filename: "b.pdf", pageCount: 2 },
        { documentId: "doc-3", filename: "c.pdf", pageCount: 1 },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.documents).toEqual([
      { documentId: "doc-1", filename: "a.pdf", pageCount: 3 },
      { documentId: "doc-2", filename: "b.pdf", pageCount: 2 },
      { documentId: "doc-3", filename: "c.pdf", pageCount: 1 },
    ]);
  });

  it("treats absence-phrased displays as absence and clears a conflict they caused", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "out-of-pocket-maximum",
          verdict: "CONFLICTED",
          values: [
            value("doc-1", "Not explicitly stated"),
            value("doc-2", "$1,000 for in-network"),
            value("doc-3", "Not specified in the document"),
          ],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].values.map((v) => v.documentId)).toEqual(["doc-2"]);
    expect(table.rows[0].verdict).toBe("SUPPORTED");
  });

  it("flips a row to NOT STATED when every value was absence-phrased", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        { factName: "vision-coverage", verdict: "SUPPORTED", values: [value("doc-1", "Not mentioned")] },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0]).toEqual({ factName: "vision-coverage", verdict: "NOT STATED", values: [] });
  });

  it("records cross-plan range vs. options vs. fixed differences as SUPPORTED comparison data", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "annual-deductible",
          verdict: "CONFLICTED",
          values: [
            value("doc-1", "$0 to $2,500"),
            value("doc-2", "$0, $100, $250, or $500 per illness"),
            value("doc-3", "$400"),
          ],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("SUPPORTED");
    expect(table.rows[0].values).toHaveLength(3);
  });

  it("records a same-shape cross-plan difference as SUPPORTED, not CONFLICTED", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "urgent-care",
          verdict: "CONFLICTED",
          values: [value("doc-1", "$25 copay"), value("doc-2", "$50 copay")],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("SUPPORTED");
  });

  it("keeps a genuine same-document/same-scope contradiction as CONFLICTED", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "urgent-care",
          verdict: "CONFLICTED",
          values: [
            {
              documentId: "doc-1",
              display: "$25 copay",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 2, quote: "Urgent care copay is $25." }],
            },
            {
              documentId: "doc-1",
              display: "$50 copay",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 9, quote: "Urgent care copay is $50." }],
            },
            value("doc-2", "$25 copay"),
          ],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("CONFLICTED");
  });

  it("downgrades same-document values scoped to different tiers to SUPPORTED", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "annual-deductible",
          verdict: "CONFLICTED",
          values: [
            value("doc-1", "$250", { planTier: "Lite" }),
            value("doc-1", "$500", { planTier: "Platinum" }),
          ],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("SUPPORTED");
  });

  it("downgrades same-document values scoped to different network tiers to SUPPORTED", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        {
          factName: "annual-deductible",
          verdict: "CONFLICTED",
          values: [
            value("doc-1", "$250", { networkTier: "in-network" }),
            value("doc-1", "$500", { networkTier: "out-of-network" }),
          ],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0].verdict).toBe("SUPPORTED");
  });

  it("recovers DOES NOT APPEAR TO FIT rows that name no ruling-out context field", async () => {
    mockedComplete.mockResolvedValue(
      payload([
        { factName: "maternity-coverage", verdict: "DOES NOT APPEAR TO FIT", values: [] },
        {
          factName: "age-limits",
          verdict: "DOES NOT APPEAR TO FIT",
          values: [value("doc-1", "Under age 70")],
        },
      ]),
    );
    const table = await extractViaLlm(DOCS, {});
    expect(table.rows[0]).toEqual({ factName: "maternity-coverage", verdict: "NOT STATED", values: [] });
    expect(table.rows[1].verdict).toBe("NEEDS VERIFICATION");
    expect(table.rows[1].values).toHaveLength(1);
  });
});
