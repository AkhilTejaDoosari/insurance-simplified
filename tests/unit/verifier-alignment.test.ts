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
    expect(verifyAnswerClaims("$1,000,000.", cite, C, D).ok).toBe(true);
  });

  it("the stated figure from the citation passes; a short sentence without figures is still skipped", () => {
    expect(verifyAnswerClaims("Annual maximum $1,000,000", cite, C, D).ok).toBe(true);
    expect(verifyAnswerClaims("Yes, it does.\nAnnual maximum $1,000,000", cite, C, D).ok).toBe(true);
  });
});
