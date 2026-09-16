// Closed five-state comparison verdict vocabulary (constitution principle I).
// No other value — including yes/no, true/false, match/no-match — may appear
// in a comparison row. Use the guards below; never a bare string literal.

export const VERDICTS = [
  "SUPPORTED",
  "DOES NOT APPEAR TO FIT",
  "NOT STATED",
  "CONFLICTED",
  "NEEDS VERIFICATION",
] as const;

export type Verdict = (typeof VERDICTS)[number];

const VERDICT_SET: ReadonlySet<string> = new Set(VERDICTS);

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && VERDICT_SET.has(value);
}

export function assertVerdict(value: unknown): Verdict {
  if (!isVerdict(value)) {
    throw new Error(
      `Invalid verdict ${JSON.stringify(value)}: must be one of ${VERDICTS.join(", ")}`
    );
  }
  return value;
}
