// M7 integration: the surfaces consumer must call the producer's
// `rederiveSurfaces` — the one merge point left open on m7/surfaces was a
// stub returning null, which silently turned every stored surface into
// "cannot be confirmed". These tests fail if that stub returns.
//
// Synthetic payloads only; no real document text.
import { describe, expect, it, vi } from "vitest";
import { SURFACES_SCHEMA, type EvidenceSurfaces } from "@/app/lib/evidence/surface-types";

const calls = vi.hoisted(() => ({ rederive: 0, returned: null as EvidenceSurfaces | null }));

vi.mock("@/app/lib/evidence/surfaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/evidence/surfaces")>();
  return {
    ...actual,
    rederiveSurfaces: (input: Parameters<typeof actual.rederiveSurfaces>[0]) => {
      calls.rederive += 1;
      return calls.returned ?? actual.rederiveSurfaces(input);
    },
  };
});

import { surfacesForReadBack } from "@/app/lib/evidence/surfaces-consumer/read-back";
import type { ConfirmedResult } from "@/app/lib/evidence/read-back";
import type { ComparisonResultRecord } from "@/app/lib/comparison-result-db";

const record = {
  sessionId: "sess-wiring",
  status: "ready",
  documentFingerprint: "fp",
  payload: {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "d1", filename: "synthetic.pdf", pageCount: 1 }],
    rows: [],
    userContext: {},
  },
  createdAt: "",
  updatedAt: "",
  expiresAt: "",
} as unknown as ComparisonResultRecord;

const confirmedWithEvidence = { evidence: {} } as unknown as ConfirmedResult;

describe("m7i surfaces read-back wiring", () => {
  it("calls the producer's rederiveSurfaces when evidence was re-derived", () => {
    calls.rederive = 0;
    calls.returned = null;
    expect(
      surfacesForReadBack({ sessionId: "sess-wiring", documents: [], record, confirmed: confirmedWithEvidence }),
    ).toBeNull();
    expect(calls.rederive).toBe(1);
  });

  it("returns the producer's re-derived surfaces unchanged", () => {
    calls.rederive = 0;
    const produced: EvidenceSurfaces = {
      schema: SURFACES_SCHEMA,
      exclusions: [],
      authority: [],
    };
    calls.returned = produced;
    expect(
      surfacesForReadBack({ sessionId: "sess-wiring", documents: [], record, confirmed: confirmedWithEvidence }),
    ).toBe(produced);
    expect(calls.rederive).toBe(1);
    calls.returned = null;
  });

  it("does not call the producer when no evidence was re-derived, and shows no stored value", () => {
    calls.rederive = 0;
    const stored = {
      ...record,
      payload: {
        ...record.payload,
        surfaces: {
          schema: SURFACES_SCHEMA,
          exclusions: [{ kind: "exclusion-inventory", documentId: "d1", planName: "Stored", exclusions: [] }],
          authority: [],
        },
      },
    } as unknown as ComparisonResultRecord;
    const surfaces = surfacesForReadBack({
      sessionId: "sess-wiring",
      documents: [],
      record: stored,
      confirmed: { evidence: null } as unknown as ConfirmedResult,
    });
    expect(calls.rederive).toBe(0);
    expect(surfaces?.exclusions[0]).toMatchObject({ kind: "cannot-be-confirmed", of: "exclusion-inventory" });
  });
});
