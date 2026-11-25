// Owner decision 2026-11-24 (7), safety: an answer stating an exclusion or
// limitation is not verified when the same section states an exception to it
// ("except", "unless", "acute onset", "other than") that the answer omits.
// Synthetic text only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => true),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));

import { omitsException } from "@/app/lib/evidence/omitted-exception";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";
import { answerViaLlm } from "@/app/lib/rag/answer";
import { gridFirstAnswer } from "@/app/lib/chat/grid-first";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { completeJson } from "@/app/lib/llm/client";
import { answerCiting } from "../helpers/chat-refs";
import { tableDocument } from "./helpers/table-doc";

beforeEach(() => vi.clearAllMocks());

const verify = (answer: string, pages: string | string[], ...quotes: (string | [string, number])[]) => {
  const list = Array.isArray(pages) ? pages : [pages];
  const cites = quotes.map((q) => (typeof q === "string" ? { documentId: "d", page: 1, quote: q } : { documentId: "d", page: q[1], quote: q[0] }));
  return verifyAnswerClaims(answer, cites, cites, [{ documentId: "d", pages: list }]);
};
const rejected = (r: ReturnType<typeof verify>) => expect(r).toMatchObject({ ok: false, reason: "exception-omitted" });

const EXCL = "Charges resulting from any Pre-existing Condition are excluded from coverage.";

describe("the exception follows in the same section", () => {
  it.each([
    ["except", "Except that an emergency within the first 24 hours is paid."],
    ["unless", "Unless the condition was stable for 12 months, no benefit is paid."],
    ["other than", "Other than prescribed medication, no follow-up is paid."],
    ["acute onset", "Acute onset of a Pre-existing Condition is paid up to the overall limit."],
    ["mid-sentence unless", "This exclusion applies unless the condition was stable for 12 months."],
    ["exception noun", "This exclusion has one exception: stable conditions."],
  ])("%s: omitted → rejected", (_n, exception) => {
    rejected(verify(EXCL, `PRE-EXISTING CONDITIONS\n${EXCL}\n${exception}\nMATERNITY CARE\nMaternity is covered.`, EXCL));
  });
  it("control: stated in full → verified", () => {
    const ex = "Except that an emergency within the first 24 hours is paid.";
    expect(verify(`${EXCL}\n${ex}`, `PRE-EXISTING CONDITIONS\n${EXCL}\n${ex}\nMATERNITY CARE\nMaternity is covered.`, EXCL, ex).ok).toBe(true);
  });
  it("only the marker word is not the exception", () => {
    const ex = "This exclusion applies unless the condition was stable for 12 months.";
    const other = "Vision is excluded unless listed.";
    rejected(verify(`${EXCL}\n${other}`, `PRE-EXISTING CONDITIONS\n${EXCL}\n${ex}\nVISION CARE\n${other}`, EXCL, other));
  });
  it("the exception wraps over several lines", () => {
    rejected(verify(EXCL, `PRE-EXISTING CONDITIONS\n${EXCL}\nThis exclusion does not apply\nunless the condition was\nstable for 12 months.\nEND NOTES`, EXCL));
  });
  it("the exception stands before the exclusion in the section", () => {
    rejected(verify(EXCL, `PRE-EXISTING CONDITIONS\nExcept for acute onset, the rule below applies.\n${EXCL}\nMATERNITY CARE\nMaternity is covered.`, EXCL));
  });
  it("a following heading that repeats the section's subject is the same section", () => {
    rejected(verify(EXCL, `Pre-existing Conditions\n${EXCL}\nAcute Onset of Pre-existing Conditions\n• Insured Person must be under 70 years of age\nMaternity Care\nMaternity is covered.`, EXCL));
  });
  it("the section continues on the next page", () => {
    rejected(verify(EXCL, [`PRE-EXISTING CONDITIONS\n${EXCL}`, "This exclusion does not apply to acute onset.\nMATERNITY CARE\nMaternity is covered."], EXCL));
  });
  it("the section began on the previous page", () => {
    rejected(verify(EXCL, ["PRE-EXISTING CONDITIONS\nThe following applies except for acute onset.", `${EXCL}\nMATERNITY CARE\nMaternity is covered.`], [EXCL, 2]));
  });
  it.each(["Dental treatment is limited to $500 per year.", "No coverage for dental treatment.", "Dental treatment is not payable.", "Dental treatment is covered only for injury.", "Dental treatment will not be reimbursed."])("a limitation counts: %s", (line) => {
    rejected(verify(line, `DENTAL\n${line}\nDental treatment after an accident is paid in full unless elective.\nVISION\nVision is covered.`, line));
  });
  it("a curly apostrophe, capitals and a line-wrapped marker are read the same", () => {
    rejected(verify(EXCL, `PRE-EXISTING CONDITIONS\n${EXCL}\nThis exclusion applies to all conditions OTHER\nTHAN stable ones.\nMATERNITY CARE`, EXCL));
  });
});

