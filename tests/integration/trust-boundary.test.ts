// Required trust-boundary acceptance tests TB-1..TB-4 (docs/evidence-core.md §5).
// They stay `it.todo` until roadmap M7 builds the exclusion inventory,
// applicability resolver and sealed provision store in application code.
// The ADR-003.2 reference implementation does NOT satisfy them. When made
// real, each must run against application code, and each must also fail
// when its guard is removed. Titles carry the exact "Attack" and
// "Must hold" text from the specification; do not paraphrase them.
import { describe, it } from "vitest";

describe("trust boundary (evidence-core.md §5, INV-EC-09 source binding)", () => {
  it.todo(
    "TB-1 — Attack: Provision with plan-name and period evidence not bound to real source blocks — Must hold: Persisting it is refused; nothing is stored",
  );
  it.todo(
    'TB-2 — Attack: Caller-built "not applicable" assessment for an exclusion that names the service — Must hold: Conclusion is never covered',
  );
  it.todo(
    'TB-3 — Attack: Resolution altered after issue, shown on comparison view, chat answer and export — Must hold: Each surface shows "cannot be confirmed"',
  );
  it.todo(
    "TB-4 — Attack: Exclusion coverage declared complete with an empty or partial exclusion list, while verified evidence contains an exclusion naming the service — Must hold: Conclusion is never covered; the inventory equals the sealed exclusion provisions",
  );
});
