// P3-C lifecycle tests: centralized transitions, every pair covered.
import { describe, expect, it } from "vitest";
import {
  IllegalIngestionTransitionError,
  documentStatusFor,
  isTerminalState,
  stateForDocumentStatus,
  transition,
  type IngestionState,
} from "@/app/lib/ingestion/lifecycle";

const STATES: IngestionState[] = ["UPLOADING", "PROCESSING", "READY", "FAILED"];

const LEGAL: Array<[IngestionState, IngestionState]> = [
  ["UPLOADING", "PROCESSING"],
  ["UPLOADING", "FAILED"],
  ["PROCESSING", "READY"],
  ["PROCESSING", "FAILED"],
];

describe("transition legal paths", () => {
  for (const [from, to] of LEGAL) {
    it(`${from} → ${to} succeeds`, () => {
      expect(transition(from, to)).toBe(to);
    });
  }
});

describe("transition illegal pairs", () => {
  const legalKeys = new Set(LEGAL.map(([f, t]) => `${f}→${t}`));
  const illegal: Array<[IngestionState, IngestionState]> = [];
  for (const from of STATES) {
    for (const to of STATES) {
      if (!legalKeys.has(`${from}→${to}`)) illegal.push([from, to]);
    }
  }

  it("covers every illegal pair (12 of 16)", () => {
    expect(illegal).toHaveLength(12);
  });

  for (const [from, to] of illegal) {
    it(`${from} → ${to} throws`, () => {
      try {
        transition(from, to);
        expect.unreachable(`${from} → ${to} should have thrown`);
      } catch (err) {
        expect(err).toBeInstanceOf(IllegalIngestionTransitionError);
        expect((err as IllegalIngestionTransitionError).from).toBe(from);
        expect((err as IllegalIngestionTransitionError).to).toBe(to);
      }
    });
  }

  it("spot-checks the spec examples", () => {
    expect(() => transition("READY", "UPLOADING")).toThrow(IllegalIngestionTransitionError);
    // FAILED→READY without re-upload is illegal: re-upload starts a NEW lifecycle.
    expect(() => transition("FAILED", "READY")).toThrow(IllegalIngestionTransitionError);
    // No return to UPLOADING once PROCESSING has begun.
    expect(() => transition("PROCESSING", "UPLOADING")).toThrow(IllegalIngestionTransitionError);
    expect(() => transition("FAILED", "UPLOADING")).toThrow(IllegalIngestionTransitionError);
  });
});

describe("status mirror + terminal states", () => {
  it("marks READY/FAILED terminal only", () => {
    expect(isTerminalState("READY")).toBe(true);
    expect(isTerminalState("FAILED")).toBe(true);
    expect(isTerminalState("UPLOADING")).toBe(false);
    expect(isTerminalState("PROCESSING")).toBe(false);
  });

  it("mirrors the documents.status column and round-trips", () => {
    expect(documentStatusFor("UPLOADING")).toBe("uploading");
    expect(documentStatusFor("PROCESSING")).toBe("processing");
    expect(documentStatusFor("READY")).toBe("ready");
    expect(documentStatusFor("FAILED")).toBe("failed");
    for (const s of STATES) {
      expect(stateForDocumentStatus(documentStatusFor(s))).toBe(s);
    }
  });

  it("returns undefined for legacy status values instead of coercing", () => {
    expect(stateForDocumentStatus("active")).toBeUndefined();
    expect(stateForDocumentStatus("current")).toBeUndefined();
    expect(stateForDocumentStatus("")).toBeUndefined();
  });
});