describe("not an exception to the stated exclusion", () => {
  it("another section's exception", () => {
    expect(verify(EXCL, `PRE-EXISTING CONDITIONS\n${EXCL}\nMATERNITY CARE\nMaternity is covered except elective procedures.`, EXCL).ok).toBe(true);
  });
  it("another numbered exclusion's exception", () => {
    const line = "(5) MATERNITY CARE: Charges for delivery are excluded from this insurance.";
    expect(verify("Maternity care: Charges for delivery are excluded from this insurance.", `(4) CONDITIONS: Charges for conditions are excluded except acute onset.\n${line}\n(6) VISION: Charges for lenses are excluded unless after surgery.`, line).ok).toBe(true);
  });
  it("another bullet's exception on another subject", () => {
    const line = "• Dental treatment is not covered";
    expect(verify(line, `EXCLUSIONS\n${line}\n• Vision lenses are not covered except after surgery`, line).ok).toBe(true);
  });
  it("another bullet's exception on the SAME subject counts", () => {
    const line = "• Dental treatment is not covered";
    rejected(verify(line, `EXCLUSIONS\n${line}\n• Vision is not covered\n• Dental injury is paid unless elective`, line));
  });
  it("'unless otherwise noted' states no exception of its own", () => {
    expect(verify(EXCL, `PRE-EXISTING CONDITIONS\n${EXCL}\nAll limits are per person unless otherwise noted.\nMATERNITY CARE`, EXCL).ok).toBe(true);
  });
  it("'unless otherwise noted' does not hide a second, real exception", () => {
    rejected(verify(EXCL, `PRE-EXISTING CONDITIONS\n${EXCL}\nUnless otherwise noted, this applies except for stable conditions.\nMATERNITY CARE`, EXCL));
  });
  it("an answer that states no exclusion or limitation is unaffected", () => {
    const line = "Dental treatment is covered at 80%.";
    expect(verify(line, `DENTAL\n${line}\nImplants are covered unless elective.`, line).ok).toBe(true);
  });
  it("an exception inside the stated sentence itself is already in the answer", () => {
    const line = "Dental treatment is excluded except for accidental injury.";
    expect(verify(line, `DENTAL\n${line}\nVISION\nVision is covered.`, line).ok).toBe(true);
  });
});

describe("shapes seen on real pages (replay of earlier answers)", () => {
  const LIST = `Pre-existing Conditions\n${EXCL}\n• Maximum Limit: 12 visits`;
  it("a new page about something else is not the same section", () => {
    const text = `${EXCL}\n• Maximum Limit: 12 visits`;
    expect(verify(text, [LIST, "Form 12 Page 4\nInpatient Services\nLimits per visit unless stated as Maximum Limit\nLaboratory 90%"], text).ok).toBe(true);
  });
  it.each([
    ["opens with the marker", "Except that an emergency within the first 24 hours is paid."],
    ["refers back", "This exclusion does not apply to stable conditions, unless treated abroad."],
    ["names the subject", "Pre-existing heart disease is paid unless treated abroad."],
  ])("but an exception on the next page that %s counts", (_n, ex) => {
    rejected(verify(EXCL, [`Pre-existing Conditions\n${EXCL}`, `${ex}\nMATERNITY CARE`], EXCL));
  });
  const HOME = "Benefits incurred in your home country are not covered under this plan.";
  it("a 'Label:' paragraph is its own item", () => {
    expect(verify(HOME, `BENEFITS\n${HOME}\nSurgical expenses: fees of a surgeon.\nLaboratory expenses: fees for tests.\nIntensive care unit expenses: the daily room rate for nursing other than private duty nursing.`, HOME).ok).toBe(true);
    // Review of a63a772 (B3): directly after the exclusion it counts.
    rejected(verify(HOME, `BENEFITS\n${HOME}\nIntensive care unit expenses: the daily room rate for nursing other than private duty nursing.`, HOME));
  });
  it.each(["Exception: emergency visits home of up to 14 days.", "Exceptions: emergency visits home of up to 14 days."])("'%s' is not such an item", (ex) => {
    rejected(verify(HOME, `BENEFITS\n${HOME}\nIntensive care unit expenses: the daily room rate.\n${ex}`, HOME));
  });
  it("a 'Label:' paragraph on the same subject counts", () => {
    rejected(verify(HOME, `BENEFITS\n${HOME}\nHome country visits: paid for emergencies unless longer than 14 days.`, HOME));
  });
  it("another row's 'acute onset' label is not an exception to maternity", () => {
    const doc = tableDocument("d", [{ caption: "BENEFIT", headings: ["ELITE", "BASIC"], rows: [["Vaccines", "$10", "No coverage"], ["Acute Onset", "$25,000", "$10,000"], ["Maternity Care", "Up to $5,000", "No coverage"]] }]);
    const line = doc.pages[0].split("\n").find((l) => l.startsWith("Maternity Care "))!.trim();
    const cites = [{ documentId: "d", page: 1, quote: line }];
    expect(omitsException("Maternity Care (BASIC): No coverage", cites, [doc])).toBe(false);
    // Without the table layout the rows cannot be told apart: read widely.
    expect(omitsException("Maternity Care (BASIC): No coverage", cites, [{ ...doc, tables: [] }])).toBe(true);
  });
  it("'acute onset' is an exception to a pre-existing exclusion named only by its heading", () => {
    const line = "Charges for such conditions are excluded from coverage.";
    rejected(verify(line, `PRE-EXISTING CONDITIONS\n${line}\nAcute onset is paid in full.\nMATERNITY CARE`, line));
  });
});

