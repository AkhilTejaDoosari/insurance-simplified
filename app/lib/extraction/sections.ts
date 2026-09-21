// Presentation grouping for the comparison table. Sections slice the fact
// rows into four stacked groups; the plan columns are identical in each.
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
    title: "Essentials",
    description:
      "The costs and conditions that decide whether a plan works for you at all.",
    factNames: [
      "premium",
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
    title: "Care & Coverage",
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
      "preventive-care",
      "lab-and-imaging",
      "ambulance",
      "dental-coverage",
      "vision-coverage",
      "urgent-care",
    ],
  },
  {
    title: "Rules & Restrictions",
    description:
      "What conditions could prevent you from using the coverage the way you expect.",
    factNames: [
      "referral-requirement",
      "waiting-period",
      "age-limits",
      "international-coverage",
    ],
  },
  {
    title: "Plan Highlights",
    description:
      "What is unusual or unique about this plan that does not belong in the main comparison.",
    factNames: [
      "dental-coverage",
      "vision-coverage",
      "preventive-care",
      "urgent-care",
      "ambulance",
      "lab-and-imaging",
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
 *  evidence IDs. Plan Highlights re-surfaces its facts without consuming
 *  them, so lower-priority extras appear both in Care & Coverage and in
 *  the trailing highlights tab. */
export function groupRows<R extends TableRow>(rows: R[]): SectionGroup<R>[] {
  const byName = new Map(rows.map((r) => [r.factName, r]));
  const all = new Map(byName);
  const groups: SectionGroup<R>[] = [];
  for (const section of SECTIONS) {
    const isHighlights = section.title === "Plan Highlights";
    const source = isHighlights ? all : byName;
    const matched = section.factNames.flatMap((n) => {
      const r = source.get(n);
      if (!r) return [];
      if (!isHighlights) byName.delete(n);
      return [r];
    });
    if (matched.length > 0) groups.push({ section, rows: matched });
  }
  if (byName.size > 0) groups.push({ section: OTHER, rows: [...byName.values()] });
  return groups;
}
