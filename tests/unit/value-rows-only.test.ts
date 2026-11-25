// Owner decision 2026-11-24 (7), display: a server-rendered grid/table answer
// shows only value rows — row label (with its section), tier/network header,
// cell — and the footnotes and restrictions that govern them. Stray header
// rows, repeated general notes, schedule introductions and marketing taglines
// are not shown (they stay cited). A note that changes a value's meaning is
// never dropped. Presentation only. Synthetic text.
import { describe, expect, it } from "vitest";
import { gridFirstAnswer } from "@/app/lib/chat/grid-first";
import { renderTableAnswer } from "@/app/lib/evidence/citation-unit";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import type { LayoutTable } from "@/app/lib/pdf/layout-tables";

interface Spec {
  /** Header line(s) exactly as on the page. */
  header: string;
  /** Stacked heading lines per column. */
  columns: string[][];
  rows: { section?: string; label: string; cells: string[] }[];
  preamble?: string;
  postscript?: string;
  footnotes?: { marker: string; text: string }[];
}

function doc(page: string, spec: Spec) {
  let cursor = 0;
  const ws = (s: string) => s.replace(/\s+/g, " ").trim();
  const find = (text: string, from: number) => {
    const start = page.indexOf(text, from);
    if (start < 0) throw new Error(`not on page: ${text}`);
    return { start, end: start + text.length };
  };
  const next = (text: string) => {
    const s = find(text, cursor);
    cursor = s.end;
    return { text: ws(text), spans: [s] };
  };
  const anywhere = (text: string) => ({ text: ws(text), spans: [find(text, 0)] });
  const header = next(spec.header).spans[0];
  let columnCursor = header.start;
  const columns = spec.columns.map((lines) => {
    const spans = lines.map((l) => {
      const s = find(l, columnCursor);
      columnCursor = s.end;
      return s;
    });
    return { text: lines.join(" "), lines, spans, x0: 0, x1: 0 };
  });
  const rows = spec.rows.map((r) => ({
    ...(r.section ? { section: next(r.section) } : {}),
    label: next(r.label),
    cells: r.cells.map((c, i) => ({ ...next(c), columns: [i] })),
  }));
  const table: LayoutTable = {
    page: 1, header, columns, rows,
    footnotes: (spec.footnotes ?? []).map((f) => ({ ...anywhere(f.text), marker: f.marker, complete: true })),
    ...(spec.preamble ? { preamble: anywhere(spec.preamble) } : {}),
    ...(spec.postscript ? { postscript: anywhere(spec.postscript) } : {}),
  };
  return { documentId: "doc-1", filename: "doc-1.pdf", pageCount: 1, pages: [page], tables: [table] };
}

async function grid(d: ReturnType<typeof doc>, question = "What is the deductible?") {
  const table = verifyComparisonTable(validateTable(extractFallback([d] as never, {})), [d] as never);
  const r = await gridFirstAnswer({ question, table, scopedDocuments: [d], sessionDocuments: [d] });
  expect(r?.kind).toBe("answer");
  if (r?.kind !== "answer") throw new Error("no answer");
  for (const c of r.citations) expect(verifyEvidenceCitation([d], c).ok).toBe(true);
  return r;
}

describe("stray header rows and general notes", () => {
  const NOTE = "Eligible expenses are subject to applicable copayments and the overall maximum, and are per certificate period\nunless specifically indicated otherwise.";
  const d = doc(["BENEFIT ELITE BASIC", "Deductible $0 $250", NOTE].join("\n"), {
    header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]],
    rows: [{ label: "Deductible", cells: ["$0", "$250"] }], postscript: NOTE,
  });
  it("only the value rows are shown", async () => {
    expect((await grid(d)).answerText).toBe("Deductible (ELITE): $0\nDeductible (BASIC): $250");
  });
  it("the header and the note stay cited", async () => {
    const cited = (await grid(d)).citations.map((c) => c.quote).join("\n");
    expect(cited).toContain("BENEFIT ELITE BASIC");
    expect(cited).toContain("Eligible expenses");
  });
  it("a rephrase is given the value rows only", async () => {
    const table = verifyComparisonTable(validateTable(extractFallback([d] as never, {})), [d] as never);
    let lines: string[] = [];
    await gridFirstAnswer({ question: "What is the deductible?", table, scopedDocuments: [d], sessionDocuments: [d], rephrase: async (f) => { lines = f.lines; return { answerText: "", citations: [] }; } });
    expect(lines).toEqual(["Deductible (ELITE): $0", "Deductible (BASIC): $250"]);
  });
});

