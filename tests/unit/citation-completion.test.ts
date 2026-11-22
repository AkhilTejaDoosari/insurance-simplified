// Owner decision 2026-11-22 (4): server-side citation completion. When the
// model references lines, the server expands each citation to its complete
// unit — the whole sentence, including wrapped continuation lines and a
// same-line "LABEL:" prefix; for a table row, the row's cells and their
// column headings — and the answer is verified against the completed unit,
// which is what the user sees. Strictness is unchanged; text from different
// rows or sentences is never spliced. Shapes are the logged "cannot be
// confirmed" cases of the 40-question benchmark. Synthetic text only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => true),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));

import { answerViaLlm } from "@/app/lib/rag/answer";
import { completeProseQuote, completeCitations } from "@/app/lib/evidence/citation-unit";
import { completeJson } from "@/app/lib/llm/client";
import { answerCiting } from "../helpers/chat-refs";
import { tableDocument } from "./helpers/table-doc";

beforeEach(() => vi.clearAllMocks());

async function ask(pageLines: string[], question: string, answer: string, cited: string) {
  const docs = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [pageLines.join("\n")] }];
  vi.mocked(completeJson).mockImplementationOnce(answerCiting(answer, cited) as never);
  return answerViaLlm(docs, question);
}

describe("completeProseQuote: the whole sentence, never a neighbouring row or sentence", () => {
  const PAGE = ["BENEFITS", "(5) MATERNITY AND NEWBORN CARE: All charges for prenatal care and delivery,", "including complications of pregnancy, are excluded from this", "insurance.", "(6) DENTAL: Dental care is excluded."].join("\n");
  it("expands a cited middle line to the sentence's lines", () => {
    expect(completeProseQuote(PAGE, "including complications of pregnancy, are excluded from this")).toBe(
      "(5) MATERNITY AND NEWBORN CARE: All charges for prenatal care and delivery,\nincluding complications of pregnancy, are excluded from this\ninsurance.",
    );
  });
  it("a complete row stays as it is", () => {
    expect(completeProseQuote("Primary care $30\nSpecialist $60\nUrgent care $75", "Specialist $60")).toBe("Specialist $60");
  });
  it("a figure line that belongs to the row is included", () => {
    expect(completeProseQuote("Maternity: covered expenses include delivery and postnatal visits\n80% in-network, 70% out-of-network\nOther", "Maternity: covered expenses include delivery and postnatal visits")).toBe(
      "Maternity: covered expenses include delivery and postnatal visits\n80% in-network, 70% out-of-network",
    );
  });
});

describe("logged shapes now verify against the completed unit", () => {
  it("a sentence after a same-line 'LABEL:' prefix, with only part of it cited", async () => {
    // Follow-up review (A): the sentence repeats a word of its heading.
    const page = ["BENEFITS", "(5) MATERNITY AND NEWBORN CARE: All charges for prenatal care and care of newborns,", "including complications of pregnancy, are excluded from this", "insurance.", "(6) DENTAL: Dental care is excluded."];
    const r = await ask(page, "Is maternity covered?", "All charges for prenatal care and care of newborns, including complications of pregnancy, are excluded from this insurance.", "including complications of pregnancy, are excluded from this");
    expect(r.kind).toBe("answer");
    expect(r.kind === "answer" && r.citations[0].quote).toContain("(5) MATERNITY AND NEWBORN CARE:");
  });
  it("a sentence that ends mid-line, with a time figure", async () => {
    const page = ["TERMINATION", "Coverage will terminate at 11:59 pm on the earliest of the last date paid, or on the", "date you return to your home country. Coverage for your", "dependents ends at the same time."];
    const r = await ask(page, "Are there any geographic restrictions on coverage?", "Coverage will terminate at 11:59 pm on the earliest of the last date paid, or on the date you return to your home country.", "Coverage will terminate at 11:59 pm on the earliest of the last date paid, or on the");
    expect(r.kind).toBe("answer");
  });
  it("an abbreviation ('U.S. Department') does not split the answer's sentence", async () => {
    const page = ["EXCLUSIONS", "acts. Coverage excludes regions for which the U.S. Department", "of State has issued a level 3 advisory in the", "60 days prior to your arrival date.", "SPORTS"];
    const r = await ask(page, "Are there any geographic restrictions on coverage?", "Coverage excludes regions for which the U.S. Department of State has issued a level 3 advisory in the 60 days prior to your arrival date.", "of State has issued a level 3 advisory in the");
    expect(r.kind).toBe("answer");
  });
  it("another sentence on the same line carries a negation", async () => {
    const page = ["ELIGIBILITY", "You cannot buy this plan for travel to the United States. You are covered for trips that include the U.S. if you are", "traveling outside the country of your residence.", "Other terms."];
    const r = await ask(page, "Are there any geographic restrictions on coverage?", "You are covered for trips that include the U.S. if you are traveling outside the country of your residence.", "traveling outside the country of your residence.");
    expect(r.kind).toBe("answer");
  });
});

