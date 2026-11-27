import type { Verdict } from "@/app/lib/verdicts";
import { ELIGIBILITY_ROW_NAME } from "@/app/lib/extraction/eligibility";

// Tone is the only saturated color on the page: green = supported, red =
// same-document/same-scope contradiction, gray = nothing found, amber = needs a human check.
const TONE: Record<Verdict, "ok" | "bad" | "none" | "warn"> = {
  SUPPORTED: "ok",
  CONFLICTED: "bad",
  "NOT STATED": "none",
  "NEEDS VERIFICATION": "warn",
  "DOES NOT APPEAR TO FIT": "warn",
};

export default function VerdictBadge({
  verdict,
  factName,
}: {
  verdict: Verdict;
  factName?: string;
}) {
  const display =
    factName === ELIGIBILITY_ROW_NAME && verdict === "SUPPORTED"
      ? "Appears eligible"
      : verdict;
  return <span className={`verdict verdict--${TONE[verdict]}`}>{display}</span>;
}
