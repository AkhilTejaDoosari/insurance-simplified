// SBC cost-chart rows ("Common Medical Event" chart), read whole.
//
// The form fixes the service labels, their order inside a row (label, network
// cost, out-of-network cost, limitations) and one limitation sentence that
// every SBC prints and that always wraps. Page text is read only when that
// sentence and a wrapping label are contiguous, i.e. when the PDF's text runs
// cell by cell. A row is then the text from its own label to the next form
// label, shown verbatim with nothing removed; no cell is taken apart, so no
// cost can be moved to another column. A row without any limitation text of
// its own may be governed by a merged cell and is not read.

import type { CellValue, EvidenceCitation } from "@/app/lib/extraction/types";
import { isSbcDocument, readsCellByCell } from "@/app/lib/extraction/sbc";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";

interface SbcDocument { documentId: string; pageCount?: number; pages: readonly string[] }
interface SbcClaim { factName: string; value: CellValue }

const label = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+").replace(/-/g, "[-‐‑–]\\s*").replace(/\//g, "\\s*/\\s*").replace(/'/g, "['’]");

/** Every service label of the form, with the facts its row states. */
const LABELS: readonly { text: string; facts: readonly string[] }[] = [
  { text: "Primary care visit to treat an injury or illness", facts: ["primary-care-visit", "coinsurance"] },
  { text: "Specialist visit", facts: ["specialist-visit", "coinsurance"] },
  { text: "Preventive care/screening/immunization", facts: ["preventive-care"] },
  { text: "Diagnostic test (x-ray, blood work)", facts: ["lab-and-imaging"] },
  { text: "Imaging (CT/PET scans, MRIs)", facts: ["lab-and-imaging"] },
  { text: "Facility fee (e.g., ambulatory surgery center)", facts: ["surgery"] },
  { text: "Physician/surgeon fees", facts: [] },
  { text: "Emergency room care", facts: ["emergency-care"] },
  { text: "Emergency room services", facts: ["emergency-care"] },
  { text: "Emergency medical transportation", facts: ["ambulance"] },
  { text: "Urgent care", facts: ["urgent-care"] },
  { text: "Facility fee (e.g., hospital room)", facts: ["hospitalization", "coinsurance"] },
  { text: "Outpatient services", facts: ["mental-health"] },
  { text: "Inpatient services", facts: ["mental-health"] },
  { text: "Office visits", facts: ["maternity-coverage"] },
  { text: "Childbirth/delivery professional services", facts: ["maternity-coverage"] },
  { text: "Childbirth/delivery facility services", facts: ["maternity-coverage"] },
  { text: "Home health care", facts: ["home-nursing"] },
  { text: "Rehabilitation services", facts: [] },
  { text: "Habilitation services", facts: [] },
  { text: "Habilitative services", facts: [] },
  { text: "Skilled nursing care", facts: [] },
  { text: "Durable medical equipment", facts: ["durable-medical-equipment"] },
  { text: "Hospice services", facts: [] },
  { text: "Children's eye exam", facts: ["vision-coverage"] },
  { text: "Children's glasses", facts: ["vision-coverage"] },
  { text: "Children's dental check-up", facts: ["dental-coverage"] },
];
/** Text that ends a row without being a service label. */
const BOUNDARY = "If\\s+you\\s+(?:visit|have|need|are)\\b|If\\s+your\\s+child\\b|Excluded\\s+Services|Common\\s+Medical|\\*\\s*For\\s+more\\s+information|Page\\s+\\d+\\s+of\\s+\\d+|Your\\s+Rights\\s+to\\b|Generic\\s+drugs|(?:Non-?)?Preferred\\s+(?:brand|generic)|Specialty\\s+drugs|Tier\\s+\\d+\\b(?=[^\\n]*\\n)";
const START = `(?<=^|\\n[ \\t]*)`;
const ANY_LABEL = new RegExp(`${START}(?:${LABELS.map((l) => `(${label(l.text)})`).join("|")}|${BOUNDARY})`, "gi");
const BAD_FOLLOWING = /^[ \t]*[,.;:)]/;
const COST_START = /^[\s*]*(?:\$\s?\d|\d+\s*%|no charge\b|not covered\b|deductible\b|outpatient:|inpatient:|office|retail|facility|first\b)/i;
const COST_WORDS =
  /\$\s?[\d,.]+|\d+\s*%|\b(?:coinsurance|copay(?:ment)?s?|no|charge|not|covered|and|or|of|the|after|per|deductible|does|do|apply|applies|visit|trip|test|prescription|admission|day|stay|facility|physician|professional|outpatient|inpatient|office|service|services|birthing|center|hospital|x-?\s?rays?|blood work)\b|[\s/*().,;:+]/gi;
const COST = /\$\s?\d|\d\s*%|\bno charge\b|\bnot covered\b/gi;
const CHART_NOTE =
  /All copayment and coinsurance costs shown in this chart are after your deductible has been met, if a deductible applies\./;
const HEADINGS = /([A-Z][A-Za-z‐‑–-]*(?:\s+[A-Za-z‐‑–-]+){0,3}?)\s*\(You\s+will\s+pay\s+the\s+least\)\s*([A-Z][A-Za-z‐‑–\s-]{2,40}?)\s*\(You\s+will\s+pay\s+the\s+most\)/;
const MAX_ROW = 600;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function cite(doc: SbcDocument, page: number, quote: string): EvidenceCitation | undefined {
  const verified = verifyEvidenceCitation(
    [{ documentId: doc.documentId, pageCount: doc.pageCount ?? doc.pages.length, pages: [...doc.pages] }],
    { documentId: doc.documentId, page, quote },
  );
  return verified.ok ? { documentId: doc.documentId, page, quote: verified.quote } : undefined;
}

/** Exactly two cost columns, in the form's order. */
function columns(page: string): string | undefined {
  const m = HEADINGS.exec(page);
  if (!m || (page.match(/\(You\s+will\s+pay\s+the\s+most\)/g) ?? []).length !== 1) return undefined;
  if (/\btier\b|\bprovider\b[\s\S]*\bprovider\b/i.test(m[2])) return undefined;
  return "network provider, then out-of-network provider";
}

export function sbcChartClaims(doc: SbcDocument): SbcClaim[] {
  if (!isSbcDocument(doc.pages) || !readsCellByCell(doc.pages)) return [];
  let note: EvidenceCitation | undefined;
  doc.pages.forEach((page, i) => {
    const m = CHART_NOTE.exec(squash(page));
    if (m && !note) note = cite(doc, i + 1, m[0]);
  });
  const out: SbcClaim[] = [];
  doc.pages.forEach((page, i) => {
    if (!columns(page)) return;
    const marks = [...page.matchAll(ANY_LABEL)].filter((m) => !BAD_FOLLOWING.test(page.slice((m.index ?? 0) + m[0].length)));
    marks.forEach((m, k) => {
      const which = LABELS.findIndex((_, n) => m[n + 1] !== undefined);
      const facts = which >= 0 ? LABELS[which].facts : [];
      // The last row of a page may continue on the next one.
      const next = marks[k + 1];
      if (facts.length === 0 || !next) return;
      const start = m.index ?? 0;
      const raw = page.slice(start, next.index ?? 0).trimEnd();
      const body = raw.slice(m[0].length);
      if (raw.length > MAX_ROW || !COST_START.test(body) || (body.match(COST) ?? []).length < 2) return;
      // Own limitation text, or it may be governed by a merged cell.
      if (!/[A-Za-z]{3}/.test(body.replace(COST_WORDS, " "))) return;
      const row = cite(doc, i + 1, raw);
      if (!row) return;
      const text = `${squash(m[0])} — you pay, in the form's column order (network provider, then out-of-network provider), then limitations: ${squash(body)}`;
      const carriesNote = note && /copay|coinsurance/i.test(body);
      for (const factName of facts) {
        if (factName === "coinsurance" && !/\d\s*%\s*coinsurance/i.test(body)) continue;
        out.push({
          factName,
          value: {
            documentId: doc.documentId,
            display: carriesNote ? `${text}\n${squash(note!.quote)}` : text,
            qualifiers: {},
            evidence: carriesNote ? [row, note!] : [row],
            anchor: { kind: "statement", page: i + 1, start, end: start + raw.length },
          },
        });
      }
    });
  });
  // A label printed twice (two SBCs, or another table) proves neither row.
  const seen = new Map<string, Set<string>>();
  for (const c of out) {
    const key = `${c.factName}|${c.value.display.split(" — ")[0].toLowerCase().replace(/\s+/g, "")}`;
    (seen.get(key) ?? seen.set(key, new Set()).get(key)!).add(`${c.value.anchor!.page}:${(c.value.anchor as { start: number }).start}`);
  }
  return out.filter((c) => seen.get(`${c.factName}|${c.value.display.split(" — ")[0].toLowerCase().replace(/\s+/g, "")}`)!.size === 1);
}
