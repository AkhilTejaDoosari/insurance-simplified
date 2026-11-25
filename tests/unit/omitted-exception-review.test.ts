// Review of a63a772 (B1–B8, S1–S3): the omitted-exception rule reads widely.
// A section ends only at a heading that is positively about another topic; an
// exception is excused only when it is positively about another subject in its
// own item or table row. Synthetic text only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => true),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));

import { answerViaLlm } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import { omitsException } from "@/app/lib/evidence/omitted-exception";
import { renderTableAnswer } from "@/app/lib/evidence/citation-unit";
import { answerCiting } from "../helpers/chat-refs";
import { tableDocument } from "./helpers/table-doc";

beforeEach(() => vi.clearAllMocks());

type Quote = string | [string, number];
const omits = (answer: string, pages: string | string[], ...quotes: Quote[]) =>
  omitsException(answer, quotes.map((q) => (typeof q === "string" ? { documentId: "d", page: 1, quote: q } : { documentId: "d", page: q[1], quote: q[0] })), [{ documentId: "d", pages: Array.isArray(pages) ? pages : [pages] }]);

const E = "Charges resulting from any Pre-existing Condition are excluded from coverage.";
const H = "PRE-EXISTING CONDITIONS";
const T = "MATERNITY CARE\nMaternity is covered.";
const D = "Dental treatment is not covered.";

describe("B1/B2: no line hides an exception by looking like a heading", () => {
  it.each([
    ["EXCEPTION:", "EXCEPTION: Stable illness is paid in full."],
    ["EXCEPTIONS:", "EXCEPTIONS: This exclusion does not apply to stable illness."],
    ["EXCEPTIONS + list", "EXCEPTIONS\n• Emergency care within 24 hours"],
    ["Exceptions + list", "Exceptions\n• Emergency care within 24 hours"],
    ["NOTE:", "NOTE: This exclusion does not apply unless the illness was stable."],
    ["IMPORTANT:", "IMPORTANT: Except that an emergency is paid."],
    ["caps exception line", "EXCEPT FOR EMERGENCY CARE"],
    ["caps legal prose", "EXCEPT THAT AN EMERGENCY DURING THE\nFIRST DAY OF THE TRIP IS PAID."],
    ["watermark", "SAMPLE\nThis exclusion applies unless the illness was stable."],
    ["title-case label", "Home Country\nThis exclusion does not apply unless stable."],
    ["OR", "OR\nThis exclusion does not apply unless stable."],
    ["PLEASE NOTE", "PLEASE NOTE\nThis exclusion does not apply unless stable."],
    ["wrapped caps", "THE FOLLOWING EMERGENCY BENEFIT APPLIES\nUNLESS THE ILLNESS IS STABLE."],
    ["topic heading, then a back-reference", "DENTAL CARE\nThis exclusion does not apply unless stable."],
  ])("%s", (_n, text) => expect(omits(E, `${H}\n${E}\n${text}\n${T}`, E)).toBe(true));
  it.each(["TRAVEL CERTIFICATE", "Travel Medical Certificate", "Dental Plan Certificate", "Form 7 Page 2"])("running header '%s'", (head) => {
    expect(omits(E, [`${head}\n${H}\n${E}`, `${head}\nThis exclusion does not apply unless stable.\n${T}`], E)).toBe(true);
    expect(omits(E, [`${H}\n${E}\n${head}`, `This exclusion does not apply unless stable.\n${T}`], E)).toBe(true);
  });
  it.each([["GENERAL EXCLUSIONS", "ACUTE ONSET OF PRE-EXISTING CONDITIONS"], ["Exclusions", "Acute Onset"]])("generic heading %s / %s", (a, b) => {
    expect(omits(E, `${a}\n${E}\n${b}\nAcute onset of a Pre-existing Condition is paid up to the limit.\n${T}`, E)).toBe(true);
  });
});

