import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSession, deleteSession, getEvidenceRecord } from "@/app/lib/session";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

const created: string[] = [];
afterEach(() => {
  for (const id of created.splice(0)) deleteSession(id);
  vi.resetAllMocks();
});

const SESSION_DOCS = [
  {
    documentId: "doc-1",
    filename: "a.pdf",
    pageCount: 1,
    pages: ["Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000."],
  },
];

function seedSession() {
  const session = createSession(SESSION_DOCS, {});
  created.push(session.sessionId);
  return session;
}

vi.mock("@/app/lib/extraction/extract", () => ({
  extractFallback: vi.fn(),
  extractViaLlm: vi.fn(),
}));

import { POST } from "@/app/api/extract/route";
import { extractFallback } from "@/app/lib/extraction/extract";

const mockedFallback = vi.mocked(extractFallback);

function tableWith(rows: unknown[]) {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
    rows,
  };
}

function post(sessionId: string) {
  return POST(
    new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, engine: "fallback" }),
    })
  );
}

describe("POST /api/extract evidence verification boundary", () => {
  it("12. retains a value with only its canonical valid evidence", async () => {
    const session = seedSession();
    mockedFallback.mockReturnValue(
      tableWith([
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250 / $3,000",
              qualifiers: {},
              evidence: [
                { documentId: "doc-1", page: 1, quote: "Annual deductible ... out-of-pocket maximum: $3,000." },
                { documentId: "doc-1", page: 1, quote: "No such passage anywhere." },
              ],
            },
          ],
        },
      ]) as never
    );
    const res = await post(session.sessionId);
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.rows[0];
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values).toHaveLength(1);
    expect(row.values[0].evidence).toHaveLength(1);
    expect(row.values[0].evidence[0].quote).toBe(
      "Annual deductible: $250 in-network. Annual out-of-pocket maximum: $3,000."
    );
  });

  it("13+14. removes values with zero valid citations and flips emptied rows to NOT STATED", async () => {
    const session = seedSession();
    mockedFallback.mockReturnValue(
      tableWith([
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250 in-network." }],
            },
            {
              documentId: "doc-1",
              display: "$999",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Fabricated passage here." }],
            },
          ],
        },
        {
          factName: "urgent-care",
          verdict: "SUPPORTED",
          rationale: "should be dropped on flip",
          values: [
            {
              documentId: "doc-1",
              display: "$25",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Fabricated passage here." }],
            },
          ],
        },
      ]) as never
    );
    const res = await post(session.sessionId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows[0].values).toHaveLength(1);
    expect(body.rows[0].values[0].display).toBe("$250");
    expect(body.rows[1]).toEqual({ factName: "urgent-care", verdict: "NOT STATED", values: [] });
  });

  it("17+18. registry and evidenceIds use the canonical source quote, never the model text", async () => {
    const session = seedSession();
    mockedFallback.mockReturnValue(
      tableWith([
        {
          factName: "annual-deductible",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "$250",
              qualifiers: {},
              evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible ... $250 in-network." }],
            },
          ],
        },
      ]) as never
    );
    const res = await post(session.sessionId);
    expect(res.status).toBe(200);
    const body = await res.json();
    const evidence = body.rows[0].values[0].evidence[0];
    const canonical = "Annual deductible: $250 in-network.";
    expect(evidence.quote).toBe(canonical);
    expect(evidence.evidenceId).toBe(evidenceIdFor("doc-1", 1, canonical));
    expect(getEvidenceRecord(session.sessionId, evidence.evidenceId)).toEqual({
      documentId: "doc-1",
      page: 1,
      quote: canonical,
    });
  });
});
