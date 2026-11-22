// Owner decision 2026-11-22 (4): grid-first shows a multi-tier row with its
// tier names instead of skipping it. A table-cell value's claim is built
// from verbatim pieces of ONE row — label, cell and that cell's column
// heading — and is grounded structurally (describeFact); its citations
// include the column heading. Observed shape: a four-tier schedule where the
// model path showed the amounts without tier names. Synthetic text only.
import { describe, expect, it } from "vitest";
import { gridFirstAnswer } from "@/app/lib/chat/grid-first";
import { extractFallback } from "@/app/lib/extraction/extract";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { validateTable } from "@/app/lib/extraction/types";
import { tableDocument } from "./helpers/table-doc";

const DOC = tableDocument("doc-1", [{
  caption: "BENEFIT",
  headings: ["ELITE", "BASIC"],
  rows: [
    ["Deductible", "$0", "$250"],
    ["Emergency Room Copayment", "$100 per visit", "$350 per visit"],
    ["Maternity Care", "Up to $5,000", "No coverage"],
  ],
}]);
const DOCS = [DOC];
const table = () => verifyComparisonTable(validateTable(extractFallback(DOCS as never, {})), DOCS as never);
const ask = (question: string) => gridFirstAnswer({ question, table: table(), scopedDocuments: DOCS, sessionDocuments: DOCS });

describe("multi-tier rows are answered with their tier names", () => {
  it.each([
    ["What is the deductible?", ["(ELITE): $0", "(BASIC): $250"]],
    ["What is the emergency room copay?", ["(ELITE): $100 per visit", "(BASIC): $350 per visit"]],
    ["Is maternity covered?", ["(ELITE): Up to $5,000", "(BASIC): No coverage"]],
  ])("%s", async (question, parts) => {
    const r = await ask(question);
    expect(r?.kind).toBe("answer");
    if (r?.kind !== "answer") return;
    for (const p of parts) expect(r.answerText).toContain(p);
    // The column headings are cited (the completed unit the user sees).
    expect(r.citations.some((c) => c.quote.includes("ELITE") && c.quote.includes("BASIC"))).toBe(true);
  });
  it("control: with a tier chosen, only that tier is shown", async () => {
    const t = table();
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: t, scopedDocuments: DOCS, sessionDocuments: DOCS, selection: { planIds: ["doc-1"], tiers: { "doc-1": "BASIC" } } });
    expect(r?.kind).toBe("answer");
    expect(r?.kind === "answer" && r.answerText).toContain("(BASIC): $250");
    expect(r?.kind === "answer" && r.answerText).not.toContain("(ELITE)");
  });
});
