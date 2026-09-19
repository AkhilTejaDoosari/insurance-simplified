import { describe, expect, it, beforeEach } from "vitest";
import {
  buildTraceEvent,
  emitTrace,
  getAdminSummary,
  getTraceSink,
  LangfuseAdapter,
  LocalTraceSink,
  type TraceEvent,
} from "@/app/lib/observability/trace";

function sample(over: Partial<TraceEvent> = {}): TraceEvent {
  return buildTraceEvent({
    scopeId: "session-1",
    strategy: "semantic",
    candidateCount: 2,
    topK: [
      { documentId: "doc-a", page: 1, score: 0.9, rank: 1 },
      { documentId: "doc-b", page: 3, score: 0.7, rank: 2 },
    ],
    citationCount: 2,
    totalLatencyMs: 120,
    ...over,
  });
}

describe("trace observability", () => {
  beforeEach(() => {
    getTraceSink().clear();
  });

  it("PII-absence: event has no text/prompt/key fields", () => {
    const e = sample();
    const keys = Object.keys(e);
    for (const banned of [
      "userText",
      "question",
      "prompt",
      "documentText",
      "quote",
      "answerText",
      "apiKey",
      "key",
      "authorization",
    ]) {
      expect(keys).not.toContain(banned);
    }
    // Type-level: only sanitized metadata present
    expect(e.topK[0]).toEqual({ documentId: "doc-a", page: 1, score: 0.9, rank: 2 - 1 });
  });

  it("sink round-trip: emit then list", () => {
    const sink = new LocalTraceSink();
    const e = sample({ scopeId: "s-9" });
    sink.emit(e);
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].scopeId).toBe("s-9");
  });

  it("langfuse adapter is no-op without creds and never throws", () => {
    const inner = new LocalTraceSink();
    const adapter = new LangfuseAdapter(inner, {} as NodeJS.ProcessEnv);
    expect(adapter.isEnabled).toBe(false);
    expect(() => adapter.emit(sample())).not.toThrow();
    expect(inner.list()).toHaveLength(0);
  });

  it("admin summary counts failures/refusals/verification/degradations", () => {
    emitTrace(sample({ errorCategory: "retrieval-empty", totalLatencyMs: 100 }));
    emitTrace(sample({ refusalReason: "no-evidence", verification: "fail", totalLatencyMs: 200 }));
    emitTrace(sample({ fallbackReason: "semantic-down", totalLatencyMs: 300, inputTokens: 10, outputTokens: 20 }));
    const s = getAdminSummary();
    expect(s.totalTraces).toBe(3);
    expect(s.retrievalFailures).toBe(1);
    expect(s.refusals).toBe(1);
    expect(s.verificationFailures).toBe(1);
    expect(s.degradations).toBe(1);
    expect(s.avgTotalLatencyMs).toBe(200);
    expect(s.totalInputTokens).toBe(10);
    expect(s.totalOutputTokens).toBe(20);
  });

  it("cost defaults to NOT MEASURED unless provider reports", () => {
    expect(sample().costEstimate).toBe("NOT MEASURED");
  });
});
