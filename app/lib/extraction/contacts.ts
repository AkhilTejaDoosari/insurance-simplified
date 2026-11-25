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

const FINANCIAL_RATING_DOMAINS = new Set([
  "standardandpoors.com",
  "spglobal.com",
  "ambest.com",
  "fitchratings.com",
  "fitch.com",
  "moodys.com",
  "moody's.com",
  "weissratings.com",
  "demotech.com",
  "kroll.com",
]);

/** Phone-adjacent ID language: policy/member/account identifiers, never dialable. */
const PHONE_ID_WORDS = /\b(policy|member|account|cert(ificate)?|form|code|number|id)\b/i;
/** Explicit dialing context: somebody is asked to call. */
const PHONE_CONTEXT_WORDS =
  /\b(phone|tel|call|contact|fax|support|claims|emergency|operator|administrator|service|help|assistance)\b|24\/7/i;
const STRICT_PHONE_SHAPE = /^(?:\+?1[-.\s]?)?(\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}$/;

/** A phone candidate is plausible only when it is not embedded in a longer
 *  token, not labeled as an identifier, and either strictly formatted or
 *  accompanied by explicit dialing context. */
function isPlausiblePhone(line: string, match: string, at: number): boolean {
  const before = line[at - 1] ?? " ";
  const after = line[at + match.length] ?? " ";
  if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) return false;
  const window = line.slice(Math.max(0, at - 40), at + match.length + 40);
  // "Member Services" is who answers, not a member number.
  if (PHONE_ID_WORDS.test(window.replace(/\bmember services?\b/gi, " "))) return false;
  if (STRICT_PHONE_SHAPE.test(match.trim())) return true;
  return PHONE_CONTEXT_WORDS.test(window);
}

/** Federal agencies whose contacts are printed in every SBC. They are not the
 *  plan's contacts. */
const FEDERAL_DOMAINS = ["healthcare.gov", "dol.gov", "cms.gov", "hhs.gov"];
const FEDERAL_PHONES = new Set(["8003182596", "8664443272", "8772672323", "8664872365", "8003681019", "8005377697"]);
const isFederalHost = (host: string) => FEDERAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

/** Purpose label from explicit source wording ("Emergency assistance: …"). */
const PURPOSE_RE = /(?:^|[^A-Za-z &'/-])\s*([A-Za-z][A-Za-z &'/-]{1,32}?)\s*:\s*$/;
/** A cut sentence, not a label ("or Canada:", "… is available at:"). */
const NOT_A_LABEL = /^(?:or|and|at|in|the|is|are|to|of|for|call|see|visit|this)\b|\b(?:at|is|are|or|and|to|of|see|this)$/i;

/** Who or what a contact is for, in the document's own words. */
const PURPOSE_PHRASE =
  /\b(?:plan administrator|claims? administrator|member services?|customer (?:service|care)|participant services?|nurse ?line|emergency assistance|travel assistance|pre-?certification|pre-?authorization|prescription drug coverage|pharmacy|network providers|provider directory|claims|appeals|eligibility|enrollment|billing)\b/gi;

const CONTACT_RE = new RegExp(`${EMAIL_RE.source}|${PHONE_RE.source}|${WEBSITE_RE.source}`, "gi");

/** The single purpose named in the contact's own sentence, between the
 *  neighbouring contacts; none or several ⇒ no label. */
