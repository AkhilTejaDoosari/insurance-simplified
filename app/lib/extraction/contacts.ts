// Plan contact extraction from uploaded document text. Email, phone, and
// website only — never postal addresses, never external lookup, never
// invented. Every hit keeps its source document, page, and quote.

export type ContactKind = "email" | "phone" | "website";

export interface ContactHit {
  kind: ContactKind;
  /** Human-readable value as shown (never an implementation detail). */
  value: string;
  /** Source-provided purpose ("Emergency assistance") or null for a plain label. */
  purpose: string | null;
  documentId: string;
  filename: string;
  page: number;
  quote: string;
}

export interface ContactEvidence {
  documentId: string;
  filename: string;
  page: number;
  quote: string;
  evidenceId?: string;
}

export interface PlanContact {
  kind: ContactKind;
  value: string;
  label: string;
  evidence: ContactEvidence[];
}

export interface PlanContactCard {
  planName: string;
  documentIds: string[];
  contacts: PlanContact[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const WEBSITE_RE = /https?:\/\/[^\s),;"]+|www\.[^\s),;"]+/gi;

/** Purpose label from explicit source wording ("Emergency assistance: …"). */
const PURPOSE_RE = /([A-Za-z][A-Za-z &'/-]{1,32}?)\s*:\s*$/;

function purposeBefore(line: string, at: number): string | null {
  const match = PURPOSE_RE.exec(line.slice(0, at));
  return match ? match[1].trim() : null;
}

function cleanWebsite(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "").trim();
}

export interface ContactSourceDocument {
  documentId: string;
  filename: string;
  pages: string[];
}

/** Scan uploaded document pages for contact candidates with provenance. */
export function extractContacts(documents: ContactSourceDocument[]): ContactHit[] {
  const hits: ContactHit[] = [];
  for (const doc of documents) {
    doc.pages.forEach((pageText, index) => {
      const page = index + 1;
      for (const line of pageText.split(/\n+/)) {
        const text = line.trim();
        if (!text) continue;
        for (const m of text.matchAll(EMAIL_RE)) {
          hits.push({
            kind: "email",
            value: m[0],
            purpose: purposeBefore(text, m.index ?? 0),
            documentId: doc.documentId,
            filename: doc.filename,
            page,
            quote: text,
          });
        }
        for (const m of text.matchAll(PHONE_RE)) {
          hits.push({
            kind: "phone",
            value: m[0].trim(),
            purpose: purposeBefore(text, m.index ?? 0),
            documentId: doc.documentId,
            filename: doc.filename,
            page,
            quote: text,
          });
        }
        for (const m of text.matchAll(WEBSITE_RE)) {
          const value = cleanWebsite(m[0]);
          if (!value) continue;
          hits.push({
            kind: "website",
            value,
            purpose: purposeBefore(text, m.index ?? 0),
            documentId: doc.documentId,
            filename: doc.filename,
            page,
            quote: text,
          });
        }
      }
    });
  }
  return hits;
}

/** Dedup identity per kind: case-insensitive email/site, digits-only phone. */
export function normalizeContactValue(kind: ContactKind, value: string): string {
  if (kind === "phone") {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  }
  return value.toLowerCase();
}

const KIND_LABEL: Record<ContactKind, string> = {
  email: "Email",
  phone: "Phone",
  website: "Website",
};

/** Group hits into per-plan cards; same value deduped, evidence preserved. */
export function groupContactsByPlan(
  hits: ContactHit[],
  planNameOf: (documentId: string) => string,
): PlanContactCard[] {
  const cards = new Map<string, PlanContactCard>();
  const cardFor = (documentId: string): PlanContactCard => {
    const planName = planNameOf(documentId);
    let card = cards.get(planName);
    if (!card) {
      card = { planName, documentIds: [], contacts: [] };
      cards.set(planName, card);
    }
    if (!card.documentIds.includes(documentId)) card.documentIds.push(documentId);
    return card;
  };
  for (const hit of hits) {
    const card = cardFor(hit.documentId);
    const key = `${hit.kind}:${normalizeContactValue(hit.kind, hit.value)}`;
    const existing = card.contacts.find(
      (c) => `${c.kind}:${normalizeContactValue(c.kind, c.value)}` === key,
    );
    const evidence: ContactEvidence = {
      documentId: hit.documentId,
      filename: hit.filename,
      page: hit.page,
      quote: hit.quote,
    };
    if (existing) {
      if (
        !existing.evidence.some(
          (e) => e.documentId === evidence.documentId && e.page === evidence.page && e.quote === evidence.quote,
        )
      ) {
        existing.evidence.push(evidence);
      }
      continue;
    }
    card.contacts.push({
      kind: hit.kind,
      value: hit.value,
      label: hit.purpose ?? KIND_LABEL[hit.kind],
      evidence: [evidence],
    });
  }
  return [...cards.values()];
}

/** Safe interactive target, or null when the value must render as plain text. */
export function contactHref(kind: ContactKind, value: string): string | null {
  if (kind === "email") {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
      ? `mailto:${value}`
      : null;
  }
  if (kind === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7) return null;
    const normalized = digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+${digits}`;
    return `tel:${normalized}`;
  }
  if (/^https?:\/\//i.test(value)) return value;
  if (/^www\./i.test(value)) return `https://${value}`;
  return null;
}
