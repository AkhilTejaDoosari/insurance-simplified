// Structural evidence dispatch: a value's anchor is verified by re-deriving
// the claim from the session document (layout table cell or prose statement).
import type { CellValue } from "@/app/lib/extraction/types";
import { verifyTableAnchor, type TableDocument } from "@/app/lib/extraction/table-facts";
import { verifyStatementAnchor } from "@/app/lib/extraction/statement-facts";
import { verifySbcAnchor } from "@/app/lib/extraction/sbc-questions";

export function verifyClaimAnchor(
  factName: string,
  value: Pick<CellValue, "documentId" | "display" | "qualifiers" | "evidence" | "anchor">,
  documents: readonly TableDocument[],
): boolean {
  switch (value.anchor?.kind) {
    case "table-cell": return verifyTableAnchor(factName, value, documents);
    case "statement": return verifyStatementAnchor(factName, value, documents) || verifySbcAnchor(factName, value, documents);
    default: return false;
  }
}