describe("B3: labels, sub-items and trailing paragraphs", () => {
  it.each(["Note: Stable illness is paid unless treated abroad.", "Please note: emergencies within 24 hours are paid, other than follow-up.", "Emergency care: paid within the first 24 hours unless elective."])("%s", (text) =>
    expect(omits(E, `${H}\n${E}\n${text}\n${T}`, E)).toBe(true));
  it.each([
    ["(1) ", "(a) Injury to sound natural teeth is paid unless caused by eating.\n(2) Vision is not covered."],
    ["• ", "– Injury to sound natural teeth is paid unless caused by eating.\n• Vision is not covered."],
    ["(1) ", "(2) Vision is not covered.\nThe above are paid, however, unless elective."],
    ["• ", "• Vision is not covered.\nNone of these items is excluded for children unless elective."],
    ["(1) ", "(2) Vision is not covered.\nItems (1) and (2) apply unless caused by an accident."],
    ["(1) ", "(2) Vision is not covered.\nAll of the above exclusions apply unless caused by an accident."],
  ])("%s… %s", (m, rest) => expect(omits(D, `EXCLUSIONS\n${m}${D}\n${rest}\nMATERNITY CARE`, `${m}${D}`)).toBe(true));
});

describe("B4: the section crosses pages", () => {
  it("a lead-in on the page before governs its list", () => {
    const item = "(1) Dental treatment is not a covered charge.";
    expect(omits("Dental treatment is not a covered charge.", ["EXCLUSIONS\nThe following charges are excluded unless approved in advance by the Administrator:", `${item}\n(2) Vision.`], [item, 2])).toBe(true);
    expect(omits("Dental treatment is not a covered charge.", ["EXCLUSIONS\nThe charges listed here are excluded unless approved in advance:\n(1) Eye care.", "(2) Dental treatment is not a covered charge.\n(3) Vision."], ["(2) Dental treatment is not a covered charge.", 2])).toBe(true);
  });
  it.each([["More text about this rule follows here and it continues."], [""]])("two pages on (page between: '%s')", (p2) =>
    expect(omits(E, [`${H}\n${E}`, p2, `This exclusion does not apply unless stable.\n${T}`], E)).toBe(true));
});

describe("B5: the answer must state the exception itself", () => {
  it.each(["Dental treatment is excluded except for the following:", "Dental treatment is excluded except:"])("a lead-in without its list: %s", (line) => {
    const page = `DENTAL\n${line}\n(a) accidental injury\n(b) relief of pain\nVISION\nx`;
    expect(omits(line, page, line)).toBe(true);
    expect(omits(`${line}\n(a) accidental injury\n(b) relief of pain`, page, line)).toBe(false);
  });
  it("a marker at a line end before a capital", () => {
    const V = "Vision care is excluded unless listed.";
    expect(omits(`${E}\n${V}`, `${H}\n${E}\nThis exclusion applies unless\nInsured Person was stable for a year.\nVISION CARE\n${V}`, E, V)).toBe(true);
  });
  it("'The following exceptions apply.' without them", () =>
    expect(omits("Dental treatment is excluded.\nThe following exceptions apply.", "DENTAL\nDental treatment is excluded.\nThe following exceptions apply.\nAccidental injury is paid.\nVISION\nx", "Dental treatment is excluded.", "The following exceptions apply.")).toBe(true));
  it("the same tail in another sentence", () => {
    const v = "Vision care is paid unless elective.";
    expect(omits(`Dental treatment is excluded.\n${v}`, `DENTAL\nDental treatment is excluded.\nInjury to teeth is paid unless elective.\nVISION\n${v}`, "Dental treatment is excluded.", v)).toBe(true);
  });
  it("'acute onset' said about something else", () => {
    const b = "Acute onset of back pain is not covered.";
    expect(omits(`${E}\n${b}`, `${H}\n${E}\nAcute onset of a Pre-existing Condition is paid.\nBACK PAIN\n${b}`, E, b)).toBe(true);
  });
});

