// Presentation grouping for the comparison table. Sections slice the fact
// rows into four stacked groups; the plan columns are identical in each.
// Fact names must match app/lib/extraction/fact-list.ts (tested).

import type { TableRow } from "@/app/lib/extraction/types";
import { ELIGIBILITY_ROW_NAME, NON_DISPLAY_FEEDERS } from "@/app/lib/extraction/eligibility";

export interface Section {
  title: string;
  /** One plain-English line for a first-time buyer: why this group matters. */
  description: string;
  factNames: string[];
}

export const SECTIONS: Section[] = [
  {
    title: "Essentials",
    description:
      "The costs and conditions that decide whether a plan works for you at all.",
    factNames: [
      ELIGIBILITY_ROW_NAME,
      "annual-deductible",
      "out-of-pocket-maximum",
      "network",
      "coinsurance",
      "policy-limit",
      "premium",
      "pre-existing-conditions",
    ],
  },
  {
    title: "Care & Coverage",
    description: "What each plan pays for when you actually need care.",
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
    ],
  },
  {
    title: "Rules & Restrictions",
    description:
      "What conditions could prevent you from using the coverage the way you expect.",
    factNames: [
      "network-rules",
      "preauthorization",
      "referral-requirement",
      "material-exclusions",
      "waiting-period",
      "geographic-restrictions",
      "international-coverage",
      "coverage-duration",
      "age-limits",
    ],
  },
  {
    title: "Plan Highlights",
    description:
      "What is unusual or unique about this plan that does not belong in the main comparison.",
    factNames: [
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
];

export const OTHER: Section = {
  title: "Other",
  description: "Facts not covered by the groups above.",
  factNames: [],
};

export interface SectionGroup<R extends TableRow = TableRow> {
  section: Section;
  rows: R[];
}

/** Split rows into sections in display order; empty sections are dropped.
 *  Generic over the row type so enriched (registered) tables keep their
 *  evidence IDs. Each fact has exactly one canonical section. Eligibility
 *  evidence feeders never render as own rows; only the composite does. */
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
  if (byName.size > 0) groups.push({ section: OTHER, rows: [...byName.values()] });
  return groups;
}
