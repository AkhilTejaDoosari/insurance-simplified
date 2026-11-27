// Provider-neutral observability traces (P2 Todo 63).
//
// Sanitized metadata ONLY. By construction this module has NO fields for
// raw user text, prompts, document text, or API keys — such fields do not
// exist on the TraceEvent type, so they cannot be emitted.
//
// Cost fields are UNKNOWN / NOT MEASURED unless the provider reports
// usage + pricing.

export interface TopKEntry {
  documentId: string;
  page: number;
  score?: number;
  rank?: number;
}

/** Sanitized trace event. No user text, prompt, document, or key fields. */
export interface TraceEvent {
  traceId: string;
  timestamp: string;
  /** Session / request scope (opaque id only). */
  scopeId: string;
  strategy: string;
  candidateCount: number;
  topK: TopKEntry[];
  semanticLatencyMs?: number;
  ftsLatencyMs?: number;
  fallbackReason?: string;
  llmModel?: string;
  llmLatencyMs?: number;
  /** Token counts ONLY when the provider reports them. */
  inputTokens?: number;
  outputTokens?: number;
  /** Cost: UNKNOWN / NOT MEASURED unless provider reports usage + pricing. */
  costEstimate?: "UNKNOWN" | "NOT MEASURED" | number;
  verification?: "pass" | "fail";
  refusalReason?: string;
  citationCount: number;
  totalLatencyMs: number;
  errorCategory?: string;
}

export interface TraceSink {
  emit(event: TraceEvent): void;
}

/** In-memory sink. Always available. */
export class LocalTraceSink implements TraceSink {
  private events: TraceEvent[] = [];

  emit(event: TraceEvent): void {
    this.events.push(event);
  }

  list(): TraceEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

/** Langfuse-compatible adapter. Activated ONLY when LANGFUSE_* credentials
 *  are present (LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY); otherwise every
 *  method is a no-op and NEVER throws. Adapter-present does NOT mean
 *  Langfuse is active — see isEnabled. */
export class LangfuseAdapter implements TraceSink {
  readonly isEnabled: boolean;

  constructor(
    private readonly inner: TraceSink,
    env: NodeJS.ProcessEnv = process.env
  ) {
    this.isEnabled =
      Boolean(env.LANGFUSE_PUBLIC_KEY) && Boolean(env.LANGFUSE_SECRET_KEY);
  }

  emit(event: TraceEvent): void {
    try {
      if (!this.isEnabled) return; // no-op, never throws
      // Forward to the inner sink only when credentials exist. A real
      // Langfuse HTTP export would live here; local aggregation stays
      // provider-neutral via `inner`.
      this.inner.emit(event);
    } catch {
      // never throws
    }
  }
}

const globalSink = new LocalTraceSink();

export function getTraceSink(): LocalTraceSink {
  return globalSink;
}

/** Emit a trace event to the global in-memory sink. Never throws. */
export function emitTrace(event: TraceEvent): void {
  try {
    globalSink.emit(event);
  } catch {
    // never throws
  }
}

export interface AdminSummary {
  totalTraces: number;
  retrievalFailures: number;
  refusals: number;
  verificationFailures: number;
  degradations: number;
  avgTotalLatencyMs: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** Aggregate retrieval failures / refusals / verification failures /
 *  degradations / latency / tokens over the global sink. */
export function getAdminSummary(): AdminSummary {
  const events = globalSink.list();
  let retrievalFailures = 0;
  let refusals = 0;
  let verificationFailures = 0;
  let degradations = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const e of events) {
    if (e.errorCategory) retrievalFailures++;
    if (e.refusalReason) refusals++;
    if (e.verification === "fail") verificationFailures++;
    if (e.fallbackReason) degradations++;
    if (typeof e.totalLatencyMs === "number" && Number.isFinite(e.totalLatencyMs)) {
      latencySum += e.totalLatencyMs;
      latencyCount++;
    }
    if (typeof e.inputTokens === "number") totalInputTokens += e.inputTokens;
    if (typeof e.outputTokens === "number") totalOutputTokens += e.outputTokens;
  }
  return {
    totalTraces: events.length,
    retrievalFailures,
    refusals,
    verificationFailures,
    degradations,
    avgTotalLatencyMs: latencyCount > 0 ? latencySum / latencyCount : null,
    totalInputTokens,
    totalOutputTokens,
  };
}

/** Build a sanitized event with defaults. No text fields accepted. */
export function buildTraceEvent(
  init: Omit<TraceEvent, "traceId" | "timestamp" | "costEstimate"> & {
    traceId?: string;
    timestamp?: string;
    costEstimate?: TraceEvent["costEstimate"];
  }
): TraceEvent {
  return {
    costEstimate: "NOT MEASURED",
    ...init,
    traceId:
      init.traceId ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `trace-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
    timestamp: init.timestamp ?? new Date().toISOString(),
  };
}
