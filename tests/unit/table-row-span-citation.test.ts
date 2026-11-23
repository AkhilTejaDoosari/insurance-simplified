// Owner decision 2026-11-22 (7): a table row whose label or cells repeat on
// the page is cited by ONE contiguous, verbatim span on its page — the row
// from its label through its last cell, never across another row. If that
// span is itself not unique (the same row under two sections), the span must
// start at the row's section heading; if that is still not unique, or would
// include another row, the answer cannot be confirmed. The server-rendered
// answer (label + section + column header + cell + footnotes) is unchanged.
// Logged shape (run 13, 5 of 11): a repeated cell/label/section whose row
// line also repeats → no unique citation. Synthetic pages only.
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
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";
import { answerCiting } from "../helpers/chat-refs";

beforeEach(() => vi.clearAllMocks());

/** A piece: its text, or [text, n] for the n-th (0-based) occurrence. */
type Piece = string | [string, number];
function at(page: string, p: Piece) {
  const [text, n] = typeof p === "string" ? [p, 0] : p;
  let start = -1;
  for (let k = 0; k <= n; k++) start = page.indexOf(text, start + 1);
  if (start < 0) throw new Error(`not on page: ${text}`);
  return { text, spans: [{ start, end: start + text.length }] };
}
function handDoc(page: string, spec: { header: string; columns: string[]; rows: { section?: Piece; label: Piece; cells: Piece[] }[] }) {
  const header = at(page, spec.header);
  const columns = spec.columns.map((c) => {
    const s = page.indexOf(c, header.spans[0].start);
    return { text: c, spans: [{ start: s, end: s + c.length }], lines: [c], x0: 0, x1: 0 };
  });
  const rows = spec.rows.map((r) => ({
    ...(r.section ? { section: at(page, r.section) } : {}),
    label: at(page, r.label),
    cells: r.cells.map((c, i) => ({ ...at(page, c), columns: [i] })),
  }));
  const table: LayoutTable = { page: 1, header: header.spans[0], columns, rows, footnotes: [] };
  return { documentId: "doc-s", filename: "plan.pdf", pageCount: 1, pages: [page], tables: [table] };
}
const count = (page: string, q: string) => page.split(q).length - 1;
const cite = (quote: string) => [{ documentId: "doc-s", page: 1, quote }];

function expectSoundCitations(page: string, r: ReturnType<typeof renderTableAnswer>) {
  expect(typeof r).toBe("object");
  if (typeof r !== "object" || !r) return;
  for (const c of r.citations) {
    expect(c.page).toBe(1);
    expect(count(page, c.quote)).toBe(1); // verbatim, contiguous, unique on its one page
  }
}

describe("a row whose label and cells repeat is cited by its own row span", () => {
  // Wrapped row: label and each cell on their own lines; the label and both
  // cells also occur elsewhere on the page, so no piece (or its line) is unique.
  const page = [
    "BENEFIT ELITE BASIC",
    "Emergency Room",
    "$100 copay",
    "$250 copay",
    "Urgent Care",
    "$100 copay",
    "$250 copay",
    "Emergency Room",
    "Visits are reviewed after the fact.",
  ].join("\n");
  const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
    { label: "Emergency Room", cells: ["$100 copay", "$250 copay"] },
    { label: "Urgent Care", cells: [["$100 copay", 1], ["$250 copay", 1]] },
  ] });
  const rowSpan = "Emergency Room\n$100 copay\n$250 copay";

  it("renders the unchanged server answer and cites the row span", () => {
    const r = renderTableAnswer([doc], cite(rowSpan));
    expect(typeof r === "object" && r.answerText).toBe("Emergency Room (ELITE): $100 copay\nEmergency Room (BASIC): $250 copay");
    expect(typeof r === "object" && r.citations.map((c) => c.quote)).toContain(rowSpan);
    expectSoundCitations(page, r);
  });
  it("the row span never reaches into the next row", () => {
    const r = renderTableAnswer([doc], cite(rowSpan));
    expect(typeof r === "object" && r.citations.some((c) => c.quote.includes("Urgent Care"))).toBe(false);
  });
});

