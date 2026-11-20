// C1 exclusion proposer → verifier seal → ProvisionStore.accept (the only gate).
//
// For each registered document, propose one verbatim exclusion provision per
// item of its exclusion sections (exclusion-sections.ts). Plan binding
// (EC-3) comes only from the registry: the document must carry exactly one
// verified plan identity (the registry registers one only when a single
// verified plan covers the document), and the document must declare no other
// plan. Never filename, proximity or mention inference. A section that names
// another verified plan of the session, and an item that states a plan-tier
// scope term (scope would not travel with the claim, EC-4), are not proposed.
// Every refused proposal is dropped and counted — no silent partial state.

import type { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { sealProvision, type ProvisionContent } from "@/app/lib/evidence/provision";
import type { ProvisionStore } from "@/app/lib/evidence/provision-store";
import type { RegisteredDocument } from "@/app/lib/evidence/registry";
import { literallyStates, quoteReverifies } from "@/app/lib/evidence/source-span";
import { planMentionPattern } from "@/app/lib/extraction/plan-identity";
import { FRAMING, scanExclusionSections, type DropReason } from "@/app/lib/evidence/proposer/exclusion-sections";

export const EXCLUSION_PROPOSER = "exclusion-proposer@1";

export type UnboundReason = "no-verified-plan" | "declares-other-plan" | "framed-document";

export interface ExclusionProposalReport {
  documentId: string;
  sectionsFound: number;
  framedSections: number;
  /** Set when sections were found but nothing could be bound to a plan. */
  unbound?: UnboundReason;
  proposed: number;
  accepted: number;
  refused: number;
  /** Items dropped before proposal, by reason (ambiguity is never proposed). */
  dropped: Partial<Record<DropReason | "other-plan" | "scoped" | "duplicate", number>>;
  /** 1-based pages holding an exclusion candidate that was not proposed
   *  (every drop except an exact duplicate), sorted. */
  droppedPages: number[];
}

/** Same "Policy/Plan name:" declaration shape plan-identity attests from. */
const DECLARATION_NAME_RE = /^\s*(?:Policy|Plan) name:\s*([^;\n]{1,120})/i;

function declaresOtherPlan(doc: RegisteredDocument, ownerName: string): boolean {
  const owner = ownerName.trim().toLowerCase();
  return doc.pages.some((page) =>
    page.split(/\r?\n/).some((line) => {
      const m = DECLARATION_NAME_RE.exec(line);
      return !!m?.[1]?.trim() && m[1].trim().toLowerCase() !== owner;
    }));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ProposeContext {
  sessionId: string;
  /** Names of the OTHER verified plans of the session. */
  otherPlanNames: readonly string[];
  /** Plan-tier scope terms of this document's verified table (e.g. column
   *  headings). An item stating one is scoped and not proposed. */
  scopeTerms?: readonly string[];
}

/** Proposals (unsealed content) for one registered document. */
export function proposeExclusions(
  doc: RegisteredDocument,
  ctx: ProposeContext,
): { proposals: ProvisionContent[]; report: ExclusionProposalReport } {
  const scan = scanExclusionSections(doc.pages);
  const report: ExclusionProposalReport = {
    documentId: doc.documentId,
    sectionsFound: scan.sections.length,
    framedSections: scan.framedSections,
    proposed: 0,
    accepted: 0,
    refused: 0,
    dropped: {},
    droppedPages: [],
  };
  const pages = new Set<number>();
  const drop = (reason: keyof ExclusionProposalReport["dropped"], page?: number) => {
    report.dropped[reason] = (report.dropped[reason] ?? 0) + 1;
    if (page !== undefined && reason !== "duplicate") pages.add(page);
    report.droppedPages = [...pages].sort((a, b) => a - b);
  };
  for (const d of scan.dropped) drop(d.reason, d.page);
  if (scan.documentFramed) return { proposals: [], report: { ...report, unbound: "framed-document" } };
  if (scan.sections.length === 0) return { proposals: [], report };
  const plan = doc.plan;
  if (!plan) return { proposals: [], report: { ...report, unbound: "no-verified-plan" } };
  if (declaresOtherPlan(doc, plan.name.value)) return { proposals: [], report: { ...report, unbound: "declares-other-plan" } };

  const others = ctx.otherPlanNames
    .filter((n) => n.trim().toLowerCase() !== plan.name.value.trim().toLowerCase())
    .flatMap((n) => planMentionPattern(n) ?? []);
  const scopeTerms = (ctx.scopeTerms ?? []).filter((t) => t.trim().length >= 3);

  // A section naming another verified plan is ambiguous as a whole.
  const otherPlanSections = new Set<number>();
  for (const section of scan.sections) {
    const text = doc.pages.slice(section.page - 1, section.endPage).join("\n");
    if (others.some((re) => re.test(text))) otherPlanSections.add(section.index);
  }

  const proposals: ProvisionContent[] = [];
  const seen = new Set<string>();
  for (const item of scan.items) {
    const page = doc.pages[item.page - 1];
    const text = page.slice(item.start, item.end);
    const claim = collapse(text);
    if (!/[A-Za-z]{2}/.test(claim)) { drop("no-text", item.page); continue; }
    if (otherPlanSections.has(item.section)) { drop("other-plan", item.page); continue; }
    if (FRAMING.test(claim)) { drop("framing", item.page); continue; }
    if (scopeTerms.some((t) => literallyStates(claim, t))) { drop("scoped", item.page); continue; }
    // Quote: the item text, or with its marker when the bare text is not a
    // unique span of the page. The store re-verifies either way.
    const withMarker = page.slice(item.markerStart, item.end);
    const quote = quoteReverifies(doc, { documentId: doc.documentId, page: item.page, quote: text }) || withMarker === text
      ? text
      : withMarker;
    const key = `${item.page}\u0000${quote}`;
    if (seen.has(key)) { drop("duplicate"); continue; }
    seen.add(key);
    proposals.push({
      sessionId: ctx.sessionId,
      documentId: doc.documentId,
      documentSha256: doc.sha256,
      kind: "exclusion",
      claim,
      plan: { planId: plan.planId, name: plan.name.value, nameSpan: { ...plan.name.span } },
      scope: {},
      evidence: [{ documentId: doc.documentId, page: item.page, quote }],
    });
  }
  report.proposed = proposals.length;
  return { proposals, report };
}

/** Seal every proposal and hand it to the store; refusals are counted. */
export function sealExclusionProposals(
  store: ProvisionStore,
  authority: EvidenceAuthority,
  ctx: Omit<ProposeContext, "sessionId" | "scopeTerms"> & { scopeTermsFor?: (documentId: string) => readonly string[] },
): ExclusionProposalReport[] {
  return store.registry.list().map((doc) => {
    const { proposals, report } = proposeExclusions(doc, {
      sessionId: store.sessionId,
      otherPlanNames: ctx.otherPlanNames,
      scopeTerms: ctx.scopeTermsFor?.(doc.documentId) ?? [],
    });
    const held = new Set(store.listByKind("exclusion", { documentId: doc.documentId })
      .flatMap((p) => p.evidence.map((e) => `${e.page}\u0000${e.quote}`)));
    for (const content of proposals) {
      if (content.evidence.every((e) => held.has(`${e.page}\u0000${e.quote}`))) {
        report.dropped.duplicate = (report.dropped.duplicate ?? 0) + 1;
        report.proposed--;
        continue;
      }
      const res = store.accept(sealProvision(authority, content));
      if (res.ok) report.accepted++;
      else report.refused++;
    }
    return report;
  });
}