describe("strictness unchanged: these stay 'cannot be confirmed'", () => {
  it("the answer leaves out the row's figures (the completed unit shows them)", async () => {
    const page = ["SCHEDULE", "Maternity: covered expenses include delivery and postnatal visits", "80% in-network, 70% out-of-network", "Other"];
    const r = await ask(page, "Is maternity covered?", "Maternity: covered expenses include delivery and postnatal visits", "Maternity: covered expenses include delivery and postnatal visits");
    expect(r.kind).toBe("refusal");
    expect(r.kind === "refusal" && r.citations?.[0].quote).toContain("80% in-network");
  });
  it("a label prefix that negates is part of the meaning", async () => {
    const page = ["SCHEDULE", "NOT COVERED: Dental care for adults,", "including implants and crowns.", "Other"];
    const r = await ask(page, "Is dental covered?", "Dental care for adults, including implants and crowns.", "including implants and crowns.");
    expect(r.kind).toBe("refusal");
  });
  it("a paraphrase is not the document's wording", async () => {
    const page = ["SCHEDULE", "After 6 months of continuous coverage, Elite and Select will provide", "benefits for pre-existing conditions.", "Other"];
    const r = await ask(page, "Are pre-existing conditions covered?", "Elite and Select will provide benefits for pre-existing conditions after 6 months of continuous coverage.", "benefits for pre-existing conditions.");
    expect(r.kind).toBe("refusal");
  });
});

describe("table rows: the row's cells and their column headings are added", () => {
  const DOC = tableDocument("doc-1", [{ caption: "BENEFIT", headings: ["ELITE", "BASIC"], rows: [["Deductible", "$0", "$250"], ["Ambulance", "Up to $750", "Up to $500"], ["Maternity Care", "Up to $5,000", "No coverage"]] }]);
  it("a cited cell gains its row label and heading citations, from the same table only", () => {
    const page = DOC.pages[0];
    const start = page.indexOf("$250");
    const out = completeCitations([DOC], [{ documentId: "doc-1", page: 1, quote: page.slice(start, start + 4) }]);
    const quotes = out.map((c) => c.quote);
    expect(quotes).toEqual(expect.arrayContaining(["Deductible", "$0", "$250"]));
    expect(quotes.some((q) => q.includes("ELITE") && q.includes("BASIC"))).toBe(true);
    expect(quotes.join(" ")).not.toContain("Ambulance");
    for (const q of quotes) expect(page.includes(q)).toBe(true);
  });
});

// Review of 4ccd625.
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";
function verifyCompleted(pageLines: string[], cited: string, answer: string) {
  const page = pageLines.join("\n");
  const docs = [{ documentId: "doc-1", pages: [page] }];
  const c = completeCitations(docs, [{ documentId: "doc-1", page: 1, quote: cited }]);
  return verifyAnswerClaims(answer, c, c, docs).ok;
}

describe("review B1: a plan, rider, tier, group or limitation label is never dropped", () => {
  it.each([
    [["Plan A: Maternity is not covered.", "Plan B: Maternity is covered after a", "12 month waiting period."], "12 month waiting period.", "Maternity is covered after a 12 month waiting period."],
    [["Optional Rider: Dental care is covered for", "accidental injury.", "Other"], "accidental injury.", "Dental care is covered for accidental injury."],
    [["Tier 2: Specialist visits are payable at 50% after the", "deductible.", "Other"], "deductible.", "Specialist visits are payable at 50% after the deductible."],
    [["Members age 65 and over: Wellness exams are covered once per", "calendar year.", "Other"], "calendar year.", "Wellness exams are covered once per calendar year."],
    [["Limitations: Dental care for adults,", "including implants and crowns.", "Other"], "including implants and crowns.", "Dental care for adults, including implants and crowns."],
    [["Plan B: Maternity is covered.", "Other"], "Plan B: Maternity is covered.", "Maternity is covered."],
  ])("%#", (page, cited, answer) => expect(verifyCompleted(page, cited, answer)).toBe(false));
  it("control: a topic heading label is still a heading", () => {
    // Follow-up review (A): the sentence repeats the heading's topic word.
    expect(verifyCompleted(["(5) MATERNITY AND NEWBORN CARE: All charges for maternity care are", "excluded from this insurance.", "Other"], "excluded from this insurance.", "All charges for maternity care are excluded from this insurance.")).toBe(true);
  });
});

describe("review S1: a row citation that repeats on the page is not added alone", () => {
  const DOC = tableDocument("doc-1", [{ caption: "BENEFIT", headings: ["ELITE", "BASIC"], rows: [["Deductible", "$0", "$250"], ["Ambulance", "$0", "Up to $500"], ["Maternity Care", "Up to $5,000", "No coverage"]] }]);
  it("every added citation is unique on its page, and the answer still verifies", () => {
    const page = DOC.pages[0];
    const out = completeCitations([DOC], [{ documentId: "doc-1", page: 1, quote: "Up to $500" }]);
    for (const c of out) expect(page.indexOf(c.quote)).toBe(page.lastIndexOf(c.quote));
    expect(verifyAnswerClaims("Up to $500", out, out, [{ documentId: "doc-1", pages: DOC.pages }]).ok).toBe(true);
  });
});

describe("review nit: completion never joins two rows", () => {
  it("a row ending in a figure is not continued by a lower-case row with a figure", () => {
    expect(completeProseQuote("Primary care $30\ntelehealth $10\nOther", "Primary care $30")).toBe("Primary care $30");
  });
});
