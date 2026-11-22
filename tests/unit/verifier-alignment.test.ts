// Owner decision 2026-11-21 (6): verifyAnswerClaims and the route's
// citation check apply the SAME strict verbatim rule (verifyEvidenceCitation),
// and a refusal after a rejected answer carries the cited passages.
// Reproduced on the local benchmark: a model cited an exclusion item ending
// in "." where the page has ";"; verifyAnswerClaims accepted it and the route
// then refused without passages. Synthetic text only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifyAnswerClaims } from "@/app/lib/evidence-verification";

const PAGE = ["EXCLUSIONS", "12. Expenses incurred for treatment while in your home country;", "13. Routine eye examinations;"].join("\n");
const DOCS = [{ documentId: "doc-1", pages: [PAGE] }];
const CHUNK = [{ documentId: "doc-1", page: 1, quote: PAGE }];

describe("verifyAnswerClaims uses the strict verbatim citation rule", () => {
  it("a citation whose punctuation differs from the page is rejected", () => {
    const quote = "Expenses incurred for treatment while in your home country.";
    const r = verifyAnswerClaims(quote, [{ documentId: "doc-1", page: 1, quote }], CHUNK, DOCS);
    expect(r.ok).toBe(false);
    expect(r.rationale).toMatch(/not found in source page/);
  });

  it("the verbatim citation passes (line breaks and spacing may be reflowed)", () => {
    const quote = "Expenses incurred for treatment while in   your home country;";
    const r = verifyAnswerClaims("Expenses incurred for treatment while in your home country;", [{ documentId: "doc-1", page: 1, quote }], CHUNK, DOCS);
    expect(r.ok).toBe(true);
  });
});

vi.mock("@/app/lib/rag/answer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/answer")>()),
  answerViaLlm: vi.fn(),
}));
vi.mock("@/app/lib/llm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/llm/client")>()),
  isLlmConfigured: vi.fn(() => true),
}));

import { POST } from "@/app/api/chat/route";
import { answerViaLlm, UNCERTAIN_TEXT } from "@/app/lib/rag/answer";
import { createSession, deleteSession, SESSION_CAPABILITY_COOKIE } from "@/app/lib/session";

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
});

