// C4 Authority (evidence-core.md §4) — pure library; surfaces wire it later.
export * from "@/app/lib/evidence/authority/types";
export { resolveScopeAuthority } from "@/app/lib/evidence/authority/resolve";
export { identityOf, matchesScope, proveSupersession } from "@/app/lib/evidence/authority/proof";
export {
  AUTHORITY_ISSUER,
  authorityOutcome,
  authorityVerdict,
  confirmScopeAuthority,
  groupForDocument,
  issueScopeAuthority,
} from "@/app/lib/evidence/authority/outcome";