describe("schedule introductions, section headings and taglines", () => {
  const INTRO = "SCHEDULE OF BENEFITS\nAll benefits shown below are in United States dollar amounts. Unless otherwise stated, all benefits are per person.";
  const page = [INTRO, "Travel Basic\nReliable Coverage\nTravel Choice\nMost popular", "PLAN OPTIONS", "Deductible Options $0 - $5,000 $0 - $2,500"].join("\n");
  const d = doc(page, {
    header: "Travel Basic\nReliable Coverage\nTravel Choice\nMost popular", columns: [["Travel Basic", "Reliable Coverage"], ["Travel Choice", "Most popular"]],
    rows: [{ section: "PLAN OPTIONS", label: "Deductible Options", cells: ["$0 - $5,000", "$0 - $2,500"] }], preamble: INTRO,
  });
  const ROWS = "Deductible Options — PLAN OPTIONS (Travel Basic): $0 - $5,000\nDeductible Options — PLAN OPTIONS (Travel Choice): $0 - $2,500";
  it("grid: the section joins the label; introduction and taglines are not shown", async () => {
    expect((await grid(d)).answerText).toBe(ROWS);
  });
  it("model-selected table row: the same value rows, taglines not shown, header still cited", () => {
    const r = renderTableAnswer([d], [{ documentId: "doc-1", page: 1, quote: "Deductible Options $0 - $5,000 $0 - $2,500" }]);
    expect(typeof r === "object" && r.answerText).toBe(ROWS);
    expect(typeof r === "object" && r.citations.map((c) => c.quote)).toContain("Travel Basic");
  });
});

