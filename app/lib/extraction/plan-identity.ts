// Conservative source-title recognition and deterministic value-to-plan scope.
// Plans are proven only by explicit labelled declarations on a document's
// first page; values are assigned to a proven plan when the value's own cited
// passage names that plan (mention proof), or — at the route's Stage E gate —
// when the value's document has exactly one verified plan identity and the
// provision passes the document-ownership applicability guards (see
// resolveRowPlanIds). Multi-plan documents, shared/unknown-scope facts,
// guard-language provisions (riders, examples, marketing, competitor or
// comparable-plan figures), and uncertain peer groups stay unassigned so the
// UI labels them clearly.
import { createHash } from "node:crypto";
import { hasSameScopeContradiction } from "@/app/lib/extraction/contradictions";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { sourcedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
import { hasPlanValueProof } from "@/app/lib/extraction/types";
import type {
  CellValue,
  ComparisonTable,
  ProvenPlan,
  TableRow,
} from "@/app/lib/extraction/types";

type SourceDocument = { documentId: string; filename: string; pages: string[] };

type PlanSource = { planId: string; page: number; name: string };

/** Comparison key for a product name: registered/trademark marks and
 *  whitespace are dropped (PDF extraction often loses the space — the FEP
 *  title "FEP® Blue Focus" appears as "FEPBlue Focus" in its code lines), but
 *  punctuation and symbols are KEPT, so "Alpha+" and "Alpha", or "Plan A-1"
 *  and "Plan A1", remain different products. Used only to corroborate a
 *  title; the attested name is always the literal title line. */
function nameKey(text: string): string {
  return text.replace(/[®™℠]/g, "").replace(/\s+/g, "").toLowerCase();
}

const ENROLLMENT_HEADER = /^Enrollment codes? for this Plan\s*:?$/i;
/** A complete enrollment record: "<code> <product name> - <category>". */
const RECORD = /^\d{2,5}\s+(\S.{0,58}?)\s+[-–—]\s*(\S.{0,40}?)$/;
/** A line that starts like a record (a code, alone or followed by text). */
const RECORD_START = /^\d{2,5}(?:\s|$)/;
/** A record-shaped line even without a parsable category. */
const RECORD_LOOKALIKE = /^\d{2,5}\s+\S.*\s[-–—]\s*\S/;
/** Once an enrollment declaration exists on the page, a line that starts with
 *  a code followed by product-like text is a plausible record. A bare number
 *  (a page number or year) is not. */
const PLAUSIBLE_RECORD_START = /^\d{2,5}\s+[A-Za-z]/;
const MAX_RECORD_LINES = 4;
/** The only enrollment categories this deliberately narrow recognizer
 *  understands (FEHB contract types). Anything else abstains. */
const ENROLLMENT_CATEGORIES = ["Self Only", "Self Plus One", "Self and Family"] as const;
const FEHB_CONTEXT = /\bFEHB\b|Federal Employees Health Benefits/i;
/** Explicit illustrative wording, checked on the title and the enrollment
 *  block (header, records and the lines beside each block). */
const ILLUSTRATIVE_CONTEXT = /\b(?:samples?|examples?|fictional|fictitious|illustrat\w*|hypothetical|dummy|placeholder)\b/i;
/** Narrow document-role statements: the page says it is NOT an actual plan
 *  document, or that its content is a teaching illustration. */
const NOT_A_PLAN_DOCUMENT =
  /\b(?:is|are)\s+not\s+(?:an?\s+|the\s+)?(?:actual\s+|real\s+|official\s+|specific\s+)?(?:plan\s+(?:brochure|document)|brochure|insurance\s+plan|health\s+plan|policy|contract|statement\s+of\s+benefits)\b/i;
const TEACHING_PURPOSE = /\bfor\s+(?:educational|illustration|illustrative|demonstration|training)\s+purposes\b/i;
const FICTIONAL_WORDS = /\b(?:hypothetical|fictional|fictitious)\b/i;
/** A short, unpunctuated heading-like line that labels a sample/example
 *  section ("Example: reading your codes", "How to read your card (example)").
 *  Ordinary sentences containing "for example" do not match. */
const SAMPLE_SECTION_LABEL =
  /^(?:sample|example|illustration|hypothetical)\b|\(\s*(?:sample|example)s?\s*\)\s*:?$|\b(?:sample|example)s?\s*:$/i;
/** Affirmative plan declaration naming the product: "... Plan (NAME) ...". */
const PLAN_DECLARATION = /\bPlan\s*\(\s*([^()]{2,60}?)\s*\)/gi;
const SPONSOR_LINE = /\b(?:sponsored|administered|underwritten|issued|insured|provided)\b[^\n]*\bby\b/i;
/** A title that ends like a legal entity names a carrier, not a product. */
const LEGAL_ENTITY_SUFFIX = /\b(?:Inc|LLC|Ltd|Corp|Corporation|Company|Co|Association|Assurance|Insurance|Insurers?)\.?$/i;
const MAX_TITLE_LENGTH = 60;

function supportedCategory(text: string): string | undefined {
  const collapsed = text.trim().replace(/\s+/g, " ").toLowerCase();
  return ENROLLMENT_CATEGORIES.find((category) => category.toLowerCase() === collapsed);
}

/** The literal product name of a record: marks removed, whitespace collapsed,
 *  case folded — but NOT spacing-insensitive, so "ZenithCare" and "Zenith
 *  Care" in two records are distinct literal products. */
const literalName = (text: string): string =>
  text.replace(/[®™℠]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const pageLines = (page: string): string[] =>
  page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

interface EnrollmentScan {
  /** Distinct product keys / literals from every parsed record on the page. */
  names: Set<string>;
  literals: Set<string>;
  /** Supported enrollment categories declared on the page. */
  categories: string[];
  headers: number;
  /** A record-like line that did not fully parse, or an unsupported category
   *  inside a declared block: a potentially conflicting declaration. */
  ambiguous: boolean;
  /** Header, records and the lines beside each block. */
  blockContext: string[];
}

/** Parse EVERY enrollment declaration on the first page. A record starts at a
 *  line that begins with a code and is assembled across up to
 *  MAX_RECORD_LINES wrapped lines (code / name / category may each wrap)
 *  until it matches "<code> <name> - <supported category>". A record-like
 *  line that never completes is ambiguity, never silently discarded. */
function scanEnrollment(page: string): EnrollmentScan | undefined {
  const lines = pageLines(page);
  const scan: EnrollmentScan = {
    names: new Set(), literals: new Set(), categories: [], headers: 0, ambiguous: false, blockContext: [],
  };
  let inBlock = false;
  const declared = lines.some((line, i) =>
    ENROLLMENT_HEADER.test(line) ||
    (i + 1 < lines.length && ENROLLMENT_HEADER.test(`${line} ${lines[i + 1]}`))
  );
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const joinedHeader = i + 1 < lines.length ? `${line} ${lines[i + 1]}` : "";
    const headerLines = ENROLLMENT_HEADER.test(line) ? 1 : ENROLLMENT_HEADER.test(joinedHeader) ? 2 : 0;
    if (headerLines > 0) {
      scan.headers++;
      inBlock = true;
      scan.blockContext.push(headerLines === 1 ? line : joinedHeader);
      if (lines[i - 1] !== undefined) scan.blockContext.push(lines[i - 1]);
      i += headerLines;
      continue;
    }
    if (RECORD_START.test(line)) {
      let text = line;
      let used = 1;
      let record = RECORD.exec(text);
      while ((!record || !supportedCategory(record[2])) && used < MAX_RECORD_LINES && i + used < lines.length) {
        const next = lines[i + used];
        if (RECORD_START.test(next) || ENROLLMENT_HEADER.test(next)) break;
        text = `${text} ${next}`;
        used++;
        record = RECORD.exec(text);
      }
      const category = record ? supportedCategory(record[2]) : undefined;
      if (record && category) {
        scan.names.add(nameKey(record[1]));
        scan.literals.add(literalName(record[1]));
        scan.categories.push(category);
        scan.blockContext.push(text);
        i += used;
        continue;
      }
      // Fail closed: once a declaration exists, ANY plausible record that did
      // not fully parse — wrapped past the assembly limit, interrupted by a
      // heading, or assembled but with an unsupported category — is a
      // potentially conflicting product declaration.
      if (
        inBlock || RECORD_LOOKALIKE.test(line) || RECORD.test(text) ||
        (declared && PLAUSIBLE_RECORD_START.test(line))
      ) scan.ambiguous = true;
      scan.blockContext.push(line);
      i++;
      continue;
    }
    if (inBlock) scan.blockContext.push(line); // the line that ends the block
    inBlock = false;
    i++;
  }
  return scan.headers > 0 ? scan : undefined;
}

/** True when page 1 itself says it is not an actual plan document, is a
 *  teaching illustration, or carries a short sample/example section label. */
function pageDeclaresNonPlanContext(page: string): boolean {
  if (NOT_A_PLAN_DOCUMENT.test(page) || TEACHING_PURPOSE.test(page) || FICTIONAL_WORDS.test(page)) return true;
  return pageLines(page).some((line) =>
    line.length <= 80 && !/[.]$/.test(line) && SAMPLE_SECTION_LABEL.test(line)
  );
}

/** Product-specific corroboration: an affirmative "Plan (NAME)" declaration
 *  on page 1 whose NAME is the declared product. */
function declaresProductAsPlan(page: string, declaredKey: string): boolean {
  const text = page.replace(/\s+/g, " ");
  return [...text.matchAll(PLAN_DECLARATION)].some((match) => nameKey(match[1]) === declaredKey);
}

/** Quote for the title: the title line alone when it is a unique verifiable
 *  span on the page, otherwise the title with one adjacent line. The name also
 *  appears inside the enrollment records, so the bare line may be ambiguous;
 *  the page verifier decides, exactly as the route will. */
function verifiableTitleQuote(documentId: string, page: string, title: string): string | undefined {
  const raw = pageLines(page);
  const docs = [{ documentId, pageCount: 1, pages: [page] }];
  for (const [index, line] of raw.entries()) {
    if (line !== title) continue;
    const candidates = [title];
    if (raw[index + 1] !== undefined) candidates.push(`${title}\n${raw[index + 1]}`);
    if (raw[index - 1] !== undefined) candidates.push(`${raw[index - 1]}\n${title}`);
    for (const quote of candidates) {
      const result = verifyEvidenceCitation(docs, { documentId, page: 1, quote });
      if (result.ok && result.quote.includes(title)) return result.quote;
    }
  }
  return undefined;
}

/** First-page product-title fallback for documents no existing recognizer
 *  attested (P2.1). Deliberately narrow; every condition is positive identity
 *  evidence or a narrow role/section rejection, and any ambiguity abstains
 *  (see tests/unit/plan-title-block.test.ts):
 *    A. every enrollment record on page 1 parses (wrapped across lines) and
 *       they all name ONE literal product with supported categories;
 *    B. FEHB context, an affirmative "Plan (NAME)" declaration of that
 *       product, exactly one distinct standalone title line equal to it, no
 *       "not a plan document"/teaching/fictional statement or sample section,
 *       no illustrative wording in the block, not the sponsor, not a legal
 *       entity;
 *    and a unique verifiable quote. The name and quote are literal page text
 *  so existing page verification and name-in-quote validation hold
 *  unchanged. Enrollment categories are never identities. */
function recognizeTitleBlockPlan(
  documentId: string,
  page: string,
): { name: string; quote: string } | undefined {
  const scan = scanEnrollment(page);
  if (!scan || scan.ambiguous || scan.names.size !== 1 || scan.literals.size !== 1) return undefined;
  if (!FEHB_CONTEXT.test(page)) return undefined;
  const [declaredKey] = scan.names;
  if (declaredKey.length < 3) return undefined;
  if (!declaresProductAsPlan(page, declaredKey)) return undefined;
  if (pageDeclaresNonPlanContext(page)) return undefined;

  const lines = pageLines(page);
  // Distinct standalone lines equal to the declared name. The name inside an
  // enrollment record is not a title line (it carries a code and a category).
  const titles = [...new Set(
    lines.filter((line) =>
      line.length <= MAX_TITLE_LENGTH &&
      nameKey(line) === declaredKey &&
      !RECORD_START.test(line) &&
      !ENROLLMENT_HEADER.test(line)
    ),
  )];
  if (titles.length !== 1) return undefined;
  const [title] = titles;
  if (LEGAL_ENTITY_SUFFIX.test(title)) return undefined;
  if (ILLUSTRATIVE_CONTEXT.test([title, ...scan.blockContext].join("\n"))) return undefined;
  for (const [index, line] of lines.entries()) {
    if (!SPONSOR_LINE.test(line)) continue;
    if (nameKey(`${line} ${lines[index + 1] ?? ""}`).includes(declaredKey)) return undefined;
  }
  const quote = verifiableTitleQuote(documentId, page, title);
  return quote ? { name: title, quote } : undefined;
}

export function attestPlans(documents: readonly SourceDocument[]): ProvenPlan[] {
  const groups = new Map<string, ProvenPlan>();
  for (const doc of documents) {
    for (const [index, page] of doc.pages.entries()) {
      // Title-context rule: a plan identity is attested only by title or
      // declaration lines on the document's FIRST page. Mid-document
      // declarations (application-form samples, rate-sheet footers, renewal
      // notices) are rejected as phantom identities — they must never create
      // plans. Known limitation (fail-closed): a plan declared only on a
      // later page attests nothing at all, and a phantom line that lands on
      // page 1 would still attest; ownership then voids via multi-plan
      // abstention. Reported in docs/P1_OWNERSHIP_IMPL_REPORT.md.
      if (index !== 0) continue;
      const lines = page.split(/\r?\n/);
      for (const [lineIndex, line] of lines.entries()) {
        // Requiring an explicit label avoids treating a mention, a filename or
        // a list of competitors as proof of a plan offered by this document.
        const declaration = /^\s*(?:Policy|Plan) name:\s*([\w][\w &'().,-]{0,99}?)(?:\s*;\s*Policy ID:\s*([A-Za-z0-9][A-Za-z0-9-]{0,63}))?(?:\s*;\s*Issuer:\s*([\w][\w &'().,-]{0,99}))?\s*$/i.exec(line);
        const studentSecureTitle = /^\s*Get\s+([A-Z][\w®-]*)\s+insurance\s+from\s+[A-Z][\w &'().,-]+\s*$/i.exec(line);
        const sevenCornersTitle = /^\s*Seven Corners (Travel Medical(?: Including the USA)?)\s*$/i.exec(line);
        const programTitleMatch = lineIndex === 0
          ? /^\s*([\w][\w &'().,-]{2,90}?\s+Program(?:SM|℠)?)\s*$/i.exec(line)
          : null;
        const programTitle = programTitleMatch &&
          /^\s*Certificate of Insurance\s*$/i.test(lines[1] ?? "")
          ? programTitleMatch[1].trim()
          : undefined;
        const name = declaration?.[1].trim() ?? studentSecureTitle?.[1] ?? sevenCornersTitle?.[1] ?? programTitle;
        if (!name) continue;
        const policyIdentifier = declaration?.[2]?.trim();
        const issuer = declaration?.[3]?.trim();
        const key = policyIdentifier && issuer
          ? `id:${issuer.toLowerCase()}:${policyIdentifier.toLowerCase()}:${name.toLowerCase()}`
          : `document:${doc.documentId}:${name.toLowerCase()}`;
        const current = groups.get(key);
        if (current?.sources.some((source) => source.documentId === doc.documentId)) continue;
        const source = { documentId: doc.documentId, page: index + 1, quote: line.trim() };
        if (current) current.sources.push(source);
        else groups.set(key, {
          planId: `plan-${createHash("sha256").update(key).digest("hex").slice(0,20)}`,
          name,
          ...(policyIdentifier ? { policyIdentifier } : {}),
          ...(issuer ? { issuer } : {}),
          sources: [source],
        });
      }
    }
    // P2.1 fallback: only for a document no existing recognizer attested.
    const attested = [...groups.values()].some((plan) =>
      plan.sources.some((source) => source.documentId === doc.documentId)
    );
    const titleBlock = !attested && doc.pages[0] !== undefined
      ? recognizeTitleBlockPlan(doc.documentId, doc.pages[0])
      : undefined;
    if (titleBlock) {
      const key = `document:${doc.documentId}:${titleBlock.name.toLowerCase()}`;
      groups.set(key, {
        planId: `plan-${createHash("sha256").update(key).digest("hex").slice(0,20)}`,
        name: titleBlock.name,
        sources: [{ documentId: doc.documentId, page: 1, quote: titleBlock.quote }],
      });
    }
  }
  return [...groups.values()];
}

function planSourcesByDocument(plans: readonly ProvenPlan[]): Map<string, PlanSource[]> {
  const map = new Map<string, PlanSource[]>();
  for (const plan of plans) {
    for (const source of plan.sources) {
      const arr = map.get(source.documentId) ?? [];
      arr.push({ planId: plan.planId, page: source.page, name: plan.name });
      map.set(source.documentId, arr);
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => a.page - b.page);
  return map;
}

/** Word-boundary name matcher so a substring occurrence inside another word
 *  (or a one/two-letter plan name appearing in nearly every sentence) never
 *  counts as a plan/value association. */
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names shorter than three characters cannot be recognized in narrative
 *  text without false matches; such plans require the strict labelled
 *  plan/fact/value proof (see hasPlanValueProof) instead of a mention. */
function mentionableName(name: string): boolean {
  return name.trim().length >= 3;
}

/** Word-boundary pattern for recognizing a proven plan's name in narrative
 *  text, or undefined when the name is too short to match reliably. Shared
 *  by the C6 attribution rule and the chat selection scoping (task 17) so
 *  both use the same conservative mention semantics. */
export function planMentionPattern(planName: string): RegExp | undefined {
  if (!mentionableName(planName)) return undefined;
  return new RegExp(`\\b${escaped(planName.trim())}\\b`, "i");
}

/** The single proven plan named by a set of quoted passages, or undefined
 *  when the passages name none of the candidate plans — or name more than
 *  one (the value's plan scope would be ambiguous, so it stays unassigned).
 *  Word-boundary matching keeps mentions out of unrelated words. */
function uniqueMentionedPlanId(
  plans: readonly ProvenPlan[],
  evidence: readonly { quote: string }[],
): string | undefined {
  const matched = new Set<string>();
  for (const plan of plans) {
    if (!mentionableName(plan.name)) continue;
    const name = new RegExp(`\\b${escaped(plan.name.trim())}\\b`, "i");
    for (const e of evidence) {
      if (name.test(e.quote)) {
        matched.add(plan.planId);
        break;
      }
    }
  }
  return matched.size === 1 ? [...matched][0] : undefined;
}

/** Decide which proven plan, if any, a value belongs to.
 *
 *  - A plan-name mention in the value's own cited evidence is decisive, but
 *    only when it names exactly one proven plan scoped to this document.
 *  - Same-page declarations, page position, and single-plan documents are
 *    NOT association proof and never assign a value (reproduced C6 defect:
 *    one declared plan absorbed example and competitor figures that share
 *    its page).
 *  - An extraction-provided planId is kept only when the evidence names the
 *    same plan; a failed explicit claim is dropped, not replaced.
 *  - Everything else stays unassigned so the UI can label it clearly. */
export function resolveValuePlanId(
  value: CellValue,
  plans: readonly ProvenPlan[],
): string | undefined {
  const byDoc = planSourcesByDocument(plans);
  const candidates = byDoc.get(value.documentId) ?? [];
  if (candidates.length === 0) return undefined;
  const scoped = plans.filter((p) => candidates.some((c) => c.planId === p.planId));
  const mentioned = uniqueMentionedPlanId(scoped, value.evidence);
  if (!mentioned) return undefined;
  return value.planId && value.planId === mentioned ? value.planId : mentioned;
}

/** ---------------------------------------------------------------------
 *  P1 controlled evidence ownership (route Stage E gate).
 *
 *  The mention proof above requires the value's own evidence to name the
 *  plan. Real brochures rarely name their plan inside a benefit line, so a
 *  second, independent proof path exists for single-plan documents: when
 *  exactly one verified plan identity covers the value's own document, the
 *  provision may be attributed to that plan — but only when it is
 *  demonstrably applicable (guards below) and its peer group is free of
 *  same-scope contradictions. Every guard failure abstains (fail-closed):
 *  an unattributed value displays as shared data, never as an invented NO.
 *  --------------------------------------------------------------------- */

/** Lexical abstention guards. A provision whose display or cited quotes use
 *  this language is not demonstrably a base-plan provision: optional
 *  riders/add-ons/upgrades/endorsements, examples, illustrations, samples,
 *  hypotheticals, alternative-coverage options, competitor figures,
 *  comparable-plan figures, shared provisions, and marketing summaries.
 *  The narrative guard (below) additionally abstains long digitless prose.
 *  Measured on the three authorized real PDFs: none of the 62
 *  ownership-attributable values contains any of these terms, and the
 *  genuine selectable deductible-option menu ("Choose the option you
 *  want.") deliberately does NOT match — deductible options stay
 *  attributable with their qualifiers (owner requirement 3). */
const OWNERSHIP_ABSTENTION_PATTERN = new RegExp(
  "\\b(?:" +
  "riders?|optional|add-?ons?|upgrades?|endorsements?|examples?|" +
  "illustrat\\w*|samples?|for\\s+instance|suppose\\w*|hypothetical\\w*|" +
  "alternativ\\w*|competitors?|comparable\\s+plans?|shared|offers?" +
  ")\\b",
  "i",
);

/** Narrative guard: a display without any digit and at least this many
 *  characters is prose (marketing copy, definitions, boilerplate paragraphs),
 *  not a demonstrable benefit provision. Short digitless labels stay
 *  attributable (schedule structure: "Physician / Specialist Visit"). */
const NARRATIVE_MIN_LENGTH = 45;
const DIGIT_RE = /\d/;

/** True when the provision reads as an applicable base-plan provision — i.e.
 *  its display and cited quotes contain no abstention language and the
 *  display is not long digitless narrative. Pure and deterministic; a false
 *  return means the ownership proof abstains. */
export function ownershipProvisionApplicable(
  display: string,
  evidenceQuotes: readonly string[],
): boolean {
  const trimmed = display.trim();
  if (!DIGIT_RE.test(trimmed) && trimmed.length >= NARRATIVE_MIN_LENGTH) return false;
  return !OWNERSHIP_ABSTENTION_PATTERN.test(`${display} ${evidenceQuotes.join(" ")}`);
}

/** The planId of the single verified plan whose sources cover a document, or
 *  undefined when zero or several verified plans cover it (multi-plan
 *  documents are never resolved by ownership — fail-closed). */
export function uniqueDocumentPlanId(
  plans: readonly ProvenPlan[],
  documentId: string,
): string | undefined {
  const ids = new Set(
    plans
      .filter((plan) => plan.sources.some((source) => source.documentId === documentId))
      .map((plan) => plan.planId),
  );
  return ids.size === 1 ? [...ids][0] : undefined;
}

/** Loose declaration-line name extraction for the page-scope guard. Matches
 *  the same "Policy/Plan name:" shape the attestation regex requires, but
 *  only the name up to the first ";" is needed. */
const DECLARATION_NAME_RE = /^\s*(?:Policy|Plan) name:\s*([^;\n]{1,120})/i;

function declarationNamesOnPage(page: string | undefined): string[] {
  if (!page) return [];
  const names: string[] = [];
  for (const line of page.split(/\r?\n/)) {
    const match = DECLARATION_NAME_RE.exec(line);
    if (match?.[1]?.trim()) names.push(match[1].trim());
  }
  return names;
}

/** True when the value's text names a verified plan other than the owning
 *  plan (a rival/competitor narrative mention) — the value's plan scope is
 *  then unclear, so ownership abstains. A mention of the owning plan itself
 *  is fine. Unverified names cannot be detected here (no registry entry);
 *  that boundary is reported, and the lexical competitor/comparable-plan
 *  guards catch the labelled forms. */
function mentionsOtherVerifiedPlan(
  plan: ProvenPlan,
  text: string,
  plans: readonly ProvenPlan[],
): boolean {
  for (const other of plans) {
    if (other.planId === plan.planId) continue;
    if (planMentionPattern(other.name)?.test(text)) return true;
  }
  return false;
}

/** True when ANY page of the value's document declares a plan other than the
 *  owning plan — the document may describe another plan that page-scoped
 *  attestation no longer sees (P1 title-context hardening attests only page-1
 *  declarations), so ownership is VOID for the whole document: every value of
 *  it abstains, including values on pages with no declaration. Fail-closed
 *  and consistent with C6's "same-page declarations never attribute". */
function documentDeclaresOtherPlan(
  plan: ProvenPlan,
  documentId: string,
  pagesByDocument: ReadonlyMap<string, readonly string[]>,
): boolean {
  const pages = pagesByDocument.get(documentId);
  if (!pages) return false;
  const ownerName = plan.name.trim().toLowerCase();
  for (const page of pages) {
    for (const declared of declarationNamesOnPage(page)) {
      if (declared.trim().toLowerCase() !== ownerName) return true;
    }
  }
  return false;
}

/** Enrollment categories a document's first page declares (supported FEHB
 *  contract types only); empty when it declares none. */
function declaredEnrollmentCategories(page: string | undefined): string[] {
  return page ? [...new Set(scanEnrollment(page)?.categories ?? [])] : [];
}

function mentionsCategory(text: string, category: string): boolean {
  const words = category.trim().split(/\s+/).map(escaped).join("\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${words}(?:$|[^a-z0-9])`, "i").test(text);
}

const FIGURE_RE = /\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/g;
const digitsOf = (figure: string): string => figure.replace(/[^\d.]/g, "");

/** Enrollment categories tied to THIS value's figure: those named in the
 *  sentence(s) of its display/evidence that state the figure (whitespace and
 *  line breaks collapsed first). A display with no figure, or a figure found
 *  in no sentence, falls back to every sentence — a superset, so the guard
 *  can only become stricter. */
function categoriesTiedToValue(value: CellValue, categories: readonly string[]): string[] {
  const text = [value.display, ...value.evidence.map((e) => e.quote)]
    .join(". ").replace(/\s+/g, " ");
  const sentences = text.split(/[.!?;]\s+|[;!?]\s*/).filter(Boolean);
  const figures = (value.display.match(FIGURE_RE) ?? []).map(digitsOf);
  const stating = figures.length === 0 ? sentences : sentences.filter((sentence) =>
    figures.some((figure) =>
      (sentence.match(FIGURE_RE) ?? []).some((found) => digitsOf(found) === figure)
    ));
  const scope = stating.length > 0 ? stating : sentences;
  return categories.filter((category) => scope.some((sentence) => mentionsCategory(sentence, category)));
}

/** True when a provision is enrollment-specific but its own, evidence-
 *  supported `conditions` do not preserve EVERY enrollment category tied to
 *  its figure. Such a figure applies to those enrollment types only;
 *  attributing it to the plan would present it as plan-wide (or with a
 *  partial scope), so ownership abstains. Only the value's own qualifiers are
 *  read, as the presentation will re-derive them from the canonical evidence
 *  (sourcedQualifiers): no cross-value inheritance, and scope that cannot
 *  survive that re-derivation (e.g. across a wrapped line) counts as lost. */
function lacksEnrollmentScope(value: CellValue, categories: readonly string[]): boolean {
  if (categories.length === 0) return false;
  const tied = categoriesTiedToValue(value, categories);
  if (tied.length === 0) return false;
  const preserved = sourcedQualifiers(value).conditions ?? "";
  return !tied.every((category) => mentionsCategory(preserved, category));
}

/** Resolve Stage E plan attribution for one row's verified values.
 *
 *  Input: values whose citations the route has already verified and
 *  canonicalized (this function verifies nothing itself — it is pure), the
 *  route-survived proven plans (every source already page-verified), and the
 *  session documents (for page-text scope checks only).
 *
 *  Returns one planId (or undefined = abstain) per input value, in order:
 *  1. Claimed path (unchanged C6): a value.planId covered by the plans is
 *     kept only when its evidence contains the labelled plan/fact/value line
 *     (hasPlanValueProof). A failed claim is NOT evidence — the value falls
 *     through to the guard evaluation below like any unclaimed value.
 *  2. Mention-decisive path: a value whose verified planId came from the
 *     mention attribution (its own evidence names exactly one plan scoped to
 *     its document) keeps that planId when the provision passes the
 *     applicability guards and its peer group is conflict-free — even on a
 *     multi-plan document (owner requirement 8: fail-closed "unless existing
 *     stronger proof is present"; the mention is that stronger proof).
 *  3. Ownership path (no planId): the value's document must have exactly one
 *     verified plan (uniqueDocumentPlanId); the provision must pass
 *     ownershipProvisionApplicable; it must not name another verified plan;
 *     its whole document must declare no other plan (document-level scope
 *     void); and its same-document peer
 *     group — evaluated on the uniform assignment (claimed/mention values
 *     included, so a contested group is detected) — must contain no
 *     same-scope contradiction.
 *  4. Everything else abstains (planId undefined → shared/unassigned data). */
export function resolveRowPlanIds(
  factName: string,
  values: readonly CellValue[],
  plans: readonly ProvenPlan[],
  documents: readonly SourceDocument[],
): (string | undefined)[] {
  if (plans.length === 0) return values.map(() => undefined);
  const pagesByDocument = new Map(documents.map((d) => [d.documentId, d.pages]));
  const ownerByDocument = new Map<string, string | undefined>();
  // Uniform assignment first: claimed/mention values keep their verified
  // planId; unclaimed values would join their document's unique plan.
  const uniform = values.map((value) => {
    const covered = value.planId !== undefined &&
      plans.some((p) =>
        p.planId === value.planId &&
        p.sources.some((source) => source.documentId === value.documentId)
      );
    if (covered) return value.planId;
    if (!ownerByDocument.has(value.documentId)) {
      ownerByDocument.set(value.documentId, uniqueDocumentPlanId(plans, value.documentId));
    }
    return ownerByDocument.get(value.documentId);
  });
  return values.map((value, index) => {
    const planId = uniform[index];
    if (planId === undefined) return undefined;
    const plan = plans.find((p) => p.planId === planId)!;
    // Enrollment-scope gate: applies to EVERY attribution path, including a
    // labelled explicit planId (C6 proof is unchanged but never sufficient
    // for an enrollment-specific figure whose scope is not fully preserved).
    if (lacksEnrollmentScope(
      value,
      declaredEnrollmentCategories(pagesByDocument.get(value.documentId)?.[0]),
    )) return undefined;
    if (
      value.planId === planId &&
      hasPlanValueProof(plan.name, factName, value.display, value.evidence)
    ) {
      return planId;
    }
    if (!ownershipProvisionApplicable(
      value.display,
      value.evidence.map((e) => e.quote),
    )) return undefined;
    const text = `${value.display} ${value.evidence.map((e) => e.quote).join(" ")}`;
    if (mentionsOtherVerifiedPlan(plan, text, plans)) return undefined;
    if (documentDeclaresOtherPlan(plan, value.documentId, pagesByDocument)) {
      return undefined;
    }
    const peers = values.filter(
      (peer, peerIndex) =>
        peer.documentId === value.documentId && uniform[peerIndex] === planId,
    );
    if (hasSameScopeContradiction(peers)) return undefined;
    return planId;
  });
}

/** Return a table whose values carry deterministic `planId` assignments against
 *  the proven plans. Unattributable values remain without a planId so the UI
 *  can label them clearly. */
export function attributePlanScope(
  table: ComparisonTable,
  documents: readonly SourceDocument[],
): ComparisonTable {
  const plans = table.plans ?? attestPlans(documents);
  if (plans.length === 0) return { ...table, plans: undefined };
  const rows: TableRow[] = table.rows.map((row) => ({
    ...row,
    values: row.values.map((value) => {
      const planId = resolveValuePlanId(value, plans);
      if (planId === value.planId) return value;
      if (planId === undefined) {
        const { planId: _, ...rest } = value;
        return rest as CellValue;
      }
      return { ...value, planId };
    }),
  }));
  return { ...table, plans, rows };
}
