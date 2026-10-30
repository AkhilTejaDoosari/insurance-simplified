// Presentation grouping for the comparison table. Sections slice the fact
// rows into at most five stable top-level navigation containers;
// document-specific AI-discovered groups are nested subgroups within them.
// Fact names must match app/lib/extraction/fact-list.ts (tested).

import type { TableRow } from "@/app/lib/extraction/types";
import { ELIGIBILITY_ROW_NAME, NON_DISPLAY_FEEDERS } from "@/app/lib/extraction/eligibility";

export interface Section {
  title: string;
  /** One plain-English line for a first-time buyer: why this group matters. */
  description: string;
  factNames: string[];
}

export type SectionTitle =
  | "My Fit"
  | "My Costs"
  | "Coverage"
  | "Limits & Risks"
  | "Evidence & Actions";

export const SECTIONS: Section[] = [
  {
    title: "My Fit",
    description:
      "Can this coverage apply to you? Eligibility, age, residency, location, visa/status, dates and personal conflicts.",
    factNames: [
      ELIGIBILITY_ROW_NAME,
    ],
  },
  {
    title: "My Costs",
    description:
      "What you might pay: premium, deductible, copay, coinsurance, out-of-pocket maximum, policy limit and conditional costs.",
    factNames: [
      "annual-deductible",
      "out-of-pocket-maximum",
      "premium",
      "coinsurance",
      "network",
      "policy-limit",
      "pre-existing-conditions",
    ],
  },
  {
    title: "Coverage",
    description:
      "What services are included: hospitalization, emergency care, dental, treatment and specialized benefits.",
    factNames: [
      "primary-care-visit",
      "specialist-visit",
      "urgent-care",
      "emergency-care",
      "hospitalization",
      "surgery",
      "prescriptions",
      "mental-health",
      "maternity-coverage",
      "preventive-care",
      "lab-and-imaging",
      "ambulance",
      "dental-coverage",
      "vision-coverage",
      "emergency-evacuation",
      "repatriation",
      "political-evacuation",
      "terrorism-coverage",
      "emergency-reunion",
      "bedside-visit",
      "ad-and-d",
      "incidental-trip",
      "telehealth",
      "physical-therapy",
      "chiropractic",
      "durable-medical-equipment",
      "home-nursing",
      "student-health-center",
    ],
  },
  {
    title: "Limits & Risks",
    description:
      "What could restrict coverage: exclusions, waiting periods, policy limits, sublimits and geographical restrictions.",
    factNames: [
      "network-rules",
      "preauthorization",
      "referral-requirement",
      "material-exclusions",
      "waiting-period",
      "coverage-duration",
      "age-limits",
      "geographic-restrictions",
      "international-coverage",
    ],
  },
  {
    title: "Evidence & Actions",
    description:
      "What is confirmed and what you must verify: sources, contradictions, unknowns, contacts and insurer questions.",
    factNames: [],
  },
];

const SECTION_BY_FACT = new Map<string, string>();
for (const section of SECTIONS) {
  for (const name of section.factNames) {
    SECTION_BY_FACT.set(name, section.title);
  }
}

export function sectionForFactName(factName: string): string {
  return SECTION_BY_FACT.get(factName) ?? "Evidence & Actions";
}

export interface SectionGroup<R extends TableRow = TableRow> {
  section: Section;
  rows: R[];
}

/** Split rows into sections in display order; empty sections are dropped.
 *  Generic over the row type so enriched (registered) tables keep their
 *  evidence IDs. Each fact has exactly one canonical section. Eligibility
 *  evidence feeders never render as own rows; only the composite does.
 *  Unknown facts are placed in Evidence & Actions, never discarded. */
export function groupRows<R extends TableRow>(rows: R[]): SectionGroup<R>[] {
  const byName = new Map(rows.map((r) => [r.factName, r]));
  for (const feeder of NON_DISPLAY_FEEDERS) byName.delete(feeder);
  const groups: SectionGroup<R>[] = [];
  for (const section of SECTIONS) {
    const matched = section.factNames.flatMap((n) => {
      const r = byName.get(n);
      if (!r) return [];
      byName.delete(n);
      return [r];
    });
    if (matched.length > 0) groups.push({ section, rows: matched });
  }
  if (byName.size > 0) {
    const actionSection = SECTIONS.find((s) => s.title === "Evidence & Actions")!;
    groups.push({ section: actionSection, rows: [...byName.values()] });
  }
  return groups;
}
