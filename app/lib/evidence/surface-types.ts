// Contract between the evidence pipeline (producer) and the rendering surfaces
// (comparison view, export PDF, chat). Types only.
//
// Producer (app/lib/evidence/session-evidence.ts, app/lib/evidence/surfaces.ts,
// /api/extract): builds these views ONLY from the request's sealed
// ProvisionStore — exclusion inventories from sealed exclusion provisions and
// page-coverage records (EC-13), authority from app/lib/evidence/authority —
// issues them with issueResolution, and passes them through a render gate
// that re-checks each issue (checkIssued). A view that fails the gate is
// replaced by a `SurfaceCannotBeConfirmed` marker; it is never shown partially.
//
// Consumers (presentation/adaptive.ts, components, report/pdf.ts, chat) render
// these views as given. They never build, edit or complete a view, never infer
// that a missing exclusion means "covered", and never show "No", "Not covered",
// "Not eligible" or "Excluded" for something that was not found.

import type { Verdict } from "@/app/lib/verdicts";

export const SURFACES_SCHEMA = "evidence-surfaces/v1" as const;

/** One evidence span shown with a view; `evidenceId` resolves in the viewer. */
export interface SurfaceEvidence {
  documentId: string;
  page: number;
  quote: string;
  evidenceId?: string;
}

/** Exclusions of one document's verified plan, as sealed. */
export interface ExclusionInventoryView {
  kind: "exclusion-inventory";
  documentId: string;
  planId: string;
  planName: string;
  /** From page-coverage records only. "complete" only when every page was read. */
  coverage: "complete" | "partial" | "unknown";
  /** 1-based pages not read or only partly read (named to the user). */
  pagesNotRead: number[];
  /** Every sealed exclusion provision of the document, verbatim. */
  exclusions: { provisionId: string; claim: string; evidence: SurfaceEvidence[] }[];
}

/** Which document governs one provision scope across a session's documents. */
export interface AuthorityView {
  kind: "authority";
  /** Human-readable scope, e.g. fact label + plan tier/network; no inference. */
  scopeLabel: string;
  status: "resolved" | "conflict";
  /** Display verdict via the single mapping table (conflict → CONFLICTED). */
  verdict?: Verdict;
  governing: { documentId: string; provisionId: string }[];
  relations: {
    from: string; // documentId
    to: string; // documentId
    relation: "supersedes" | "conflicts_with" | "concordant" | "independent";
    /** For conflicts_with: which proof elements failed (identity/period/basis/scope/ambiguous/order). */
    reasons?: string[];
    evidence: SurfaceEvidence[];
  }[];
}

/** Shown instead of any view that fails its issued-resolution check. */
export interface SurfaceCannotBeConfirmed {
  kind: "cannot-be-confirmed";
  /** Which view kind could not be confirmed; no values are carried. */
  of: "exclusion-inventory" | "authority";
  label: "cannot be confirmed";
}

export type SurfaceView = ExclusionInventoryView | AuthorityView | SurfaceCannotBeConfirmed;

/** Field added to the extract response and the stored comparison payload. */
export interface EvidenceSurfaces {
  schema: typeof SURFACES_SCHEMA;
  exclusions: (ExclusionInventoryView | SurfaceCannotBeConfirmed)[];
  authority: (AuthorityView | SurfaceCannotBeConfirmed)[];
}
