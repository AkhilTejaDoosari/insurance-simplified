// Customer-facing plan titles.
// A plan title comes ONLY from a source-verified plan identity carried by the
// validated comparison table. Filenames — raw, numeric-prefixed or prettified —
// are never used as plan titles; they stay document/evidence metadata. When no
// reliable identity exists the UI shows a clear unconfirmed label,
// distinguished by upload order when several documents lack one. No plan name
// is ever invented (see USER_FLOWS.md).

import type { ComparisonTable } from "@/app/lib/extraction/types";

export const UNCONFIRMED_PLAN_TITLE = "Plan name unconfirmed";

export interface PlanTitle {
  name: string;
  source: "verified" | "unconfirmed";
}

type TitleTable = Pick<ComparisonTable, "documents" | "plans">;

function ownsDocument(
  table: TitleTable,
  documentId: string,
): number {
  return (table.plans ?? []).filter((plan) =>
    plan.sources.some((source) => source.documentId === documentId),
  ).length;
}

/** Title for a document-scoped plan view: the name of the single proven plan
 *  that carries this document, or an unconfirmed label distinguished by the
 *  document's upload position when several documents lack a proven plan. */
export function documentPlanTitle(
  table: TitleTable,
  documentId: string,
): PlanTitle {
  const owningCount = ownsDocument(table, documentId);
  if (owningCount === 1) {
    return {
      name: (table.plans ?? []).find((plan) =>
        plan.sources.some((source) => source.documentId === documentId),
      )!.name,
      source: "verified",
    };
  }
  // Legacy tables carry no proven plans: every document is its own
  // unconfirmed plan view. Other ownership shapes (none, or a document
  // shared by several proven plans) also have no single verifiable name.
  const unconfirmedDocuments = table.documents.filter(
    (doc) => (table.plans?.length ?? 0) === 0 && ownsDocument(table, doc.documentId) === 0,
  );
  const ordinal = unconfirmedDocuments.findIndex((doc) => doc.documentId === documentId) + 1;
  if (unconfirmedDocuments.length > 1 && ordinal > 0) {
    return { name: `${UNCONFIRMED_PLAN_TITLE} (upload ${ordinal})`, source: "unconfirmed" };
  }
  return { name: UNCONFIRMED_PLAN_TITLE, source: "unconfirmed" };
}
