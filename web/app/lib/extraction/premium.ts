// Personalized age-banded premium selection. Extraction may recover a full
// rate table (one value per tier per age band with numeric ageMin/ageMax);
// this module deterministically chooses the band matching the canonical
// Page 2 age. The model never chooses. Unmatched or ageless bands resolve
// to honest uncertainty, never a guessed or dumped rate.

import type { ComparisonTable, TableRow } from "@/app/lib/extraction/types";
import { checkDisplayGrounding } from "@/app/lib/evidence-verification";

export const VARIES_BY_AGE = "Varies by age.";
export const NO_RATE_FOR_AGE_PREFIX = "No stated rate covers age";

export function parseMemberAge(userContext: Record<string, string>): number | null {
  const raw = (userContext.age ?? "").trim();
  if (!raw) return null;
  const age = Number.parseInt(raw, 10);
  if (!Number.isFinite(age) || age < 0 || age > 120) return null;
  return age;
}

function isBanded(qualifiers: unknown): boolean {
  if (typeof qualifiers !== "object" || qualifiers === null) return false;
  const q = qualifiers as Record<string, unknown>;
  return (
    (typeof q.ageMin === "number" && Number.isFinite(q.ageMin)) ||
    (typeof q.ageMax === "number" && Number.isFinite(q.ageMax))
  );
}

function bandCovers(qualifiers: unknown, age: number): boolean {
  const q = qualifiers as Record<string, unknown>;
  const min = typeof q.ageMin === "number" && Number.isFinite(q.ageMin) ? q.ageMin : null;
  const max = typeof q.ageMax === "number" && Number.isFinite(q.ageMax) ? q.ageMax : null;
  if (min !== null && age < min) return false;
  if (max !== null && age > max) return false;
  return true;
}

function bandAmount(display: string, qualifiers: unknown): number | null {
  const q =
    typeof qualifiers === "object" && qualifiers !== null
      ? (qualifiers as Record<string, unknown>)
      : {};
  if (typeof q.amount === "number" && Number.isFinite(q.amount)) return q.amount;
  const match = /\$([\d,]+)/.exec(display);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function bandFrequency(display: string, qualifiers: unknown): string {
  const q =
    typeof qualifiers === "object" && qualifiers !== null
      ? (qualifiers as Record<string, unknown>)
      : {};
  if (typeof q.frequency === "string" && q.frequency.trim()) {
    return q.frequency.trim().toLowerCase();
  }
  if (/\/\s*mo(nth)?\b/i.test(display)) return "monthly";
  if (/\/\s*yr\b|per year|\bannual\b/i.test(display)) return "annual";
  if (/per month|\bmonthly\b/i.test(display)) return "monthly";
  return "";
}

/** Personalize one premium row against canonical user context. Rows without
 *  explicit age bands pass through untouched. */
export function personalizePremiumRow(
  row: TableRow,
  userContext: Record<string, string>,
): TableRow {
  if (!row.values.some((v) => isBanded(v.qualifiers))) return row;
  const age = parseMemberAge(userContext);
  if (age === null) {
    return { ...row, verdict: "NEEDS VERIFICATION", values: [], rationale: VARIES_BY_AGE };
  }
  const matched = row.values.filter((v) => bandCovers(v.qualifiers, age));
  if (matched.length === 0) {
    return {
      ...row,
      verdict: "NEEDS VERIFICATION",
      values: [],
      rationale: `${NO_RATE_FOR_AGE_PREFIX} ${age}.`,
    };
  }
  return {
    ...row,
    values: matched.map((v) => {
      const amount = bandAmount(v.display, v.qualifiers);
      if (amount === null) return v;
      const frequency = bandFrequency(v.display, v.qualifiers);
      const suffix = frequency === "monthly" ? "/mo" : frequency === "annual" ? "/yr" : "";
      const quotes = v.evidence.map((e) => e.quote);
      // Derived displays must satisfy the locked material-token grounding
      // rule against the value's own evidence: prefer the concise suffixed
      // form, fall back to the bare amount, else keep the source display.
      const candidates =
        suffix === "" ? [`$${amount}`] : [`$${amount}${suffix}`, `$${amount}`];
      for (const candidate of candidates) {
        if (checkDisplayGrounding(candidate, "premium", quotes).supported) {
          return { ...v, display: candidate };
        }
      }
      return v;
    }),
  };
}

/** Apply premium personalization across a table (both engines call this). */
export function applyPremiumPersonalization<T extends ComparisonTable>(
  table: T,
  userContext: Record<string, string>,
): T {
  if (!table.rows.some((r) => r.factName === "premium")) return table;
  return {
    ...table,
    rows: table.rows.map((r) =>
      r.factName === "premium" ? personalizePremiumRow(r, userContext) : r,
    ),
  };
}
