// C-1 (owner default, roadmap §2 M4 close-out): keep the FIVE display
// verdicts and map internal statuses onto them in ONE table. This file is
// that one place (evidence-core.md §3 "Verdict layers rule"). The display
// vocabulary itself lives unchanged in app/lib/verdicts.ts.
//
// Layers stay separate: internal outcome statuses (evidence core) → display
// verdicts (this table) → navigation groups (never change a verdict).
// A missing or unconfirmable item NEVER maps to a negative-sounding verdict:
// it is NOT STATED or NEEDS VERIFICATION — never "No", "Not covered",
// "Not eligible" or "Excluded" on any layer.

import { assertVerdict, type Verdict } from "@/app/lib/verdicts";

/** Internal outcome statuses for one provision/coverage conclusion
 *  (ADR-003.1/003.2 target vocabulary, evidence-core.md §3). */
export const OUTCOME_STATUSES = [
  "verified",
  "conditional",
  "exclusion_applies",
  "undetermined",
  "not_found_in_read_pages",
  "discovered_unverified",
  "conflict",
  "cannot_be_confirmed",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

/** Exclusion applicability statuses (resolver-internal). They are inputs to
 *  the resolver's outcome; they are never mapped to a display verdict
 *  directly — only an `OutcomeStatus` is. */
export const APPLICABILITY_STATUSES = [
  "unrelated",
  "not_applicable_verified",
  "not_applicable_conditional",
  "applies_verified",
  "unresolved_material",
] as const;
export type ApplicabilityStatus = (typeof APPLICABILITY_STATUSES)[number];

/** Outcomes that represent absence or lack of proof. They must never map to
 *  DOES NOT APPEAR TO FIT (the only negative-leaning display verdict). */
export const ABSENCE_OUTCOMES: readonly OutcomeStatus[] = [
  "undetermined",
  "not_found_in_read_pages",
  "discovered_unverified",
  "cannot_be_confirmed",
];

/** THE mapping table. One row per internal outcome status. */
export const OUTCOME_TO_VERDICT: Readonly<Record<OutcomeStatus, Verdict>> = Object.freeze({
  verified: "SUPPORTED",
  // Applies only under conditions the user has not been shown to meet.
  conditional: "NEEDS VERIFICATION",
  // A verified exclusion applies; requires a rationale naming the cited exclusion.
  exclusion_applies: "DOES NOT APPEAR TO FIT",
  undetermined: "NEEDS VERIFICATION",
  // Honest absence (EC-10): "not found in the pages read", never "not covered".
  not_found_in_read_pages: "NOT STATED",
  discovered_unverified: "NEEDS VERIFICATION",
  conflict: "CONFLICTED",
  // Altered, unissued or read-back-without-re-derivation (AT-PERSIST).
  cannot_be_confirmed: "NEEDS VERIFICATION",
});

export function isOutcomeStatus(value: unknown): value is OutcomeStatus {
  return typeof value === "string" && (OUTCOME_STATUSES as readonly string[]).includes(value);
}

/** Display verdict for an internal outcome status. Fail closed: anything
 *  that is not a known outcome status (including applicability statuses,
 *  which must go through the resolver first) is NEEDS VERIFICATION. */
export function displayVerdictFor(status: unknown): Verdict {
  return assertVerdict(isOutcomeStatus(status) ? OUTCOME_TO_VERDICT[status] : "NEEDS VERIFICATION");
}
