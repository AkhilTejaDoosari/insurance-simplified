// Privacy-safe timing instrumentation for latency auditing.
// No user text, prompts, document text, or secrets are logged.
// Only operation names, durations, and sanitized metadata (counts, sizes).

export interface TimingEvent {
  operation: string;
  durationMs: number;
  metadata?: Record<string, number | string | boolean>;
  timestamp: string;
}

export interface TimingSummary {
  operation: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  totalMs: number;
}

const globalTimings: TimingEvent[] = [];

/** Record a timing event. Never throws. */
export function recordTiming(
  operation: string,
  durationMs: number,
  metadata?: Record<string, number | string | boolean>
): void {
  try {
    globalTimings.push({
      operation,
      durationMs,
      metadata,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // never throws
  }
}

/** Get all recorded timing events. */
export function getTimings(): TimingEvent[] {
  return [...globalTimings];
}

/** Clear all recorded timing events. */
export function clearTimings(): void {
  globalTimings.length = 0;
}

/** Compute summary statistics for an operation. */
export function summarizeTimings(operation: string): TimingSummary | null {
  const events = globalTimings.filter((e) => e.operation === operation);
  if (events.length === 0) return null;

  const durations = events.map((e) => e.durationMs).sort((a, b) => a - b);
  const count = durations.length;
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const minMs = durations[0];
  const maxMs = durations[count - 1];
  const p50Ms = durations[Math.floor(count * 0.5)];
  const p95Ms = durations[Math.floor(count * 0.95)];

  return { operation, count, p50Ms, p95Ms, minMs, maxMs, totalMs };
}

/** Get summaries for all operations. */
export function getAllSummaries(): TimingSummary[] {
  const operations = new Set(globalTimings.map((e) => e.operation));
  return [...operations].map((op) => summarizeTimings(op)!).filter(Boolean);
}

/** Higher-order function to time an async operation. */
export async function timeAsync<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, number | string | boolean>
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    recordTiming(operation, Date.now() - start, metadata);
  }
}

/** Higher-order function to time a sync operation. */
export function timeSync<T>(
  operation: string,
  fn: () => T,
  metadata?: Record<string, number | string | boolean>
): T {
  const start = Date.now();
  try {
    return fn();
  } finally {
    recordTiming(operation, Date.now() - start, metadata);
  }
}

/** Format timing summary for console output. */
export function formatSummary(summary: TimingSummary): string {
  return `${summary.operation}: count=${summary.count} p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms min=${summary.minMs}ms max=${summary.maxMs}ms total=${summary.totalMs}ms`;
}

/** Print all summaries to console. */
export function printAllSummaries(): void {
  const summaries = getAllSummaries();
  if (summaries.length === 0) {
    console.log("[TIMING] No timing events recorded");
    return;
  }
  console.log("[TIMING] Latency Summary:");
  for (const s of summaries) {
    console.log(`  ${formatSummary(s)}`);
  }
}