describe("every answer path applies the rule", () => {
  const PAGE = `PRE-EXISTING CONDITIONS\n${EXCL}\nThis exclusion does not apply to acute onset.\nMATERNITY CARE\nMaternity is covered.`;
  it("model prose: refused as cannot be confirmed, with a closed reason code", async () => {
    const reasons: (string | undefined)[] = [];
    vi.mocked(completeJson).mockImplementationOnce(answerCiting(EXCL, EXCL) as never);
    const r = await answerViaLlm([{ documentId: "d", filename: "d.pdf", pageCount: 1, pages: [PAGE] }], "Are pre-existing conditions covered?", { onRejection: (x) => reasons.push(x.reason) });
    expect(r.kind).toBe("refusal");
    expect(reasons).toEqual(["exception-omitted"]);
  });
  const TABLE = tableDocument("doc-1", [{
    caption: "BENEFIT", headings: ["ELITE", "BASIC"],
    rows: [["Deductible", "$0", "$250"], ["Emergency Room Copayment", "$100 per visit", "$350 per visit"], ["Maternity Care", "Up to $5,000", "No coverage"]],
    trailer: ["Maternity Care is paid for BASIC members unless the pregnancy began before enrolment."],
  }]);
  it("model-selected table row", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("No coverage", TABLE.pages[0].split("\n").find((l) => l.startsWith("Maternity Care "))!) as never);
    const r = await answerViaLlm([{ ...TABLE }], "Is maternity covered?");
    expect(r.kind).toBe("refusal");
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("$250", TABLE.pages[0].split("\n").find((l) => l.startsWith("Deductible "))!) as never);
    expect((await answerViaLlm([{ ...TABLE }], "What is the deductible?")).kind).toBe("answer");
  });
  it("grid-first table cell", async () => {
    const t = verifyComparisonTable(validateTable(extractFallback([TABLE] as never, {})), [TABLE] as never);
    const row = t.rows.find((r) => r.factName === "maternity-coverage");
    expect(row?.values.length).toBeGreaterThan(0);
    // The trailer must not already have been carried as a governing note.
    expect(row?.values.every((v) => !v.display.includes("unless"))).toBe(true);
    expect(await gridFirstAnswer({ question: "Is maternity covered?", table: t, scopedDocuments: [TABLE], sessionDocuments: [TABLE] })).toBeUndefined();
  });
  it("grid-first tells rows apart: another row's own exception does not block this one", async () => {
    const doc = tableDocument("doc-1", [{ caption: "BENEFIT", headings: ["ELITE", "BASIC"], rows: [["Deductible", "$0", "$250"], ["Emergency Room Copayment", "$100 unless admitted", "$350 unless admitted"], ["Maternity Care", "Up to $5,000", "No coverage"]] }]);
    const t = verifyComparisonTable(validateTable(extractFallback([doc] as never, {})), [doc] as never);
    const r = await gridFirstAnswer({ question: "Is maternity covered?", table: t, scopedDocuments: [doc], sessionDocuments: [doc] });
    expect(r?.kind === "answer" && r.answerText).toBe("Maternity Care (ELITE): Up to $5,000\nMaternity Care (BASIC): No coverage");
  });
  it("control: the table's other row is unaffected", async () => {
    const t = verifyComparisonTable(validateTable(extractFallback([TABLE] as never, {})), [TABLE] as never);
    const r = await gridFirstAnswer({ question: "What is the deductible?", table: t, scopedDocuments: [TABLE], sessionDocuments: [TABLE] });
    expect(r?.kind).toBe("answer");
  });
});
