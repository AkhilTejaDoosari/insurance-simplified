// Synthetic documents for the C4 authority tests (no real-PDF text, insurer
// or product names). Every fixture is registered through the session
// registry and every provision is sealed and admitted by the ProvisionStore.
import { expect } from "vitest";
import { EvidenceAuthority } from "@/app/lib/evidence/canonical";
import { sealProvision, type ProvisionContent, type ProvisionKind } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { SessionDocumentRegistry, type VerifiedPlanIdentity } from "@/app/lib/evidence/registry";
import type { BasisCandidate, ScopeQuery } from "@/app/lib/evidence/authority";

export const SESSION = "sess-m7f";
export const PLAN_NAME = "Example Health Silver";
export const FULL_YEAR = { start: "2026-01-01", end: "2026-12-31", line: "Plan year: January 1, 2026 through December 31, 2026" };
export const SECOND_HALF = { start: "2026-07-01", end: "2026-12-31", line: "Effective period: July 1, 2026 through December 31, 2026" };

export interface DocSpec {
  id: string;
  title: string;
  planId?: string;
  name?: string;
  /** null = no issuer line. */
  issuer?: string | null;
  /** null = no verified period. */
  period?: { start: string; end: string; line: string } | null;
  extra?: string[];
  benefits: string[];
}

export function docId(suffix: string): string {
  return `${SESSION}--${suffix}`;
}

function pagesOf(spec: DocSpec): [string, string] {
  const issuer = spec.issuer === undefined ? "Example Mutual" : spec.issuer;
  const period = spec.period === undefined ? FULL_YEAR : spec.period;
  const page1 = [
    spec.title,
    `Plan name: ${spec.name ?? PLAN_NAME}`,
    ...(issuer ? [`Issued by ${issuer}`] : []),
    ...(period ? [period.line] : []),
    ...(spec.extra ?? []),
  ].join("\n");
  return [page1, spec.benefits.join("\n")];
}

function spanOf(documentId: string, pages: readonly string[], page: number, text: string) {
  const source = pages[page - 1];
  const start = source.indexOf(text);
  if (start < 0) throw new Error(`fixture span missing: ${text}`);
  return { documentId, page, start, end: start + text.length, text };
}

function planOf(spec: DocSpec, pages: [string, string]): VerifiedPlanIdentity {
  const issuer = spec.issuer === undefined ? "Example Mutual" : spec.issuer;
  const period = spec.period === undefined ? FULL_YEAR : spec.period;
  const name = spec.name ?? PLAN_NAME;
  return {
    planId: spec.planId ?? "plan-silver",
    name: { value: name, span: spanOf(spec.id, pages, 1, `Plan name: ${name}`) },
    ...(issuer ? { issuer: { value: issuer, span: spanOf(spec.id, pages, 1, `Issued by ${issuer}`) } } : {}),
    ...(period ? { period: { start: period.start, end: period.end, span: spanOf(spec.id, pages, 1, period.line) } } : {}),
  };
}

export interface ProvSpec {
  doc: string;
  line: string;
  kind?: ProvisionKind;
  networkTier?: string;
}

export function build(specs: DocSpec[], provs: ProvSpec[], options: { authority?: EvidenceAuthority } = {}) {
  const authority = options.authority ?? new EvidenceAuthority();
  const registry = new SessionDocumentRegistry(SESSION);
  const pagesById = new Map<string, [string, string]>();
  for (const spec of specs) {
    const pages = pagesOf(spec);
    pagesById.set(spec.id, pages);
    const res = registry.register({
      sessionId: SESSION,
      documentId: spec.id,
      bytes: new TextEncoder().encode(`%PDF-synthetic-m7f-${spec.id}`),
      pages,
      plan: planOf(spec, pages),
    });
    expect(res, spec.id).toMatchObject({ ok: true });
  }
  const store = new ProvisionStore(SESSION, registry, authority);
  for (const p of provs) {
    const doc = registry.get(p.doc)!;
    const plan = doc.plan!;
    const quote = { documentId: p.doc, page: 2, quote: p.line };
    const content: ProvisionContent = {
      sessionId: SESSION,
      documentId: p.doc,
      documentSha256: doc.sha256,
      kind: p.kind ?? "cost_share",
      claim: p.line,
      plan: { planId: plan.planId, name: plan.name.value, nameSpan: plan.name.span },
      scope: p.networkTier ? { networkTier: { value: p.networkTier, evidence: quote } } : {},
      evidence: [quote],
    };
    const res = store.accept(sealProvision(authority, content));
    expect(res, `${p.doc}: ${p.line}`).toMatchObject({ ok: true });
  }
  return { authority, registry, store, pagesById };
}

export function basis(statementDoc: string, statement: string, targetDoc: string, target: string, page = 1): BasisCandidate {
  return {
    statement: { documentId: statementDoc, page, quote: statement },
    target: { documentId: targetDoc, page: 1, quote: target },
  };
}

// ---- The default amendment scenario --------------------------------------

export const B = docId("base");
export const A = docId("amend");
export const B_TITLE = "Example Health Silver Schedule of Benefits Version B";
export const BASIS_A = `This amendment replaces the specialist visit cost share in ${B_TITLE}.`;
export const B_SPECIALIST = "In-network specialist visit: $40 copay after deductible.";
export const A_SPECIALIST = "In-network specialist visit: $55 copay after deductible.";
export const B_PRIMARY = "In-network primary care visit: $20 copay.";
export const A_PRIMARY = "In-network primary care visit: $25 copay.";
export const B_ER = "In-network emergency room visit: $250 copay.";

export const SPECIALIST: ScopeQuery = { kind: "cost_share", subject: "specialist visit", networkTier: "In-network" };
export const PRIMARY: ScopeQuery = { kind: "cost_share", subject: "primary care visit", networkTier: "In-network" };
export const ER: ScopeQuery = { kind: "cost_share", subject: "emergency room visit", networkTier: "In-network" };

export function baseSpec(over: Partial<DocSpec> = {}): DocSpec {
  return { id: B, title: B_TITLE, benefits: [B_SPECIALIST, B_PRIMARY, B_ER], ...over };
}

export function amendSpec(over: Partial<DocSpec> = {}): DocSpec {
  return {
    id: A,
    title: "Example Health Silver Amendment Version A",
    period: SECOND_HALF,
    extra: [BASIS_A],
    benefits: [A_SPECIALIST, A_PRIMARY],
    ...over,
  };
}

export const DEFAULT_PROVS: ProvSpec[] = [
  { doc: B, line: B_SPECIALIST, networkTier: "In-network" },
  { doc: B, line: B_PRIMARY, networkTier: "In-network" },
  { doc: B, line: B_ER, networkTier: "In-network" },
  { doc: A, line: A_SPECIALIST, networkTier: "In-network" },
  { doc: A, line: A_PRIMARY, networkTier: "In-network" },
];

export const BASIS_A_CANDIDATE = basis(A, BASIS_A, B, B_TITLE);

export function scenario(over: { base?: Partial<DocSpec>; amend?: Partial<DocSpec>; provs?: ProvSpec[] } = {}) {
  return build([baseSpec(over.base), amendSpec(over.amend)], over.provs ?? DEFAULT_PROVS);
}
