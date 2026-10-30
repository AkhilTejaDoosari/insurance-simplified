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
import { hasPlanValueProof } from "@/app/lib/extraction/types";
import type {
  CellValue,
  ComparisonTable,
  ProvenPlan,
  TableRow,
} from "@/app/lib/extraction/types";

type SourceDocument = { documentId: string; filename: string; pages: string[] };

type PlanSource = { planId: string; page: number; name: string };

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