describe("what governs a value is never dropped", () => {
  it("a heading line that scopes the column is not a tagline", async () => {
    const d = doc(["United States\nIn-Network\nUnited States\nOut-of-Network", "Deductible $100 $500"].join("\n"), {
      header: "United States\nIn-Network\nUnited States\nOut-of-Network", columns: [["United States", "In-Network"], ["United States", "Out-of-Network"]],
      rows: [{ label: "Deductible", cells: ["$100", "$500"] }],
    });
    const r = renderTableAnswer([d], [{ documentId: "doc-1", page: 1, quote: "Deductible $100 $500" }]);
    const text = typeof r === "object" ? r.answerText : "";
    expect(text).toBe("Deductible (United States In-Network): $100\nDeductible (United States Out-of-Network): $500");
  });
  it.each(["Accident Only", "Per Person", "Inpatient", "Students", "Limit", "Coverage"])("'%s' under a tier name is kept", (line) => {
    const header = `Travel Basic\n${line}\nTravel Choice\nMost popular`;
    const d = doc([header, "Deductible $100 $500"].join("\n"), {
      header, columns: [["Travel Basic", line], ["Travel Choice", "Most popular"]], rows: [{ label: "Deductible", cells: ["$100", "$500"] }],
    });
    const r = renderTableAnswer([d], [{ documentId: "doc-1", page: 1, quote: "Deductible $100 $500" }]);
    expect(typeof r === "object" && r.answerText).toBe(`Deductible (Travel Basic ${line}): $100\nDeductible (Travel Choice Most popular): $500`);
  });
  it("a tagline is kept when the headings would be the same without it", () => {
    const header = "Travel Basic\nMost popular\nTravel Basic\nBest value";
    const d = doc([header, "Deductible $100 $500"].join("\n"), {
      header, columns: [["Travel Basic", "Most popular"], ["Travel Basic", "Best value"]], rows: [{ label: "Deductible", cells: ["$100", "$500"] }],
    });
    const r = renderTableAnswer([d], [{ documentId: "doc-1", page: 1, quote: "Deductible $100 $500" }]);
    expect(typeof r === "object" && r.answerText).toContain("(Travel Basic Best value): $500");
  });
  // Review of a63a772 (B11): a tagline is cut only when every second line is
  // one, and never when a cut heading would be, or begin, another's name.
  it.each([
    [["Travel", "Best Value"], ["Travel Basic"], "(Travel Best Value): $100", "(Travel Basic): $500"],
    [["Gold", "Recommended"], ["Gold", "Standard"], "(Gold Recommended): $100", "(Gold Standard): $500"],
    [["Travel", "Best Value"], ["Travel Basic", "Most popular"], "(Travel Best Value): $100", "(Travel Basic Most popular): $500"],
  ])("%j / %j keep their names", (a, b, x, y) => {
    const header = [...a, ...b].join("\n");
    const d = doc([header, "Deductible $100 $500"].join("\n"), { header, columns: [a, b], rows: [{ label: "Deductible", cells: ["$100", "$500"] }] });
    const r = renderTableAnswer([d], [{ documentId: "doc-1", page: 1, quote: "Deductible $100 $500" }]);
    const text = typeof r === "object" ? r.answerText : "";
    expect(text).toContain(x);
    expect(text).toContain(y);
  });
  // B10: the section, now in the label, stays mandatory in a rephrase.
  it.each(["INPATIENT SERVICES", "STUDENTS", "ACCIDENT BENEFIT"])("a rephrase cannot drop the section %s", async (section) => {
    const d = doc(["BENEFIT ELITE BASIC", section, "Deductible $0 $250"].join("\n"), { header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ section, label: "Deductible", cells: ["$0", "$250"] }] });
    const table = verifyComparisonTable(validateTable(extractFallback([d] as never, {})), [d] as never);
    for (const text of ["BENEFIT (ELITE) (BASIC)\nDeductible $0 $250", "BENEFIT (ELITE) (BASIC). Deductible $0 $250."]) {
      const r = await gridFirstAnswer({ question: "What is the deductible?", table, scopedDocuments: [d], sessionDocuments: [d], rephrase: async (f) => ({ answerText: text, citations: f.citations }) });
      expect(r?.kind === "answer" && r.answerText).toBe(`Deductible — ${section} (ELITE): $0\nDeductible — ${section} (BASIC): $250`);
    }
  });
  // B9: only closed introductory sentences are hidden; any other is shown.
  it.each([
    "All amounts shown below are in Canadian dollars.", "Preauthorization is required for all benefits shown below.", "All benefits shown below must be authorised.",
    "All benefits shown below require approval by the Administrator.", "All benefits shown below are payable outside the United States.", "The following benefits apply while travelling in Canada.",
    "All benefits shown below apply when treatment is received in a hospital.", "All benefits shown below are for accidents.", "All benefits shown below are for dependents of the student.",
    "The following benefits apply if the traveller is a student.", "All benefits shown below are per family.", "All benefits shown below are per injury or sickness.", "All benefits shown below are per lifetime.",
    "All benefits shown below are subject to the deductible.", "All benefits shown below are for treatment within the PPO.", "All benefits shown below are secondary to other insurance.", "The following benefits are combined with dental.",
    "The following benefits apply during the first year of coverage.", "All benefits shown below exclude taxes.", "Unless otherwise stated to students, all benefits shown below are per person.", "All benefits shown below are up to fifty thousand dollars.",
  ])("introduction shown: %s", async (text) => {
    const d = doc([text, "BENEFIT ELITE BASIC", "Deductible $0 $250"].join("\n"), { header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ label: "Deductible", cells: ["$0", "$250"] }], preamble: text });
    expect((await grid(d)).answerText).toContain(text);
  });
  it.each(["All benefits are subject to preauthorization.", "Eligible expenses must be approved in advance.", "All benefits are subject to the deductible."])("general note shown: %s", async (text) => {
    const d = doc(["BENEFIT ELITE BASIC", "Deductible $0 $250", text].join("\n"), { header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ label: "Deductible", cells: ["$0", "$250"] }], postscript: text });
    expect((await grid(d)).answerText).toContain(text);
  });
  it("an introduction that also states a restriction keeps that sentence only", async () => {
    const text = "SCHEDULE OF BENEFITS\nAll benefits shown below are in United States dollar amounts. All medical and dental benefits are subject to deductible and/or copay and coinsurance. Unless otherwise stated, all benefits are per person, per period of coverage, and they are provided up to the amount shown. You have 90 days to receive treatment from the date of an injury.";
    const d = doc([text, "BENEFIT ELITE BASIC", "Deductible $0 $250"].join("\n"), { header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ label: "Deductible", cells: ["$0", "$250"] }], preamble: text });
    expect((await grid(d)).answerText).toBe("Deductible (ELITE): $0\nYou have 90 days to receive treatment from the date of an injury.\nDeductible (BASIC): $250");
  });
  it("a footnote reached by its marker is shown", async () => {
    const d = doc(["BENEFIT ELITE BASIC", "Deductible* $0 $250", "* Waived at the student health center."].join("\n"), {
      header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ label: "Deductible*", cells: ["$0", "$250"] }],
      footnotes: [{ marker: "*", text: "* Waived at the student health center." }],
    });
    expect((await grid(d)).answerText).toBe("Deductible* (ELITE): $0\n* Waived at the student health center.\nDeductible* (BASIC): $250");
  });
  it.each([
    ["introduction", "preamble", "All benefits shown below are not covered outside the United States."],
    ["restriction heading", "preamble", "Emergency Services NOT Subject to Deductible unless otherwise noted"],
    ["restriction heading without a marker word", "preamble", "Inpatient Services Subject to Deductible unless otherwise noted"],
    ["general note", "postscript", "Benefits are excluded during the first 30 days."],
    ["introduction with an amount", "preamble", "All benefits shown below are limited to $50,000 from age 70."],
    ["introduction with a percentage", "preamble", "All benefits shown below are paid at 50% outside the network."],
    ["introduction with a condition", "preamble", "All benefits shown below apply only to students."],
    ["introduction with a waiting period", "preamble", "All benefits shown below start after 30 days."],
    ["general note with a limit", "postscript", "Benefits are limited to Usual, Reasonable and Customary charges."],
    ["general note with its own exception", "postscript", "Benefits are per period unless the plan is renewed."],
  ])("a %s that states a restriction is shown: %s", async (_kind, slot, text) => {
    const body = ["BENEFIT ELITE BASIC", "Deductible $0 $250"];
    const page = (slot === "preamble" ? [text, ...body] : [...body, text]).join("\n");
    const d = doc(page, { header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ label: "Deductible", cells: ["$0", "$250"] }], [slot]: text });
    expect((await grid(d)).answerText).toContain(text);
  });
  it("a label sub-note stays with its row", async () => {
    const d = doc(["BENEFIT ELITE BASIC", "Emergency Room • Waived if admitted $100 $350"].join("\n"), {
      header: "BENEFIT ELITE BASIC", columns: [["ELITE"], ["BASIC"]], rows: [{ label: "Emergency Room • Waived if admitted", cells: ["$100", "$350"] }],
    });
    expect((await grid(d, "What is the emergency room copay?")).answerText).toContain("Waived if admitted");
  });
});
