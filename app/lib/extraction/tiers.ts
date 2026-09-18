// Column model for multi-tier documents. A document whose values carry
// several distinct qualifiers.planTier names is shown as one column per
// tier; everything here is pure so the table component stays declarative.

import type { CellValue, ComparisonTable } from "@/app/lib/extraction/types";

const key = (tier: string) => tier.trim().toLowerCase();

/** Distinct tier names per document, in order of first appearance. Documents
 *  with no tagged values map to an empty list. */
export function documentTiers(table: ComparisonTable): Map<string, string[]> {
  const tiers = new Map<string, string[]>(table.documents.map((d) => [d.documentId, []]));
  for (const row of table.rows) {
    for (const v of row.values) {
      const tier = v.qualifiers.planTier?.trim();
      if (!tier) continue;
      const list = tiers.get(v.documentId);
      if (list && !list.some((t) => key(t) === key(tier))) list.push(tier);
    }
  }
  return tiers;
}

/** A document's values for one cell. With a tier, values tagged for that tier
 *  plus untagged values (which apply to the whole document). Generic over
 *  the value type so enriched (registered) tables keep their evidence IDs. */
export function cellValues<T extends CellValue>(values: T[], documentId: string, tier?: string): T[] {
  return values.filter((v) => {
    if (v.documentId !== documentId) return false;
    if (!tier) return true;
    const own = v.qualifiers.planTier?.trim();
    return !own || key(own) === key(tier);
  });
}