describe("the same row under two sections: the section heading makes the span unique", () => {
  const page = [
    "BENEFIT ELITE BASIC",
    "IN-NETWORK SERVICES",
    "Specialist $30 $40",
    "OUT-OF-NETWORK SERVICES",
    "Specialist $30 $40",
    "End of schedule.",
  ].join("\n");
  const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
    { section: "IN-NETWORK SERVICES", label: "Specialist", cells: ["$30", "$40"] },
    { section: "OUT-OF-NETWORK SERVICES", label: ["Specialist", 1], cells: [["$30", 1], ["$40", 1]] },
  ] });
  const out = "OUT-OF-NETWORK SERVICES\nSpecialist $30 $40";
  const inn = "IN-NETWORK SERVICES\nSpecialist $30 $40";

  it("the out-of-network row is rendered with its own section and cited from that section", () => {
    const r = renderTableAnswer([doc], cite(out));
    expect(typeof r === "object" && r.answerText).toBe("Specialist — OUT-OF-NETWORK SERVICES (ELITE): $30\nSpecialist — OUT-OF-NETWORK SERVICES (BASIC): $40");
    expect(typeof r === "object" && r.citations.map((c) => c.quote)).toContain(out);
    expectSoundCitations(page, r);
    // Never the other section, never the ambiguous bare row line.
    expect(typeof r === "object" && r.citations.some((c) => c.quote === "Specialist $30 $40" || c.quote.includes("IN-NETWORK SERVICES") && !c.quote.includes("OUT-OF"))).toBe(false);
  });
  it("the in-network row is rendered with the in-network section", () => {
    const r = renderTableAnswer([doc], cite(inn));
    expect(typeof r === "object" && r.answerText).toBe("Specialist — IN-NETWORK SERVICES (ELITE): $30\nSpecialist — IN-NETWORK SERVICES (BASIC): $40");
    expectSoundCitations(page, r);
    expect(typeof r === "object" && r.citations.some((c) => c.quote.includes("OUT-OF-NETWORK"))).toBe(false);
  });
  it("an ambiguous bare row line selects no row (it cannot say which section)", () => {
    expect(renderTableAnswer([doc], cite("Specialist $30 $40"))).toBeUndefined();
  });
  it("end to end: an out-of-network claim cited by the ambiguous row line is not confirmed", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Out-of-network specialist visits cost $30.", "Specialist $30 $40") as never);
    const r = await answerViaLlm([doc], "What is the out-of-network specialist copay?");
    expect(r.kind).toBe("refusal");
    expect(JSON.stringify(r)).not.toContain("$30.");
  });
  it("end to end: cited with its section, the out-of-network row is answered from that section", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Out-of-network specialist: $30", out) as never);
    const r = await answerViaLlm([doc], "What is the out-of-network specialist copay?");
    expect(r.kind).toBe("answer");
    expect(r.kind === "answer" && r.answerText).toContain("OUT-OF-NETWORK SERVICES");
    expect(r.kind === "answer" && r.answerText).not.toMatch(/(^|[^-])IN-NETWORK/);
    if (r.kind === "answer") for (const c of r.citations) expect(count(page, c.quote)).toBe(1);
  });
});

describe("still not unique → cannot be confirmed (never across rows)", () => {
  it("a repeated row that is not the first under its section cannot reach its heading without crossing a row", () => {
    const page = [
      "BENEFIT ELITE BASIC",
      "IN-NETWORK SERVICES",
      "Primary $10 $20",
      "Specialist $30 $40",
      "OUT-OF-NETWORK SERVICES",
      "Primary $15 $25",
      "Specialist $30 $40",
    ].join("\n");
    const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
      { section: "IN-NETWORK SERVICES", label: "Primary", cells: ["$10", "$20"] },
      { section: "IN-NETWORK SERVICES", label: "Specialist", cells: ["$30", "$40"] },
      { section: "OUT-OF-NETWORK SERVICES", label: ["Primary", 1], cells: ["$15", "$25"] },
      { section: "OUT-OF-NETWORK SERVICES", label: ["Specialist", 1], cells: [["$30", 1], ["$40", 1]] },
    ] });
    expect(renderTableAnswer([doc], cite("Primary $15 $25\nSpecialist $30 $40"))).toBe("uncitable");
  });
  it("a row whose label-to-last-cell text encloses another row's text is not cited by span", () => {
    // Row 1's second cell sits below row 2's line; its span would cross row 2.
    const page = ["BENEFIT ELITE BASIC", "Ambulance $100", "Air Ambulance $100 $500", "$200", "Ambulance trips need notice."].join("\n");
    const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
      { label: "Ambulance", cells: ["$100", "$200"] },
      { label: "Air Ambulance", cells: [["$100", 1], "$500"] },
    ] });
    expect(renderTableAnswer([doc], cite("$200"))).toBe("uncitable");
  });
});