describe("the whole clause, stated, is enough", () => {
  const clause = "(4) PRE-EXISTING CONDITIONS: Charges for any Pre-existing Condition are excluded except and unless they result from an Acute Onset of Pre-\nexisting Condition, in which case they are paid.";
  const page = `(3) WAR: Charges from war are excluded.\n${clause}\n(5) MATERNITY CARE: Charges for delivery are excluded.`;
  const said = "Charges for any Pre-existing Condition are excluded except and unless they result from an Acute Onset of Pre-existing Condition, in which case they are paid.";
  it("without its run-in heading", () => expect(omits(said, page, clause)).toBe(false));
  it.each(["ACUTE ONSET OF PRE-EXISTING CONDITIONS", "ACUTE ONSET OF PRE- EXISTING CONDITIONS"])("with a capital hyphen wrap, answered as %s", (name) => {
    const c = "Charges for any illness are excluded unless covered by the ACUTE ONSET OF PRE-\nEXISTING CONDITIONS provision.";
    expect(omits(`Charges for any illness are excluded unless covered by the ${name} provision.`, `${H}\n${c}\n${T}`, c)).toBe(false);
  });
  it("but not cut before the exception, nor inside it", () => {
    expect(omits("Charges for any Pre-existing Condition are excluded", page, clause)).toBe(true);
    expect(omits("Charges for any Pre-existing Condition are excluded except and unless they result from an Acute Onset of Pre-existing Condition", page, clause)).toBe(true);
  });
  it("a contents line is navigation; the same words as text are an exception", () => {
    expect(omits(E, `CONTENTS\nAcute Onset of Pre-existing Conditions ........ 17\n${H}\n${E}\n${T}`, E)).toBe(false);
    expect(omits(E, `CONTENTS\nAcute Onset of Pre-existing Conditions is paid ... 17 days\n${H}\n${E}\n${T}`, E)).toBe(true);
  });
});

describe("B6: exclusion and limitation wording", () => {
  it.each([
    "No dental benefits are payable.", "No dental treatment is covered.", "No reimbursement is made for dental treatment.", "No cover is provided for dental treatment.",
    "Nothing is paid for dental treatment.", "Neither dental nor vision treatment is paid.", "Dental treatment is ineligible.", "Dental treatment is a non-covered charge.",
    "Dental treatment is non-payable.", "Coverage is void for dental treatment.", "Dental treatment: None", "Dental treatment: Nil", "Dental treatment: $0",
    "Dental treatment is paid solely for injury.", "Dental treatment is paid exclusively for injury.", "Dental treatment is declined.", "Dental treatment is capped at $500.",
    "Dental treatment requires a 12 month waiting period.", "Coverage for dental treatment terminates at age 70.", "Dental treatment is the responsibility of the traveller.",
  ])("$%s", (l) => expect(omits(l, `DENTAL\n${l}\nInjury to teeth is paid in full unless elective.\nVISION\nx`, l)).toBe(true));
  it("a cost-sharing value is not an exclusion", () =>
    expect(omits("Deductible: $0", "DEDUCTIBLE\nDeductible: $0\nUrgent care is $20 unless admitted.", "Deductible: $0")).toBe(false));
  it("S3: an item that is excluded only by its lead-in or heading", () => {
    expect(omits("Dental treatment", "EXCLUSIONS\nThe following are excluded:\n• Dental treatment\n• Eye care\nUnless required by an accident, these are the traveller's cost.", "• Dental treatment")).toBe(true);
    expect(omits("Dental treatment of natural teeth", "EXCLUSIONS\nDental treatment of natural teeth\nInjury is paid in full unless elective.", "Dental treatment of natural teeth")).toBe(true);
  });
});

describe("B7: boilerplate never hides a real exception", () => {
  it.each([
    "This exclusion applies except as specifically provided for stable illness.", "This applies unless otherwise provided to emergency patients within 24 hours.",
    "This exclusion applies unless expressly stated by the treating physician to be stable.", "This exclusion applies unless specifically indicated as Emergency Care in the Schedule.",
  ])("%s", (x) => expect(omits(E, `${H}\n${E}\n${x}\n${T}`, E)).toBe(true));
  it.each(["Limits are per visit unless otherwise noted.", "Unless otherwise stated, limits are per visit.", "Limits are per visit unless otherwise stated in the Schedule."])("control: %s", (x) =>
    expect(omits(E, `${H}\n${E}\n${x}\n${T}`, E)).toBe(false));
});

