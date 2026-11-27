// V1.1 workspace grouping: at most five stable top-level sections with
// document-specific AI-discovered presentation groups nested inside them.
// Unknown facts land in Evidence & Actions; nothing is discarded.

import type { TableRow } from "@/app/lib/extraction/types";
import { sectionForFactName, SECTIONS, type Section } from "@/app/lib/extraction/sections";
import type { PresentationGroup } from "@/app/lib/extraction/presentation-groups";

export interface WorkspaceSubgroup<R extends TableRow = TableRow> {
  title: string;
  rows: R[];
}

export interface WorkspaceSection<R extends TableRow = TableRow> {
  section: Section;
  subgroups: WorkspaceSubgroup<R>[];
}

const DEFAULT_SUBGROUP = "Details";

/** Decide which top-level section a presentation group belongs to by majority
 *  vote of its fact names. Ties and unclassifiable groups go to Evidence & Actions. */
function sectionForGroup(group: PresentationGroup): string {
  const counts = new Map<string, number>();
  for (const name of group.factNames) {
    const section = sectionForFactName(name);
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  let best = "Evidence & Actions";
  let bestCount = 0;
  for (const [section, count] of counts) {
    if (count > bestCount) {
      best = section;
      bestCount = count;
    }
  }
  return best;
}

/** Build the V1.1 workspace view: at most five top-level sections, each
 *  containing nested presentation subgroups. Empty sections and subgroups
 *  are omitted. */
export function buildWorkspaceGroups<R extends TableRow>(
  rows: readonly R[],
  presentationGroups: readonly PresentationGroup[] | undefined,
): WorkspaceSection<R>[] {
  const byName = new Map(rows.map((r) => [r.factName, r]));
  const sectionIndex = new Map<string, number>();
  for (let i = 0; i < SECTIONS.length; i++) sectionIndex.set(SECTIONS[i].title, i);

  const sectionSubgroups = new Map<string, WorkspaceSubgroup<R>[]>();
  const assigned = new Set<string>();

  if (presentationGroups && presentationGroups.length > 0) {
    for (const group of presentationGroups) {
      const section = sectionForGroup(group);
      const rowsInGroup: R[] = [];
      for (const name of group.factNames) {
        const r = byName.get(name);
        if (!r || assigned.has(name)) continue;
        // Unknown fact keys bypass AI grouping and go to Evidence & Actions
        // so they are never silently miscategorized by a mixed group.
        if (sectionForFactName(name) === "Evidence & Actions" && section !== "Evidence & Actions") continue;
        rowsInGroup.push(r);
        assigned.add(name);
      }
      if (rowsInGroup.length === 0) continue;
      const list = sectionSubgroups.get(section) ?? [];
      list.push({ title: group.title, rows: rowsInGroup });
      sectionSubgroups.set(section, list);
    }
  }

  // Ungrouped rows fall back to a default subgroup in their canonical section.
  for (const [factName, r] of byName) {
    if (assigned.has(factName)) continue;
    const section = sectionForFactName(factName);
    const list = sectionSubgroups.get(section) ?? [];
    const existing = list.find((s) => s.title === DEFAULT_SUBGROUP);
    if (existing) existing.rows.push(r);
    else list.push({ title: DEFAULT_SUBGROUP, rows: [r] });
    sectionSubgroups.set(section, list);
  }

  const result: WorkspaceSection<R>[] = [];
  for (const section of SECTIONS) {
    const subgroups = sectionSubgroups.get(section.title) ?? [];
    if (subgroups.length === 0) continue;
    result.push({ section, subgroups });
  }
  return result;
}