// Review of ca46603. B1: the span may hold only the row's own pieces (and,
// when it starts there, its own section heading) separated by whitespace —
// never another section's heading, a column header or a footnote.
describe("review B1: nothing but the row's own pieces inside the span", () => {
  it("another section's heading between the label and its cells → cannot be confirmed", () => {
    const page = ["BENEFIT ELITE BASIC", "IN-NETWORK SERVICES", "Specialist", "OUT-OF-NETWORK SERVICES", "$30 $40", "Primary $50 $60", "Specialist $30 $40"].join("\n");
    const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
      { section: "IN-NETWORK SERVICES", label: "Specialist", cells: ["$30", "$40"] },
      { section: "OUT-OF-NETWORK SERVICES", label: "Primary", cells: ["$50", "$60"] },
    ] });
    expect(renderTableAnswer([doc], cite("IN-NETWORK SERVICES\nSpecialist"))).toBe("uncitable");
  });
  it("a footnote line between the label and its cells → cannot be confirmed", () => {
    const page = ["BENEFIT ELITE BASIC", "Specialist", "* Out-of-network only.", "$30 $40", "Specialist $30 $40"].join("\n");
    const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
      { label: "Specialist", cells: ["$30", "$40"] },
    ] });
    expect(renderTableAnswer([doc], cite("Specialist\n* Out-of-network only."))).toBe("uncitable");
  });
});

// S1: a piece with no page spans is never covered by the row span.
describe("review S1: a cell with no spans fails closed", () => {
  it("is not rendered from a span that does not contain it", () => {
    const page = ["BENEFIT ELITE BASIC", "Specialist $30 Not covered", "Specialist only", "$30 only"].join("\n");
    const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [{ label: "Specialist", cells: ["$30", "Not covered"] }] });
    const row = doc.tables[0].rows[0];
    row.cells[1] = { ...row.cells[1], text: "Covered in full", spans: [] };
    expect(renderTableAnswer([doc], cite("Specialist $30 Not covered"))).toBe("uncitable");
  });
});

// S2: uniqueness is judged as the verifier judges it (whitespace-normalised),
// so a wrapped copy of the row escalates to the section span.
describe("review S2: uniqueness after whitespace normalisation", () => {
  const page = ["BENEFIT ELITE BASIC", "IN-NETWORK SERVICES", "Specialist $30 $40", "OUT-OF-NETWORK SERVICES", "Specialist", "$30 $40", "End of schedule."].join("\n");
  const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
    { section: "IN-NETWORK SERVICES", label: "Specialist", cells: ["$30", "$40"] },
    { section: "OUT-OF-NETWORK SERVICES", label: ["Specialist", 1], cells: [["$30", 1], ["$40", 1]] },
  ] });
  it("the wrapped out-of-network row is cited from its section heading, and that citation verifies", async () => {
    const { verifyEvidenceCitation } = await import("@/app/lib/evidence-verification");
    const r = renderTableAnswer([doc], cite("OUT-OF-NETWORK SERVICES\nSpecialist"));
    expect(typeof r === "object" && r.answerText).toBe("Specialist — OUT-OF-NETWORK SERVICES (ELITE): $30\nSpecialist — OUT-OF-NETWORK SERVICES (BASIC): $40");
    if (typeof r === "object" && r) for (const c of r.citations) expect(verifyEvidenceCitation([doc], c).ok).toBe(true);
  });
});

// S3: a piece only partly citable (one of two spans) is covered by the row span.
describe("review S3: a partly citable label is covered by the row span", () => {
  it("a wrapped label whose second line repeats is still fully cited", () => {
    const page = ["BENEFIT ELITE BASIC", "Emergency Room", "Visits", "$100 $250", "Urgent Care $50 $75", "Visits"].join("\n");
    const at0 = page.indexOf("Emergency Room");
    const at1 = page.indexOf("Visits");
    const doc = handDoc(page, { header: "BENEFIT ELITE BASIC", columns: ["ELITE", "BASIC"], rows: [
      { label: "Emergency Room", cells: ["$100", "$250"] },
      { label: "Urgent Care", cells: ["$50", "$75"] },
    ] });
    doc.tables[0].rows[0].label = { text: "Emergency Room Visits", spans: [{ start: at0, end: at0 + 14 }, { start: at1, end: at1 + 6 }] };
    const r = renderTableAnswer([doc], cite("Emergency Room"));
    expectSoundCitations(page, r);
    expect(typeof r === "object" && r.citations.map((c) => c.quote)).toContain("Emergency Room\nVisits\n$100 $250");
  });
});