describe("a route-level citation rejection is 'cannot be confirmed' with the passages that verify", () => {
  it("one misquoted citation → refusal with the verifying passage, never the answer text", async () => {
    const { session, capability } = createSession([{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [PAGE] }], {});
    created.push(session.sessionId);
    vi.mocked(answerViaLlm).mockResolvedValueOnce({
      schemaVersion: "v1",
      kind: "answer",
      answerText: "Home-country treatment and routine eye examinations are excluded.",
      citations: [
        { documentId: "doc-1", page: 1, quote: "Expenses incurred for treatment while in your home country." },
        { documentId: "doc-1", page: 1, quote: "13. Routine eye examinations;" },
      ],
    });
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_CAPABILITY_COOKIE}=${capability}` },
        body: JSON.stringify({ sessionId: session.sessionId, question: "What is excluded abroad?" }),
      }),
    );
    const body = await res.json();
    expect(body.kind).toBe("refusal");
    expect(body.refusalText).toBe(UNCERTAIN_TEXT);
    expect(body.citations.map((c: { quote: string }) => c.quote)).toEqual(["13. Routine eye examinations;"]);
    expect(JSON.stringify(body)).not.toContain("Home-country treatment");
  });
});

describe("a short sentence that states a figure is always checked", () => {
  const P = "SCHEDULE\nAnnual maximum $1,000,000\nDeductible elsewhere $100";
  const D = [{ documentId: "doc-1", pages: [P] }];
  const C = [{ documentId: "doc-1", page: 1, quote: P }];
  const cite = [{ documentId: "doc-1", page: 1, quote: "Annual maximum $1,000,000" }];

  it("a changed figure in a short sentence is rejected", () => {
    const r = verifyAnswerClaims("Annual maximum $2,000,000", cite, C, D);
    expect(r.ok).toBe(false);
    expect(r.rationale).toMatch(/Unsupported claim/);
  });

  it("a bare figure answer must be in a cited passage", () => {
    expect(verifyAnswerClaims("$2,000,000.", cite, C, D).ok).toBe(false);
    // Owner decision 2026-11-22 (5) rule 1: a bare figure omits its own
    // segment's label ("Annual maximum") — now rejected (was verified).
    expect(verifyAnswerClaims("$1,000,000.", cite, C, D).ok).toBe(false);
  });

  // Confirmation review reversed this session's earlier assertion that a
  // short sentence without figures is skipped: it must be covered too.
  it("the stated figure from the citation passes; an uncovered short sentence is rejected", () => {
    expect(verifyAnswerClaims("Annual maximum $1,000,000", cite, C, D).ok).toBe(true);
    expect(verifyAnswerClaims("Yes, it does.\nAnnual maximum $1,000,000", cite, C, D).ok).toBe(false);
  });
});

// Review (2026-11-21, grid-first range), B1 + S8: coverage keeps meaning.
describe("a covered sentence keeps its source line's negation/exception markers", () => {
  const P = ["BENEFITS", "Dental treatment is not covered.", "Annual maximum $1,000,000", "Newborn maximum $500"].join("\n");
  const D = [{ documentId: "doc-1", pages: [P] }];
  const C = [{ documentId: "doc-1", page: 1, quote: P }];
  const c = (quote: string) => [{ documentId: "doc-1", page: 1, quote }];

  it("a reversed coverage statement is rejected", () => {
    expect(verifyAnswerClaims("Dental is covered.", c("Dental treatment is not covered."), C, D).ok).toBe(false);
  });

  it("a short coverage statement is never skipped", () => {
    expect(verifyAnswerClaims("Dental covered.", c("Dental treatment is not covered."), C, D).ok).toBe(false);
  });

  it("the faithful statement passes", () => {
    expect(verifyAnswerClaims("Dental treatment is not covered.", c("Dental treatment is not covered."), C, D).ok).toBe(true);
  });

  it("a figure must come from the passage that covers the sentence (no borrowing a sub-limit)", () => {
    const cites = [...c("Annual maximum $1,000,000"), ...c("Newborn maximum $500")];
    expect(verifyAnswerClaims("Annual maximum $500", cites, C, D).ok).toBe(false);
    expect(verifyAnswerClaims("Annual maximum $1,000,000", cites, C, D).ok).toBe(true);
  });
});

// Follow-up review (2026-11-21): negation/qualifier parity for words the
// marker grammar does not know, and no figure borrowing inside one quote.
describe("coverage keeps every negation and qualifier word", () => {
  const check = (page: string, sentence: string) =>
    verifyAnswerClaims(sentence, [{ documentId: "doc-1", page: 1, quote: page }], [{ documentId: "doc-1", page: 1, quote: page }], [{ documentId: "doc-1", pages: [page] }]).ok;

  it.each([
    ["Annual maximum $1,000,000\nNewborn maximum $500", "Annual maximum $500"],
    ["Dental is not payable", "Dental is payable."],
    ["Dental cover\nNot provided", "Dental cover provided."],
    ["Physiotherapy: does not cover", "Physiotherapy: does cover."],
    ["Copay $300 waived if admitted", "Copay $300."],
    ["Copay $300 waived if admitted", "Copay $300 if admitted."],
    ["Maternity covered after 12 months", "Maternity covered."],
  ])("rejects unfaithful pair %#", (page, sentence) => expect(check(page, sentence)).toBe(false));

  it.each([
    ["Dental is not payable", "Dental is not payable."],
    ["Copay $300 waived if admitted", "Copay $300 waived if admitted."],
    ["Maternity covered after 12 months", "Maternity covered after 12 months."],
    ["Annual maximum $1,000,000\nNewborn maximum $500", "Annual maximum $1,000,000"],
  ])("accepts faithful pair %#", (page, sentence) => expect(check(page, sentence)).toBe(true));
});

// Confirmation review (2026-11-21): no short-sentence skip; whole-word
// coverage ("limited" is not covered by "unlimited").
describe("short affirmatives and substring words cannot reverse a fact", () => {
  const check = (page: string, sentence: string) =>
    verifyAnswerClaims(sentence, [{ documentId: "doc-1", page: 1, quote: page }], [{ documentId: "doc-1", page: 1, quote: page }], [{ documentId: "doc-1", pages: [page] }]).ok;
  it.each([
    ["Ambulance limited to $1,000", "Ambulance unlimited."],
    ["Dental is not covered", "Dental is free."],
    ["Dental is not covered", "Yes, dental."],
    ["Ambulance unlimited", "Ambulance limited."],
  ])("rejects pair %#", (page, sentence) => expect(check(page, sentence)).toBe(false));
  it.each([
    ["Ambulance limited to $1,000", "Ambulance limited to $1,000."],
    ["Two office visits per year", "Two office visit per year."],
  ])("accepts faithful pair %#", (page, sentence) => expect(check(page, sentence)).toBe(true));
});
