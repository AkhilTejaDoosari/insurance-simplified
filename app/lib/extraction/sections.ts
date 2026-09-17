// Presentation grouping for the comparison table. Sections slice the fact
// rows into three stacked groups; the plan columns are identical in each.
// Fact names must match app/lib/extraction/fact-list.ts (tested).

import type { TableRow } from "@/app/lib/extraction/types";

export interface Section {
  title: string;
  /** One plain-English line for a first-time buyer: why this group matters. */
  description: string;
  factNames: string[];
}

export const SECTIONS: Section[] = [
  {
    title: "Must know",
    description:
      "The costs and conditions that decide whether a plan works for you at all.",
    factNames: [
      "annual-deductible",
      "out-of-pocket-maximum",
      "eligibility",
      "student-eligibility",
      "coverage-dates",
      "network",
      "pre-existing-conditions",
    ],
  },
  {
    title: "Coverage details",
    description: "What each plan pays for when you actually need care.",
    factNames: [
      "emergency-care",
      "emergency-copay",
      "hospitalization",
      "prescriptions",
      "primary-care-visit",
      "specialist-visit",
      "mental-health",
      "maternity-coverage",
    ],
  },
  {
    title: "Extras and fine print",
    description:
      "Nice-to-haves, limits and rules worth checking before you sign.",
    factNames: [
      "dental-coverage",
      "vision-coverage",
      "preventive-care",
      "urgent-care",
      "ambulance",
      "lab-and-imaging",
      "referral-requirement",
      "waiting-period",
      "age-limits",
      "international-coverage",
    ],
  },
];

const OTHER: Section = {
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
 *  evidence IDs. */
export function groupRows<R extends TableRow>(rows: R[]): SectionGroup<R>[] {
  const byName = new Map(rows.map((r) => [r.factName, r]));
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
