// Synthetic exclusion scenario for TB-2 / TB-4 and the m7d unit tests.
// Invented plan, invented text — no real-document content.
import { EvidenceAuthority, sha256Hex } from "@/app/lib/evidence/canonical";
import type { PageCoverageRecord } from "@/app/lib/evidence/page-coverage";
import { sealProvision, type ProvisionContent, type ProvisionKind } from "@/app/lib/evidence/provision";
import { ProvisionStore } from "@/app/lib/evidence/provision-store";
import { SessionDocumentRegistry } from "@/app/lib/evidence/registry";

export const M7D_SESSION = "sess-m7d";
export const M7D_DOC = `${M7D_SESSION}--doc1`;
const BYTES = new TextEncoder().encode("%PDF-synthetic-m7d");

export const M7D_PAGES = [
  "Plan name: Sample Care Bronze\nPlan year: January 1, 2026 through December 31, 2026",
  "Covered services\nAcupuncture visits: $25 copay.\nChiropractic visits: $30 copay.\nHearing aids: $40 copay.",
  "Exclusions\nAcupuncture is not covered.\nCosmetic surgery is not covered.\nMedical Necessity\nServices that are not medically necessary are not covered.",
] as const;

export type CoverageMode = "complete" | "partial" | "none";

function span(page: number, text: string) {
  const source = M7D_PAGES[page - 1];
  const start = source.indexOf(text);
  if (start < 0) throw new Error("fixture span missing");
  return { documentId: M7D_DOC, page, start, end: start + text.length, text };
}

function coverage(mode: CoverageMode): PageCoverageRecord | undefined {
  if (mode === "none") return undefined;
  return {
    sessionId: M7D_SESSION,
    documentId: M7D_DOC,
    documentSha256: sha256Hex(BYTES),
    pageCount: M7D_PAGES.length,
    pages: M7D_PAGES.map((_, i) => ({ page: i + 1, status: mode === "partial" && i === 2 ? "unreadable" : "read", ...(mode === "partial" && i === 2 ? { reason: "image-only" } : {}) })),
    producer: "test.synthetic@1",
  };
}

export function provisionContent(kind: ProvisionKind, page: number, line: string, extra: Partial<ProvisionContent> = {}): ProvisionContent {
  return {
    sessionId: M7D_SESSION,
    documentId: M7D_DOC,
    documentSha256: sha256Hex(BYTES),
    kind,
    claim: line,
    plan: { planId: "plan-sample", name: "Sample Care Bronze", nameSpan: span(1, "Plan name: Sample Care Bronze") },
    scope: {},
    evidence: [{ documentId: M7D_DOC, page, quote: line }],
    ...extra,
  };
}

/** Registry + store + authority for one request, with the given sealed
 *  provisions admitted. Defaults: both benefit lines and every exclusion line. */
export function exclusionScenario(options: {
  coverage?: CoverageMode;
  pages?: readonly string[];
  provisions?: ProvisionContent[];
} = {}) {
  const pages = options.pages ?? M7D_PAGES;
  const authority = new EvidenceAuthority();
  const mode = options.coverage ?? "complete";
  const registry = new SessionDocumentRegistry(M7D_SESSION, { coverageSource: { coverageFor: () => coverage(mode) } });
  const reg = registry.register({
    sessionId: M7D_SESSION,
    documentId: M7D_DOC,
    bytes: BYTES,
    pages,
    plan: {
      planId: "plan-sample",
      name: { value: "Sample Care Bronze", span: span(1, "Plan name: Sample Care Bronze") },
      period: { start: "2026-01-01", end: "2026-12-31", span: span(1, "Plan year: January 1, 2026 through December 31, 2026") },
    },
  });
  if (!reg.ok) throw new Error(`fixture registration refused: ${reg.reason}`);
  const store = new ProvisionStore(M7D_SESSION, registry, authority);
  const contents = options.provisions ?? [
    provisionContent("benefit", 2, "Acupuncture visits: $25 copay."),
    provisionContent("benefit", 2, "Chiropractic visits: $30 copay."),
    provisionContent("exclusion", 3, "Acupuncture is not covered."),
    provisionContent("exclusion", 3, "Cosmetic surgery is not covered."),
  ];
  for (const c of contents) {
    const res = store.accept(sealProvision(authority, c));
    if (!res.ok) throw new Error(`fixture provision refused: ${res.reason}`);
  }
  return { authority, registry, store, sessionId: M7D_SESSION, documentId: M7D_DOC };
}
