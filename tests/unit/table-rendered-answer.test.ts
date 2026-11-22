// Owner decision 2026-11-22 (5) rule 2: when the model's citation completes
// to a table cell, the model only selects the row/cell; the server writes the
// answer from the completed unit (row label + column header + cell), as
// grid-first does. Model wording is never used for table values. Logged
// shapes: a cell answered without its column label (3), a wrapped
// capitalised row label (2), a tier row without tier names (1). Synthetic.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => true),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));

import { answerViaLlm } from "@/app/lib/rag/answer";
import { renderTableAnswer } from "@/app/lib/evidence/citation-unit";
import { completeJson } from "@/app/lib/llm/client";
import { answerCiting } from "../helpers/chat-refs";
import { tableDocument } from "./helpers/table-doc";

const DOC = tableDocument("doc-1", [{
  caption: "BENEFIT",
  headings: ["In-Network", "Out-of-Network"],
  rows: [
    ["Coinsurance", "Insured pays 10%", "Insured pays 20%"],
    ["Overall Maximum Limit", "$5,000,000", "$1,000,000"],
    ["Emergency Room", "$100 copay", "$250 copay"],
  ],
}]);
const DOCS = [{ ...DOC }];
const ROW = (label: string) => DOC.pages[0].split("\n").find((l) => l.startsWith(label))!;
beforeEach(() => vi.clearAllMocks());

async function ask(question: string, answer: string, cited: string) {
  vi.mocked(completeJson).mockImplementationOnce(answerCiting(answer, cited) as never);
  return answerViaLlm(DOCS, question);
}

describe("a cited cell is answered by the server with its row label and column header", () => {
  it("cell without its column label (logged shape) → rendered with the column header", async () => {
    // The model cites by line range, so it selects the row's page line.
    const r = await ask("What is the out-of-network coinsurance?", "Insured pays 20%", ROW("Coinsurance"));
    expect(r.kind).toBe("answer");
    expect(r.kind === "answer" && r.answerText).toBe("Coinsurance (In-Network): Insured pays 10%\nCoinsurance (Out-of-Network): Insured pays 20%");
  });
  it("the model's wording is not used for table values (a wrong figure is ignored)", async () => {
    const r = await ask("What is the out-of-network coinsurance?", "Insured pays 99%", ROW("Coinsurance"));
    expect(r.kind === "answer" && r.answerText).toBe("Coinsurance (In-Network): Insured pays 10%\nCoinsurance (Out-of-Network): Insured pays 20%");
    expect(JSON.stringify(r)).not.toContain("99%");
  });
  it("a cited row label → every cell of the row with its tier/network name (logged: maximum without tiers)", async () => {
    const r = await ask("What is the annual maximum?", "Overall Maximum Limit $5,000,000 $1,000,000", ROW("Overall Maximum Limit"));
    expect(r.kind === "answer" && r.answerText).toBe(
      "Overall Maximum Limit (In-Network): $5,000,000\nOverall Maximum Limit (Out-of-Network): $1,000,000",
    );
  });
  it("every piece is cited verbatim from the page", async () => {
    const r = await ask("What is the emergency room copay?", "$250 copay", ROW("Emergency Room"));
    expect(r.kind).toBe("answer");
    if (r.kind !== "answer") return;
    for (const c of r.citations) expect(DOC.pages[0].includes(c.quote)).toBe(true);
    const all = r.citations.map((c) => c.quote).join("\n");
    for (const piece of ["Emergency Room", "Out-of-Network", "$250 copay"]) expect(all).toContain(piece);
  });
});

describe("prose citations are unchanged", () => {
  it("renderTableAnswer returns nothing for a citation outside any table", () => {
    const doc = { documentId: "doc-2", pages: ["Dental treatment is covered for accidental injury only."] };
    expect(renderTableAnswer([doc], [{ documentId: "doc-2", page: 1, quote: "Dental treatment is covered for accidental injury only." }])).toBeUndefined();
  });
});
