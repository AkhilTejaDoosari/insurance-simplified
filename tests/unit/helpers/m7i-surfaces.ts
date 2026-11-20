// Synthetic evidence-surface fixtures (agent I). No real document text.
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";
import {
  SURFACES_SCHEMA,
  type AuthorityView,
  type EvidenceSurfaces,
  type ExclusionInventoryView,
  type SurfaceCannotBeConfirmed,
} from "@/app/lib/evidence/surface-types";

export const table: RegisteredComparisonTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "d1", filename: "plan-a.pdf", pageCount: 6 },
    { documentId: "d2", filename: "plan-b.pdf", pageCount: 4 },
    { documentId: "d3", filename: "plan-a-rider.pdf", pageCount: 2 },
  ],
  plans: [
    { planId: "pa", name: "Sample Plan A", sources: [{ documentId: "d1", page: 1, quote: "Sample Plan A" }] },
    { planId: "pb", name: "Sample Plan B", sources: [{ documentId: "d2", page: 1, quote: "Sample Plan B" }] },
  ],
  rows: [],
};

export const complete: ExclusionInventoryView = {
  kind: "exclusion-inventory",
  documentId: "d1",
  planId: "pa",
  planName: "Sample Plan A",
  coverage: "complete",
  pagesNotRead: [],
  exclusions: [
    {
      provisionId: "prov-1",
      claim: "Cosmetic procedures are not a benefit under this plan.",
      evidence: [{ documentId: "d1", page: 5, quote: "Cosmetic procedures are not a benefit under this plan.", evidenceId: "ev-x1" }],
    },
    {
      provisionId: "prov-2",
      claim: "Injuries from hazardous sports.",
      evidence: [{ documentId: "d1", page: 6, quote: "Injuries from hazardous sports.", evidenceId: "ev-x2" }],
    },
  ],
};

export const partial: ExclusionInventoryView = {
  kind: "exclusion-inventory",
  documentId: "d2",
  planId: "pb",
  planName: "Sample Plan B",
  coverage: "partial",
  pagesNotRead: [4, 3],
  exclusions: [
    {
      provisionId: "prov-3",
      claim: "Experimental treatment.",
      evidence: [{ documentId: "d2", page: 2, quote: "Experimental treatment.", evidenceId: "ev-x3" }],
    },
  ],
};

export const unknownEmpty: ExclusionInventoryView = { ...partial, coverage: "unknown", pagesNotRead: [], exclusions: [] };
export const partialEmpty: ExclusionInventoryView = { ...partial, exclusions: [] };
export const completeEmpty: ExclusionInventoryView = { ...complete, exclusions: [] };

export const exclusionsCbc: SurfaceCannotBeConfirmed = { kind: "cannot-be-confirmed", of: "exclusion-inventory", label: "cannot be confirmed" };
export const authorityCbc: SurfaceCannotBeConfirmed = { kind: "cannot-be-confirmed", of: "authority", label: "cannot be confirmed" };

export const resolved: AuthorityView = {
  kind: "authority",
  scopeLabel: "annual deductible (Sample Plan A)",
  status: "resolved",
  governing: [{ documentId: "d3", provisionId: "prov-r1" }],
  relations: [
    {
      from: "d3",
      to: "d1",
      relation: "supersedes",
      evidence: [
        { documentId: "d3", page: 1, quote: "This rider replaces the deductible schedule of Sample Plan A.", evidenceId: "ev-r1" },
        { documentId: "d1", page: 2, quote: "Deductible schedule", evidenceId: "ev-r2" },
      ],
    },
  ],
};

export const conflict: AuthorityView = {
  kind: "authority",
  scopeLabel: "out-of-pocket maximum (Sample Plan A)",
  status: "conflict",
  verdict: "CONFLICTED",
  governing: [],
  relations: [
    {
      from: "d3",
      to: "d1",
      relation: "conflicts_with",
      reasons: ["period", "basis"],
      evidence: [{ documentId: "d3", page: 2, quote: "Out-of-pocket maximum $4,000", evidenceId: "ev-c1" }],
    },
  ],
};

export function surfaces(
  exclusions: EvidenceSurfaces["exclusions"],
  authority: EvidenceSurfaces["authority"] = [],
): EvidenceSurfaces {
  return { schema: SURFACES_SCHEMA, exclusions, authority };
}

/** Words that must never describe a missing item (evidence-core §3). */
export function forbiddenWording(text: string): string[] {
  const t = text;
  const hits: string[] = [];
  if (/\bNo\b/.test(t)) hits.push("No");
  if (/no exclusions/i.test(t)) hits.push("No exclusions");
  if (/not covered/i.test(t)) hits.push("Not covered");
  if (/not excluded/i.test(t)) hits.push("Not excluded");
  if (/\bexcluded\b/i.test(t)) hits.push("Excluded");
  if (/\bcovered\b/i.test(t)) hits.push("covered");
  if (/not eligible/i.test(t)) hits.push("Not eligible");
  return hits;
}
