// Session document registry (evidence-core.md §4).
//
// Holds, for ONE session, each document's identity: sha256 of the registered
// bytes, page count, the stored page texts verification reads, an optional
// verified plan identity whose every field is bound to an exact source span,
// and an optional page-coverage record. Request-scoped: build it from the
// authorized session's durable documents; never keep it in a module global.
//
// Fail closed: a registration that does not prove itself stores nothing.

import { deepFreeze, sha256Hex } from "@/app/lib/evidence/canonical";
import {
  checkCoverageRecord,
  type PageCoverageEntry,
  type PageCoverageRecord,
  type PageCoverageSource,
} from "@/app/lib/evidence/page-coverage";
import { readabilityFor, type PageReadability } from "@/app/lib/pdf/page-readability";
import { literallyStates, spanIsBound, type SourceSpan } from "@/app/lib/evidence/source-span";

/** A plan-identity field and the exact span that states it. */
export interface BoundField {
  value: string;
  span: SourceSpan;
}

/** ISO calendar dates (YYYY-MM-DD), inclusive, bound to a source span. */
export interface BoundPeriod {
  start: string;
  end: string;
  span: SourceSpan;
}

export interface VerifiedPlanIdentity {
  planId: string;
  name: BoundField;
  issuer?: BoundField;
  policyNumber?: BoundField;
  period?: BoundPeriod;
}

export interface RegisteredDocument {
  readonly sessionId: string;
  readonly documentId: string;
  /** Hex sha256 of the registered original bytes. */
  readonly sha256: string;
  readonly pageCount: number;
  /** Stored page texts (index 0 = page 1); the only text verification reads. */
  readonly pages: readonly string[];
  readonly plan?: Readonly<VerifiedPlanIdentity>;
  readonly coverage?: Readonly<PageCoverageRecord>;
}

export interface DocumentRegistration {
  sessionId: string;
  documentId: string;
  /** Original bytes (sha256 computed here) and/or the stored sha256 from the
   *  durable documents row. When both are given they must agree. */
  bytes?: Uint8Array;
  sha256?: string;
  pages: readonly string[];
  plan?: VerifiedPlanIdentity;
}