describe("B8: the same subject", () => {
  const list = (a: string, b: string) => `EXCLUSIONS\n• ${a}\n• Vision is not covered.\n• ${b}\nMATERNITY CARE`;
  it("an answer line break does not lose the subject", () =>
    expect(omits("Dental treatment of any kind\nis not covered.", list("Dental treatment of any kind\nis not covered.", "Dental injury is paid unless elective."), "• Dental treatment of any kind\nis not covered.")).toBe(true));
  it.each([
    ["Medical services are not covered.", "Medical services are paid unless elective."], ["Treatment is not covered.", "Treatment is payable unless elective."],
    ["Pregnancy is not covered.", "Pregnancies are paid unless begun before enrolment."], ["Pregnancy is not covered.", "Maternity care is paid unless begun before enrolment."],
    ["Pre-existing Conditions are not covered.", "A Preexisting Condition is paid unless the traveller is over 70."],
  ])("%s / %s", (a, b) => expect(omits(a, list(a, b), `• ${a}`)).toBe(true));
});

describe("S1: spelling of the marker", () => {
  it.each(["This exclusion applies un-\nless the illness was stable.", "This exclusion applies un­less the illness was stable.", "Acute-onset illness is paid in full.", "Benefits are paid for acute on-\nset of illness.", "Benefits are paid for the Acute\nOnset of illness."])("%j", (x) =>
    expect(omits(E, `${H}\n${E}\n${x}\n${T}`, E)).toBe(true));
});

describe("S2: ordinary schedules stay answerable", () => {
  const rows: [string, ...string[]][] = [
    ["Deductible", "$0", "$250"], ["Emergency Room", "$100 unless admitted", "$350 unless admitted"], ["Maternity Care", "Up to $5,000", "No coverage"],
    ["Dental Injury", "$500", "Not covered"], ["Vision Care", "Not covered", "Not covered"], ["Acupuncture", "Limited to $25 per visit", "No coverage"],
    ["Pre-existing Conditions", "Not covered", "Not covered"], ["Home Country", "14 days only", "No coverage"],
  ];
  const doc = tableDocument("d", [{ caption: "BENEFIT", headings: ["ELITE", "BASIC"], rows, trailer: ["Vision Care is paid for students unless elective."] }]);
  const rejected = (label: string) => {
    const r = renderTableAnswer([doc], [{ documentId: "d", page: 1, quote: doc.pages[0].split("\n").find((l) => l.startsWith(`${label} `))!.trim() }]);
    if (!r || typeof r === "string") throw new Error(String(r));
    return omitsException(r.answerText, r.citations, [doc]);
  };
  it.each(["Emergency Room", "Deductible"])("%s", (l) => expect(rejected(l)).toBe(false));
  it("another row's own exception is about that row", () => {
    const plain = tableDocument("d", [{ caption: "BENEFIT", headings: ["ELITE", "BASIC"], rows }]);
    for (const l of ["Maternity Care", "Dental Injury", "Pre-existing Conditions", "Home Country", "Acupuncture"]) {
      const r = renderTableAnswer([plain], [{ documentId: "d", page: 1, quote: plain.pages[0].split("\n").find((x) => x.startsWith(`${l} `))!.trim() }]);
      expect(typeof r === "object" && omitsException(r.answerText, r.citations, [plain])).toBe(false);
    }
  });
  it("text below the table is not a row: its exception counts", () => expect(rejected("Vision Care")).toBe(true));
});

describe("end to end", () => {
  it.each([
    ["EXCEPTION:", [`${H}\n${E}\nEXCEPTION: This exclusion does not apply unless the illness was unstable.`], E, "Are pre-existing conditions covered?"],
    ["running header", [`${H}\n${E}`, "TRAVEL CERTIFICATE\nThis exclusion does not apply to acute onset."], E, "Are pre-existing conditions covered?"],
    ["lead-in without list", ["DENTAL\nDental treatment is excluded except for the following:\n(a) accidental injury\n(b) relief of pain"], "Dental treatment is excluded except for the following:", "Is dental covered?"],
    ["no dental benefits", ["DENTAL\nNo dental benefits are payable.\nThis does not apply unless elective."], "No dental benefits are payable.", "Is dental covered?"],
  ])("%s → refused", async (_n, pages, q, question) => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting(q, q) as never);
    expect((await answerViaLlm([{ documentId: "d", filename: "d.pdf", pageCount: pages.length, pages }], question)).kind).toBe("refusal");
  });
});
