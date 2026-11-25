// SBC cost-chart rows ("Common Medical Event" chart).
//
// The form fixes the service labels, their order, the event captions and the
// order of the cells in a row (label, network cost, out-of-network cost,
// limitations). A row is read only when ALL of this holds, else not at all:
//   - the PDF's text runs cell by cell (readsCellByCell, and the form's first
//     label, which always wraps, is contiguous);
//   - the page prints exactly two cost headings, a network and an
//     out-of-network provider heading; they are shown verbatim;
//   - the label stands in the form's own sequence: the mark before it and the
//     mark after it are its neighbours in the form, on the same page;
//   - the text after the label is two COMPLETE cost cells of a closed grammar,
//     then the row's own limitation: "None", a preauthorization note, or whole
//     sentences that contain no cost (another row, or a moved cell, would).

import type { CellValue, EvidenceCitation } from "@/app/lib/extraction/types";
import { coverageExampleSpans, isSbcDocument, readsCellByCell } from "@/app/lib/extraction/sbc";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";

interface SbcDocument { documentId: string; pageCount?: number; pages: readonly string[] }
interface SbcClaim { factName: string; value: CellValue }

const label = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+").replace(/-/g, "[-‐‑–]\\s*").replace(/\//g, "\\s*/\\s*").replace(/'/g, "['’]");

interface Mark { text: string; facts?: readonly string[]; optional?: boolean }

/** The chart in the form's order: event captions (no facts) and labels. Drug
 *  rows have plan-specific labels and are not modelled. */
const FORM: readonly Mark[] = [
  { text: "If you visit a health care provider's office or clinic" },
  { text: "Primary care visit to treat an injury or illness", facts: ["primary-care-visit", "coinsurance"] },
  { text: "Specialist visit", facts: ["specialist-visit", "coinsurance"] },
  { text: "Preventive care/screening/immunization", facts: ["preventive-care"] },
  { text: "If you have a test" },
  { text: "Diagnostic test (x-ray, blood work)", facts: ["lab-and-imaging"] },
  { text: "Imaging (CT/PET scans, MRIs)", facts: ["lab-and-imaging"] },
  { text: "If you need drugs to treat your illness or condition" },
  { text: "If you have outpatient surgery" },
  { text: "Facility fee (e.g., ambulatory surgery center)", facts: ["surgery"] },
  { text: "Physician/surgeon fees", facts: [] },
  { text: "If you need immediate medical attention" },
  { text: "Emergency room care", facts: ["emergency-care"] },
  { text: "Emergency medical transportation", facts: ["ambulance"] },
  { text: "Urgent care", facts: ["urgent-care"] },
  { text: "If you have a hospital stay" },
  { text: "Facility fee (e.g., hospital room)", facts: ["hospitalization", "coinsurance"] },
  { text: "Physician/surgeon fees", facts: [] },
  { text: "If you need mental health, behavioral health, or substance abuse services" },
  { text: "Outpatient services", facts: ["mental-health"] },
  { text: "Inpatient services", facts: ["mental-health"] },
  { text: "If you are pregnant" },
  { text: "Office visits", facts: ["maternity-coverage"] },
  { text: "Childbirth/delivery professional services", facts: ["maternity-coverage"] },
  { text: "Childbirth/delivery facility services", facts: ["maternity-coverage"] },
  { text: "If you need help recovering or have other special health needs" },
  { text: "Home health care", facts: ["home-nursing"] },
  { text: "Rehabilitation services", facts: [] },
  { text: "Habilitation services", facts: [] },
  { text: "Skilled nursing care", facts: [] },
  { text: "Durable medical equipment", facts: ["durable-medical-equipment"] },
  { text: "Hospice services", facts: [] },
  { text: "If your child needs dental or eye care" },
  { text: "Children's eye exam", facts: ["vision-coverage"] },
  { text: "Children's glasses", facts: ["vision-coverage"] },
  { text: "Children's dental check-up", facts: ["dental-coverage"] },
  { text: "Excluded Services & Other Covered Services" },
];
const UNIQUE = [...new Set(FORM.map((m) => m.text))];
/** Labels match anywhere at a line start, case-insensitively, so that a stray
 *  mention breaks the sequence instead of being ignored. */
const ANY = new RegExp(`(?<=^|\\n[ \\t]*)(?:${UNIQUE.map((t) => `(${label(t)})`).join("|")})`, "gi");

const AMOUNT = "\\$\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?";
const PER = "(?:\\s*/\\s*(?:visit|trip|test|prescription|admission|day|stay|service|procedure)|\\s+per\\s+(?:visit|trip|test|admission|day|stay|service|procedure))?";
const SHARE = `\\d{1,3}%\\s+coinsurance${PER}`;
const COPAY = `${AMOUNT}\\s+copay(?:ment)?${PER}`;
const DEDUCTIBLE = "(?:\\s*[,;]\\s*(?:the\\s+)?deductible\\s+(?:does\\s+not|doesn['’]t)\\s+apply\\.?)?";
/** One complete cost cell; a marker before it belongs to it. */
const CELL = `\\*?(?:${COPAY}\\s+(?:and|plus|then)\\s+${SHARE}|${COPAY}|${SHARE}|No\\s+charge|Not\\s+covered)${DEDUCTIBLE}`;
const ROW = new RegExp(`^\\s+(${CELL})\\s+(${CELL})\\s+(\\S[\\s\\S]*)$`, "i");
/** Cost wording inside a limitation: another row or another cell. The bare
 *  word "copay" is not a cost ("Copay waived if admitted."). */
const COST_IN_TEXT = /\$|%|\bcoinsurance\b|\bno charge\b|\bnot covered\b|\bdeductible (?:does not|doesn['’]t) apply\b/i;
/** A limitation opening with a cost condition belongs to a cost cell; "None"
 *  followed by more text is two cells. */
const CELL_CONDITION = /^\*?\s*(?:after|before|deductible|up to|then|per|plus|and|or|waived|none\b.*\S\s*\S)\b/i;
const NO_LIMIT = /^none\.?$/i;
const PREAUTH = /^(?:preauthorization|prior authorization)(?: is)? required\.?$/i;
const SENTENCES = /^[*A-Z][\s\S]*\.$/;

const CHART_NOTE =
  /All\s+copayment\s+and\s+coinsurance\s+costs\s+shown\s+in\s+this\s+chart\s+are\s+after\s+your\s+deductible\s+has\s+been\s+met,\s+if\s+a\s+deductible\s+applies\./;
const HEADINGS =
  /(?:Information|Will\s+Pay)\s*((?:In[-‐‑–]\s*)?Network\s+Provider|Preferred\s+Provider|Participating\s+Provider)\s*\(You\s+will\s+pay\s+the\s+least\)\s*(Out[-‐‑–]\s*of[-‐‑–]\s*Network\s+Provider|Non[-‐‑–]?\s*Network\s+Provider|Non[-‐‑–]?\s*Preferred\s+Provider|Non[-‐‑–]?\s*Participating\s+Provider)\s*\(You\s+will\s+pay\s+the\s+most\)/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function cite(doc: SbcDocument, page: number, quote: string): EvidenceCitation | undefined {
  const verified = verifyEvidenceCitation(
    [{ documentId: doc.documentId, pageCount: doc.pageCount ?? doc.pages.length, pages: [...doc.pages] }],
    { documentId: doc.documentId, page, quote },
  );
  return verified.ok ? { documentId: doc.documentId, page, quote: verified.quote } : undefined;
}

/** The page's two cost headings, verbatim, when it prints exactly two. */
function headings(page: string): { columns: [string, string]; quote: string } | undefined {
  const m = HEADINGS.exec(page);
  if (!m || (page.match(/You\s+will\s+pay\s+the\s+(?:least|most)/gi) ?? []).length !== 2) return undefined;
  const at = (m.index ?? 0) + m[0].indexOf(m[1]);
  return { columns: [squash(m[1]), squash(m[2])], quote: page.slice(at, (m.index ?? 0) + m[0].length) };
}

interface Found { page: number; start: number; end: number; text: string; form: number }

/** Every form mark of the document, in text order, placed in the form. */
function marksOf(pages: readonly string[]): Found[] {
  const out: Found[] = [];
  // The form's examples list services under the same names.
  const examples = coverageExampleSpans(pages);
  pages.forEach((page, i) => {
    for (const m of page.matchAll(ANY)) {
      if ((examples.get(i + 1) ?? []).some((s) => s.start <= (m.index ?? 0) && (m.index ?? 0) < s.end)) continue;
      const which = UNIQUE.findIndex((_, n) => m[n + 1] !== undefined);
      out.push({ page: i + 1, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0], form: FORM.findIndex((f) => f.text === UNIQUE[which]) });
    }
  });
  // "Physician/surgeon fees" stands twice in the form: take the place that
  // follows the mark before it.
  return out.map((f, k) => {
    const prev = out[k - 1]?.form;
    const places = FORM.flatMap((m, n) => (m.text === FORM[f.form].text ? [n] : []));
    return { ...f, form: places.find((n) => prev !== undefined && n === prev + 1) ?? f.form };
  });
}

const isLabel = (form: number) => FORM[form]?.facts !== undefined;

/** The next place in the form. After the last drug caption, or between two
 *  groups whose caption is on another page, captions may be missing. */
function follows(a: number, b: number): boolean {
  if (b === a + 1) return true;
  return b === a + 2 && !isLabel(a + 1);
}

export function sbcChartClaims(doc: SbcDocument): SbcClaim[] {
  if (!isSbcDocument(doc.pages) || !readsCellByCell(doc.pages)) return [];
  const marks = marksOf(doc.pages);
  // The form's first label always wraps: contiguous ⇒ cells are not split.
  if (marks.filter((m) => m.form === 1).length !== 1) return [];
  let note: EvidenceCitation | undefined;
  doc.pages.forEach((page, i) => {
    const m = CHART_NOTE.exec(page);
    if (m && !note) note = cite(doc, i + 1, m[0]);
  });
  const out: SbcClaim[] = [];
  marks.forEach((mark, k) => {
    const facts = FORM[mark.form].facts ?? [];
    const prev = marks[k - 1];
    const next = marks[k + 1];
    if (facts.length === 0 || !prev || !next) return;
    if (!follows(prev.form, mark.form) || !follows(mark.form, next.form)) return;
    // A label printed twice in its place proves neither row.
    if (marks.filter((m) => m.form === mark.form).length !== 1) return;
    const page = doc.pages[mark.page - 1];
    const head = headings(page);
    const header = head && cite(doc, mark.page, head.quote);
    if (!head || !header) return;
    // A row ends at the next form mark on its page, or at the page end when
    // the next page's chart continues with that mark directly under its
    // headings (nothing of this row is left over there).
    let end = next.start;
    if (next.page !== mark.page) {
      const nextPage = doc.pages[next.page - 1];
      const nextHead = headings(nextPage);
      if (next.page !== mark.page + 1 || !nextHead) return;
      const under = nextPage.indexOf(nextHead.quote) + nextHead.quote.length;
      if (next.start < under || nextPage.slice(under, next.start).trim()) return;
      end = page.length;
    }
    const raw = page.slice(mark.start, end).trimEnd();
    const parsed = ROW.exec(raw.slice(mark.text.length));
    if (!parsed || raw.length > 700) return;
    const limitation = squash(parsed[3]);
    if (COST_IN_TEXT.test(limitation) || /\bPage \d+ of \d+|^\* ?For more information/i.test(limitation)) return;
    if (!NO_LIMIT.test(limitation) && (CELL_CONDITION.test(limitation) || /^none\b/i.test(limitation) || /for more information about limitations/i.test(limitation))) return;
    if (!NO_LIMIT.test(limitation) && !PREAUTH.test(limitation) && !SENTENCES.test(limitation)) return;
    const row = cite(doc, mark.page, raw);
    if (!row) return;
    head.columns.forEach((heading, column) => {
      const cell = squash(parsed[column + 1]);
      const carriesNote = note && /copay|coinsurance/i.test(cell);
      const display = [
        `${squash(mark.text)} (${heading}): ${cell}`,
        ...(NO_LIMIT.test(limitation) ? [] : [limitation]),
        ...(carriesNote ? [squash(note!.quote)] : []),
      ].join("\n");
      for (const factName of facts) {
        if (factName === "coinsurance" && !/coinsurance/i.test(cell)) continue;
        out.push({
          factName,
          value: {
            documentId: doc.documentId,
            display,
            // The row's label is the provision: two rows of one fact never rival.
            qualifiers: { networkTier: heading, conditions: squash(mark.text) },
            evidence: [row, header, ...(carriesNote ? [note!] : [])],
            anchor: { kind: "statement", page: mark.page, start: mark.start, end: mark.start + raw.length },
          },
        });
      }
    });
  });
  return out;
}

/** Facts the form names (a chart row, the drug caption, the exclusions list)
 *  for which no claim was made: the form's own words, so the fact is reported
 *  as withheld and never as absent. */
export function sbcUnreadRows(doc: SbcDocument): { factName: string; page: number; quote: string }[] {
  if (!isSbcDocument(doc.pages)) return [];
  const read = new Set(sbcChartClaims(doc).map((c) => c.factName));
  const out: { factName: string; page: number; quote: string }[] = [];
  const add = (factName: string, page: number, quote: string) => {
    if (!read.has(factName) && out.filter((o) => o.factName === factName).length < 2) out.push({ factName, page, quote });
  };
  for (const mark of marksOf(doc.pages)) {
    const form = FORM[mark.form];
    for (const fact of form.facts ?? []) add(fact, mark.page, mark.text);
    if (form.text.startsWith("If you need drugs")) add("prescriptions", mark.page, mark.text);
    if (form.text === "Rehabilitation services") add("physical-therapy", mark.page, mark.text);
  }
  const examples = coverageExampleSpans(doc.pages);
  doc.pages.forEach((page, i) => {
    const list = /Services\s+Your\s+Plan\s+Generally\s+Does\s+NOT\s+Cover\b/i.exec(page);
    if (list) add("material-exclusions", i + 1, list[0]);
    const from = list?.index ?? -1;
    // Every other line of the form that names one of these facts in a list.
    let at = 0;
    for (const line of page.split("\n")) {
      const start = at;
      at += line.length + 1;
      if ((examples.get(i + 1) ?? []).some((s) => s.start <= start && start < s.end)) continue;
      const bullet = from >= 0 && start > from && /^\s*[•·▪◦\-–]\s*\S/.test(line);
      const drugs = /\bprescription drug/i.test(line) && i === 0;
      if (!bullet && !drugs) continue;
      for (const [fact, re] of LISTED) if (re.test(line) && (bullet || fact === "prescriptions")) add(fact, i + 1, line.trim());
    }
  });
  return out;
}

const LISTED: readonly (readonly [string, RegExp])[] = [
  ["dental-coverage", /\bdental\b/i], ["vision-coverage", /\b(?:eye care|vision|glasses)\b/i], ["home-nursing", /\bprivate[- ]duty nursing\b/i],
  ["chiropractic", /\bchiropractic\b/i], ["prescriptions", /\bprescription drug/i], ["international-coverage", /\boutside\b.*\b(?:U\.?S\.?|United States)\b/i],
];