export type RegistrationResult =
  | { ok: true; document: RegisteredDocument }
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(s: string): boolean {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Check a plan identity against the document's stored pages. Every field
 *  must sit on an exact span of this document that literally states it; a
 *  period additionally needs valid ordered dates whose years appear in its
 *  span. */
export function checkPlanIdentity(
  doc: { documentId: string; pageCount: number; pages: readonly string[] },
  plan: VerifiedPlanIdentity,
): { ok: true } | { ok: false; reason: string } {
  if (!plan || typeof plan.planId !== "string" || !plan.planId.trim()) return { ok: false, reason: "planId required" };
  const fields: [string, BoundField | undefined][] = [
    ["name", plan.name],
    ["issuer", plan.issuer],
    ["policyNumber", plan.policyNumber],
  ];
  if (!plan.name) return { ok: false, reason: "plan name required" };
  for (const [key, field] of fields) {
    if (field === undefined) continue;
    if (typeof field.value !== "string" || !field.value.trim()) return { ok: false, reason: `${key} empty` };
    if (!spanIsBound(doc, field.span)) return { ok: false, reason: `${key} not bound to a source span` };
    if (!literallyStates(field.span.text, field.value)) return { ok: false, reason: `${key} not stated by its span` };
  }
  if (plan.period) {
    const { start, end, span } = plan.period;
    if (!validIsoDate(start) || !validIsoDate(end) || start > end) return { ok: false, reason: "period invalid" };
    if (!spanIsBound(doc, span)) return { ok: false, reason: "period not bound to a source span" };
    if (!span.text.includes(start.slice(0, 4)) || !span.text.includes(end.slice(0, 4))) {
      return { ok: false, reason: "period not stated by its span" };
    }
  }
  return { ok: true };
}

export class SessionDocumentRegistry {
  readonly sessionId: string;
  readonly #documents = new Map<string, RegisteredDocument>();
  readonly #coverageSource?: PageCoverageSource;

  constructor(sessionId: string, options: { coverageSource?: PageCoverageSource } = {}) {
    if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("SessionDocumentRegistry: sessionId required");
    this.sessionId = sessionId;
    this.#coverageSource = options.coverageSource;
  }

  /** Register one document of THIS session. Refuses (and stores nothing)
   *  on a foreign session, a duplicate id, a missing/mismatched sha256, or a
   *  plan identity / coverage record that does not verify. */
  register(input: DocumentRegistration): RegistrationResult {
    if (!input || input.sessionId !== this.sessionId) return { ok: false, reason: "session mismatch" };
    if (typeof input.documentId !== "string" || !input.documentId.trim()) return { ok: false, reason: "documentId required" };
    if (this.#documents.has(input.documentId)) return { ok: false, reason: "already registered" };
    const computed = input.bytes ? sha256Hex(input.bytes) : undefined;
    const declared = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : undefined;
    if (declared !== undefined && !/^[0-9a-f]{64}$/.test(declared)) return { ok: false, reason: "sha256 malformed" };
    if (computed && declared && computed !== declared) return { ok: false, reason: "sha256 does not match bytes" };
    const sha256 = computed ?? declared;
    if (!sha256) return { ok: false, reason: "sha256 or bytes required" };
    if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.some((p) => typeof p !== "string")) {
      return { ok: false, reason: "pages required" };
    }
    const pages = Object.freeze([...input.pages]);
    const base = { documentId: input.documentId, pageCount: pages.length, pages };
    let plan: VerifiedPlanIdentity | undefined;
    if (input.plan !== undefined) {
      const check = checkPlanIdentity(base, input.plan);
      if (!check.ok) return check;
      plan = structuredClone(input.plan);
    }
    let coverage: PageCoverageRecord | undefined;
    if (this.#coverageSource) {
      coverage = this.#coverageSource.coverageFor({
        sessionId: this.sessionId, documentId: input.documentId, documentSha256: sha256, pageCount: pages.length, pages,
      });
      if (coverage !== undefined) {
        const check = checkCoverageRecord(coverage, { sessionId: this.sessionId, sha256, ...base });
        if (!check.ok) return { ok: false, reason: `coverage: ${check.reason}` };
        coverage = structuredClone(coverage);
      }
    }
    const document: RegisteredDocument = deepFreeze({
      sessionId: this.sessionId,
      ...base,
      sha256,
      ...(plan ? { plan } : {}),
      ...(coverage ? { coverage } : {}),
    });
    this.#documents.set(document.documentId, document);
    return { ok: true, document };
  }

  get(documentId: string): RegisteredDocument | undefined {
    return this.#documents.get(documentId);
  }

  list(): RegisteredDocument[] {
    return [...this.#documents.values()];
  }

  verifiedPlan(documentId: string): Readonly<VerifiedPlanIdentity> | undefined {
    return this.#documents.get(documentId)?.plan;
  }

  /** Page coverage for the document version; undefined = unknown. */
  coverage(documentId: string): Readonly<PageCoverageRecord> | undefined {
    return this.#documents.get(documentId)?.coverage;
  }
}

export const READABILITY_COVERAGE_PRODUCER = "ingestion.page-readability@1";

/** PageCoverageSource adapter over the per-page readability record
 *  (pdf/page-readability.ts, session document `readability`). The record is
 *  first validated against the stored page text (`readabilityFor`: an
 *  inconsistent or missing record is re-derived from the text). Mapping:
 *  read → read; partly-unreadable → unreadable (partly read is never fully
 *  read); unreadable → unreadable; empty → not_read. So "complete" is
 *  possible only when every page was read. A document whose stored pages
 *  differ from the registered ones gets no record (unknown). */
export function readabilityCoverageSource(
  documents: readonly { documentId: string; pages: readonly string[]; readability?: readonly PageReadability[] }[],
): PageCoverageSource {
  return {
    coverageFor(input) {
      const doc = documents.find((d) => d.documentId === input.documentId);
      if (!doc || doc.pages.length !== input.pageCount || doc.pages.some((p, i) => p !== input.pages[i])) return undefined;
      const records = readabilityFor({ pages: doc.pages, readability: doc.readability ? [...doc.readability] : undefined });
      const pages: PageCoverageEntry[] = records.map((r) =>
        r.status === "read"
          ? { page: r.page, status: "read" }
          : r.status === "empty"
            ? { page: r.page, status: "not_read", reason: "no-text" }
            : { page: r.page, status: "unreadable", reason: r.status === "partly-unreadable" ? "partly-read" : "image-only" });
      return {
        sessionId: input.sessionId,
        documentId: input.documentId,
        documentSha256: input.documentSha256,
        pageCount: input.pageCount,
        pages,
        producer: READABILITY_COVERAGE_PRODUCER,
      };
    },
  };
}