function purposeIn(lines: readonly string[], index: number, ownAt: number, length: number): string | null {
  const { text: line, at } = withSentence(lines, index, ownAt);
  // A relay or fax line is that, whatever the sentence is about.
  const relay = /\b(TTY|TDD|Fax)(?:\s+number)?\s*:?\s*$/i.exec(line.slice(0, at))?.[1];
  if (relay) return relay;
  if (/^\s*\((?:TTY|TDD)\)/i.test(line.slice(at + length))) return "TTY";
  const colon = PURPOSE_RE.exec(line.slice(0, at))?.[1].trim();
  if (colon && !NOT_A_LABEL.test(colon)) return colon;
  let from = 0;
  let to = line.length;
  for (const m of line.matchAll(CONTACT_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end <= at) from = Math.max(from, end);
    else if ((m.index ?? 0) >= at + length) { to = Math.min(to, m.index ?? 0); break; }
  }
  // "1-800-… Claims": the words after a contact may be its label; then words
  // before the next one belong to the previous contact.
  const afterOwn = line.slice(at + length, to);
  if (from > 0 && !/[,;.]\s*\S/.test(line.slice(from, at)) && !/\bor\b|\band\b/i.test(line.slice(from, at))) return null;
  if (new RegExp(`^\\s*[-–]?\\s*(?:${PURPOSE_PHRASE.source})`, "i").test(afterOwn)) return null;
  const before = line.slice(from, at).split(/[.;!?]\s/).pop() ?? "";
  const after = (line.slice(at + length, to).split(/[.;!?](?:\s|$)/)[0] ?? "");
  // Text after a contact belongs to it only as its own purpose clause.
  const clause = /^\s*(?:\([^)]*\)\s*)?for\b/i.test(after) ? after : "";
  if (/\b(?:not|no|never|except|other than)\b|n['’]t\b/i.test(`${before} ${clause}`)) return null;
  const found = new Set([...`${before} ¦ ${clause}`.matchAll(PURPOSE_PHRASE)].map((m) => m[0]));
  return found.size === 1 ? [...found][0] : null;
}

/** A line with the sentence it continues: the lines above only while the
 *  contact's own text starts in mid-sentence (lower case) or the line above
 *  ends in mid-phrase ("available at"), never across another contact; and the
 *  line below when it continues in lower case. */
function withSentence(lines: readonly string[], index: number, at: number): { text: string; at: number } {
  let text = lines[index];
  let shift = 0;
  for (let k = index - 1; k >= 0 && index - k <= 3; k--) {
    const open = text.slice(0, at + shift).trim();
    const above = lines[k];
    if (!above || /[.:;!?]$/.test(above) || [...above.matchAll(CONTACT_RE)].length > 0) break;
    const dangling = /\b(?:at|call|visit|see|or|to|is)$/i.test(above);
    if (!(/^[a-z]/.test(open) || (!open && dangling))) break;
    // A short capitalised line is a heading, not the start of a sentence.
    if (/^[A-Z]/.test(above) && above.split(/\s+/).length <= 3) break;
    text = `${above} ${text}`;
    shift += above.length + 1;
  }
  const next = lines[index + 1] ?? "";
  return { text: /^[a-z]/.test(next) ? `${text} ${next}` : text, at: at + shift };
}

/** A web address that runs to the line end and continues on the next line. */
function cutAtLineEnd(line: string, end: number, value: string, next: string): boolean {
  if (line.slice(end).trim()) return false;
  if (/[-/_]$/.test(value) && /-$/.test(value)) return true;
  return /\/[^/]+$/.test(value.replace(/^https?:\/\//i, "")) && /^[a-z0-9%_-]*[-/][a-z0-9%/_-]*/.test(next) && !/^(?:and|or)\//.test(next);
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
      const lines = pageText.split(/\n+/).map((l) => l.trim());
      for (const [lineIndex, text] of lines.entries()) {
        if (!text) continue;
        for (const m of text.matchAll(EMAIL_RE)) {
          hits.push({
            kind: "email",
            value: m[0],
            purpose: purposeIn(lines, lineIndex, m.index ?? 0, m[0].length),
            documentId: doc.documentId,
            filename: doc.filename,
            page,
            quote: text,
          });
        }
        for (const m of text.matchAll(PHONE_RE)) {
          const candidate = m[0].trim();
          if (!isPlausiblePhone(text, m[0], m.index ?? 0)) continue;
          if (FEDERAL_PHONES.has(normalizeContactValue("phone", candidate))) continue;
          hits.push({
            kind: "phone",
            value: candidate,
            purpose: purposeIn(lines, lineIndex, m.index ?? 0, m[0].length),
            documentId: doc.documentId,
            filename: doc.filename,
            page,
            quote: text,
          });
        }
        for (const m of text.matchAll(WEBSITE_RE)) {
          const value = cleanWebsite(m[0]);
          if (!value) continue;
          const hostname = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
          if (FINANCIAL_RATING_DOMAINS.has(hostname) || isFederalHost(hostname)) continue;
          if (cutAtLineEnd(text, (m.index ?? 0) + m[0].length, m[0], lines[lineIndex + 1] ?? "")) continue;
          hits.push({
            kind: "website",
            value,
            purpose: purposeIn(lines, lineIndex, m.index ?? 0, m[0].length),
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
      // An unlabelled contact takes a purpose stated elsewhere in the document;
      // several different purposes leave it as it was first labelled.
      if (existing.label === KIND_LABEL[hit.kind] && hit.purpose) existing.label = hit.purpose;
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
