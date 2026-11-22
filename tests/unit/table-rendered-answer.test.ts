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

// Review of 6c0811b: R2-a section heading, R2-b/c footnote markers, R2-d
// mixed prose + table citations. Tables built by hand with exact spans.
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
function handTable(page: string, spec: { header: string; columns: string[]; rows: { section?: string; label: string; cells: string[] }[]; footnotes?: { marker: string; text: string }[] }) {
  let cursor = 0;
  const span = (text: string) => {
    const start = page.indexOf(text, cursor);
    if (start < 0) throw new Error(`not on page: ${text}`);
    cursor = start + text.length;
    return { text, spans: [{ start, end: start + text.length }] };
  };
  const header = span(spec.header);
  const columnStart = header.spans[0].start;
  const columns = spec.columns.map((c) => {
    const s = page.indexOf(c, columnStart);
    return { text: c, spans: [{ start: s, end: s + c.length }], lines: [c], x0: 0, x1: 0 };
  });
  const rows = spec.rows.map((r) => ({
    ...(r.section ? { section: span(r.section) } : {}),
    label: span(r.label),
    cells: r.cells.map((c, i) => ({ ...span(c), columns: [i] })),
  }));
  const footnotes = (spec.footnotes ?? []).map((f) => ({ ...span(f.text), marker: f.marker, complete: true }));
  const table: LayoutTable = { page: 1, header: header.spans[0], columns, rows, footnotes };
  return { documentId: "doc-h", pages: [page], tables: [table] };
}

describe("review R2-a: a row's section heading is part of the rendered answer", () => {
  const page = ["BENEFIT ELITE BASIC", "IN-NETWORK SERVICES", "Specialist $30 $40", "OUT-OF-NETWORK SERVICES", "Specialist $60 $80", "End."].join("\n");
  const doc = handTable(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
    { section: "IN-NETWORK SERVICES", label: "Specialist", cells: ["$30", "$40"] },
    { section: "OUT-OF-NETWORK SERVICES", label: "Specialist", cells: ["$60", "$80"] },
  ] });
  it("renders and cites the section", () => {
    const r = renderTableAnswer([doc], [{ documentId: "doc-h", page: 1, quote: "Specialist $60 $80" }]);
    expect(typeof r === "object" && r.answerText).toBe("Specialist — OUT-OF-NETWORK SERVICES (ELITE): $60\nSpecialist — OUT-OF-NETWORK SERVICES (BASIC): $80");
    expect(typeof r === "object" && r.citations.map((c) => c.quote)).toContain("OUT-OF-NETWORK SERVICES");
  });
});

describe("review R2-b/c: footnote markers anywhere, matched exactly", () => {
  it("a marker on a column heading renders its footnote", () => {
    const page = ["BENEFIT ELITE* BASIC", "Deductible $0 $250", "Ambulance $100 $200", "* Elite benefits are paid at 50% in the first year.", "** Ambulance must be pre-approved."].join("\n");
    const doc = handTable(page, { header: "BENEFIT ELITE* BASIC", columns: ["ELITE*", "BASIC"], rows: [{ label: "Deductible", cells: ["$0", "$250"] }, { label: "Ambulance", cells: ["$100", "$200"] }], footnotes: [{ marker: "*", text: "* Elite benefits are paid at 50% in the first year." }, { marker: "**", text: "** Ambulance must be pre-approved." }] });
    const r = renderTableAnswer([doc], [{ documentId: "doc-h", page: 1, quote: "Deductible $0 $250" }]);
    expect(typeof r === "object" && r.answerText).toContain("* Elite benefits are paid at 50% in the first year.");
    expect(typeof r === "object" && r.answerText).not.toContain("pre-approved");
  });
  it("'**' on a row renders only the '**' footnote", () => {
    const page = ["BENEFIT ELITE BASIC", "Deductible $0 $250", "Ambulance** $100 $200", "* Elite benefits are paid at 50% in the first year.", "** Ambulance must be pre-approved."].join("\n");
    const doc = handTable(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [{ label: "Deductible", cells: ["$0", "$250"] }, { label: "Ambulance**", cells: ["$100", "$200"] }], footnotes: [{ marker: "*", text: "* Elite benefits are paid at 50% in the first year." }, { marker: "**", text: "** Ambulance must be pre-approved." }] });
    const r = renderTableAnswer([doc], [{ documentId: "doc-h", page: 1, quote: "Ambulance** $100 $200" }]);
    expect(typeof r === "object" && r.answerText).toContain("** Ambulance must be pre-approved.");
    expect(typeof r === "object" && r.answerText).not.toContain("Elite benefits");
  });
  it("a marker mid-cell renders its footnote; a marker with no footnote fails closed", () => {
    const page = ["BENEFIT ELITE BASIC", "Deductible $0* per year $250", "Ambulance $100 $200", "* Only after 6 months of coverage."].join("\n");
    const doc = handTable(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [{ label: "Deductible", cells: ["$0* per year", "$250"] }, { label: "Ambulance", cells: ["$100", "$200"] }], footnotes: [{ marker: "*", text: "* Only after 6 months of coverage." }] });
    const r = renderTableAnswer([doc], [{ documentId: "doc-h", page: 1, quote: "Deductible $0* per year $250" }]);
    expect(typeof r === "object" && r.answerText).toContain("* Only after 6 months of coverage.");
    const bare = { ...doc, tables: [{ ...doc.tables[0], footnotes: [] }] };
    expect(renderTableAnswer([bare], [{ documentId: "doc-h", page: 1, quote: "Deductible $0* per year $250" }])).toBe("uncitable");
  });
});

describe("review R2-d: prose and a table row cited together → cannot be confirmed", () => {
  it("the prose condition is never silently dropped", async () => {
    const page = DOC.pages[0] + "Dental benefits apply only after 12 months.\n";
    const docs = [{ ...DOC, pages: [page] }];
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Coinsurance 20%. Dental benefits apply only after 12 months.", ROW("Coinsurance"), "Dental benefits apply only after 12 months.") as never);
    const r = await answerViaLlm(docs, "What is the out-of-network coinsurance?");
    expect(r.kind).toBe("refusal");
  });
});

// Follow-up review of 02d276b (B): a short condition line is prose, never a
// bare heading — cited with a table row it makes the answer "mixed".
describe("follow-up B: short conditions are not headings", () => {
  it.each(["Not covered", "Excluded for children", "Pre-approval required", "Prior Authorization Required"])("%s", (cond) => {
    const page = DOC.pages[0] + `${cond}\n`;
    const doc = { ...DOC, pages: [page] };
    expect(renderTableAnswer([doc], [{ documentId: "doc-1", page: 1, quote: ROW("Coinsurance") }, { documentId: "doc-1", page: 1, quote: cond }])).toBe("mixed");
  });
  it("control: an allow-listed ALL-CAPS heading beside a row is not prose", () => {
    const r = renderTableAnswer([DOC], [{ documentId: "doc-1", page: 1, quote: ROW("Coinsurance") }, { documentId: "doc-1", page: 1, quote: "BENEFIT" }]);
    expect(typeof r).toBe("object");
  });
});
