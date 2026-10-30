// Exported report generator (M5 task 20).
//
// The report is a projection of ONE immutable snapshot supplied by the export
// route: the validated comparison table + stored user context + the validated
// plan/tier selection. Layout: concise personalized overview, key financial
// terms for exactly the selected plans/tiers (citations adjacent to every
// figure), the five-section comparison (empty sections hidden), prioritized
// verify-before-enrolling actions, and page footers. Nothing here invents
// facts, prints capability/session/secret material, or contacts beyond what
// the selected scope requires.
//
// Fail-closed chain untouched: sources are cited as "file, page N" text only —
// never session URLs, never evidence IDs.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RegisteredCellValue,
  RegisteredComparisonTable,
} from "@/app/lib/extraction/types";
import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { buildWorkspaceGroups } from "@/app/lib/extraction/workspace-groups";
import {
  verifyLabelFor,
  buildVerifyItems,
} from "@/app/lib/extraction/verify-items";
import { documentPlanTitle } from "@/app/lib/extraction/plan-names";
import type { PersonalizedOverview } from "@/app/lib/extraction/overview";
import { sourcedQualifiers } from "@/app/lib/extraction/qualifier-evidence";
import {
  buildPresentation,
  indexFacts,
  viewDocumentIds,
  type ActiveView,
} from "@/app/lib/presentation/adaptive";
import type { ContactHit } from "@/app/lib/extraction/contacts";

/** Validated plan/tier scope the report renders. Structurally the SAME
 *  payload chat/export validate (selection-request.ts); nothing but IDs and
 *  tier names is ever read from it. */
export interface ReportSelection {
  readonly resultFingerprint: string;
  readonly planIds: string[];
  readonly tiers: Readonly<Record<string, string | null>>;
  readonly legacyTiersByDocument: Readonly<Record<string, string>>;
  readonly selectionKey?: string;
  readonly viewMode?: "understand" | "compare";
  readonly documentId?: string;
}

export interface ReportInput {
  readonly table: RegisteredComparisonTable;
  readonly userContext: Readonly<Record<string, string>>;
  readonly selection?: Readonly<ReportSelection>;
  readonly overview?: Readonly<PersonalizedOverview>;
  readonly contacts?: readonly unknown[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 42;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const INK = rgb(0.11, 0.16, 0.2);
const MUTED = rgb(0.35, 0.4, 0.44);

const LOGO_FILE = "insurance-simplified-icon.png";
const LOGO_HEIGHT = 28;

const KEY_COST_FACTS = [
  "premium",
  "annual-deductible",
  "out-of-pocket-maximum",
  "coinsurance",
] as const;

function printable(text: string): string {
  return text
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?");
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of printable(text).split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    for (const letter of word) {
      if (font.widthOfTextAtSize(current + letter, size) > width && current) {
        lines.push(current);
        current = "";
      }
      current += letter;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** One column of the comparison: a plan (with its selected tier) for proven
 *  tables, or a document for legacy tables. Plan identity comes exclusively
 *  from the validated table — never from filenames. */
interface PlanView {
  /** Proven plan ID, or document ID for legacy views. */
  readonly id: string;
  readonly label: string;
  /** null means All tiers. */
  readonly tier: string | null;
  /** Present only for proven-plan views. */
  readonly provenPlanId?: string;
  /** Documents the view's values may cite. */
  readonly documentIds: readonly string[];
}

function buildPlanViews(
  table: RegisteredComparisonTable,
  selection?: Readonly<ReportSelection>,
): PlanView[] {
  if (!selection || selection.planIds.length === 0) {
    // No validated selection (direct callers): whole documents, as before.
    return table.documents.map((doc) => ({
      id: doc.documentId,
      label: documentPlanTitle(table, doc.documentId).name,
      tier: null,
      documentIds: [doc.documentId],
    }));
  }
  const proven = (table.plans?.length ?? 0) > 0;
  return selection.planIds.map((id) => {
    const plan = table.plans?.find((p) => p.planId === id);
    const tier = proven
      ? (selection.tiers[id] ?? null)
      : (selection.tiers[id] ?? selection.legacyTiersByDocument[id] ?? null);
    return {
      id,
      label: plan ? plan.name : documentPlanTitle(table, id).name,
      tier,
      ...(plan ? { provenPlanId: plan.planId } : {}),
      documentIds: plan
        ? [...new Set(plan.sources.map((s) => s.documentId))]
        : [id],
    };
  });
}

function tierKey(tier: string): string {
  return tier.trim().toLowerCase();
}

/** Values a plan view shows for one row — overview matchesScope semantics:
 *  proven scope keeps only values attributed to that plan; a set tier keeps
 *  tier-tagged matches plus untagged values (which apply to every tier).
 *  Hidden/in-scope values are never collapsed (contradictory tier values all
 *  render). */
function valuesForView(
  row: RegisteredComparisonTable["rows"][number],
  view: PlanView,
): RegisteredCellValue[] {
  return row.values.filter((value) => {
    if (view.provenPlanId) {
      if (value.planId !== view.provenPlanId) return false;
    } else if (value.documentId !== view.id) {
      return false;
    }
    if (!view.tier) return true;
    const own = value.qualifiers.planTier?.trim();
    if (own && tierKey(own) !== tierKey(view.tier)) return false;
    return true;
  });
}

function sourceLine(
  table: RegisteredComparisonTable,
  value: RegisteredCellValue,
): string {
  const pages = [...new Set(value.evidence.map((e) => e.page))];
  const document = table.documents.find(
    (doc) => doc.documentId === value.documentId,
  );
  return `Source: ${document?.filename ?? value.documentId}, page ${pages.join(", ")}`;
}

function conditionLines(value: RegisteredCellValue): string[] {
  const q = sourcedQualifiers(value);
  return [
    q.networkTier ? `Network: ${q.networkTier}` : "",
    q.ageBand ? `Ages: ${q.ageBand}` : "",
    q.period ? `Period: ${q.period}` : "",
    q.frequency ? `Frequency: ${q.frequency}` : "",
    q.conditions ?? "",
    q.selectionStatus === "selectable"
      ? "Available options; your purchased option is not stated."
      : "",
  ].filter(Boolean);
}

export async function buildReportPdf(input: ReportInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const activeView: ActiveView | undefined = input.selection?.viewMode
    ? {
        mode: input.selection.viewMode,
        ...(input.selection.viewMode === "understand"
          ? { documentId: input.selection.documentId }
          : {}),
        planIds: [...input.selection.planIds],
        tiers: {
          ...input.selection.legacyTiersByDocument,
          ...input.selection.tiers,
        },
      }
    : undefined;
  const activeDocuments = activeView
    ? new Set(viewDocumentIds(input.table, activeView))
    : null;
  const single = activeView
    ? activeView.mode === "understand"
    : input.table.documents.length === 1;
  pdf.setTitle(
    single ? "Insurance document summary" : "Insurance plan comparison",
  );
  pdf.setAuthor("Insurance Simplified");

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  // Track actual drawn content so a trailing page can never stay blank.
  let pageHasContent = true;

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageHasContent = false;
    y = PAGE_HEIGHT - MARGIN;
  };
  const write = (
    text: string,
    options: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      gap?: number;
      width?: number;
    } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.45;
    for (const line of wrap(
      text,
      font,
      size,
      options.width ?? TEXT_WIDTH - indent,
    )) {
      if (y < MARGIN + 30) addPage();
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font,
        color: options.color ?? INK,
      });
      pageHasContent = true;
      y -= lineHeight;
    }
    y -= options.gap ?? 3;
  };

  // ---- Title block with the approved logo -------------------------------
  let logoMerged = false;
  try {
    const logoBytes = await readFile(
      join(process.cwd(), "public", LOGO_FILE),
    ).catch(() => null);
    if (logoBytes) {
      const aspect = 223 / 256;
      const image = await pdf.embedPng(logoBytes);
      const height = LOGO_HEIGHT;
      const width = height * aspect;
      page.drawImage(image, { x: MARGIN, y: y - height, height, width });
      y -= height + 6;
    }
  } catch {
    // The logo is presentation-only; a missing asset never blocks the export.
  }
  const titleIndent = logoMerged ? 0 : 0;
  write(single ? "Insurance document summary" : "Insurance plan comparison", {
    font: bold,
    size: 19,
    gap: 10,
    indent: titleIndent,
  });
  write(
    "Based only on the supplied documents. Confirm important details with the insurer.",
    {
      color: MUTED,
      size: 9,
      gap: 6,
    },
  );
  write(`Generated ${new Date().toISOString().slice(0, 10)}`, {
    color: MUTED,
    size: 9,
    gap: 12,
  });

  write("Source documents", { font: bold, size: 12 });
  const sourceDocuments = activeView
    ? viewDocumentIds(input.table, activeView).flatMap((id) =>
        input.table.documents.filter((d) => d.documentId === id),
      )
    : input.table.documents;
  for (const doc of sourceDocuments) write(doc.filename, { size: 9 });
  y -= 8;
  const context = Object.entries(input.userContext).filter(([, value]) =>
    value.trim(),
  );
  if (context.length > 0) {
    write("Your details", { font: bold, size: 12 });
    for (const [key, value] of context) write(`${key}: ${value}`, { size: 9 });
    y -= 8;
  }

  if (activeView) {
    const spec = buildPresentation(input.table, activeView, {
      ...input.userContext,
    });
    const facts = new Map(
      indexFacts(input.table, activeView, { ...input.userContext }).map((f) => [f.id, f]),
    );
    for (const block of spec.blocks) {
      if (y < MARGIN + 95) addPage();
      write(block.heading, { font: bold, size: 13, gap: 8 });
      if (block.type === "contact-details") {
        const ids =
          activeView.mode === "compare"
            ? activeView.planIds
            : [activeView.documentId!];
        for (const id of ids) {
          const plan = input.table.plans?.find((p) => p.planId === id);
          const docIds = plan ? plan.sources.map((s) => s.documentId) : [id];
          write(
            plan?.name ??
              input.table.documents.find((d) => d.documentId === id)
                ?.filename ??
              "Policy information",
            { font: bold },
          );
          const contacts = (input.contacts ?? []).filter(
            (value): value is ContactHit => {
              if (!value || typeof value !== "object") return false;
              const c = value as Partial<ContactHit>;
              return (
                typeof c.documentId === "string" &&
                typeof c.value === "string" &&
                typeof c.quote === "string" &&
                typeof c.page === "number" &&
                ["email", "phone", "website"].includes(c.kind ?? "") &&
                docIds.includes(c.documentId) &&
                !!activeDocuments?.has(c.documentId) &&
                c.quote.includes(c.value) &&
                c.page > 0 &&
                c.page <=
                  (input.table.documents.find(
                    (d) => d.documentId === c.documentId,
                  )?.pageCount ?? 0)
              );
            },
          );
          if (!contacts.length)
            write("Contact information not verified.", { color: MUTED });
          for (const c of contacts) {
            write(`${c.purpose}: ${c.value}`);
            write(
              `Source: ${input.table.documents.find((d) => d.documentId === c.documentId)?.filename}, page ${c.page}`,
              { size: 8.5, color: MUTED },
            );
          }
        }
      }
      if (block.type === "unresolved-questions" && !facts.size)
        write(
          "No verified structured facts are available in this view. Check the original policy and ask the insurer.",
          { color: MUTED },
        );
      for (const question of block.display.questions ?? [])
        write(
          `${question.label}: ${question.field} is needed to review applicability. No answer assumed.`,
          { color: MUTED },
        );
      for (const id of block.factIds) {
        const fact = facts.get(id)!;
        const plan = input.table.plans?.find(
          (p) => p.planId === fact.scope.planIds[0],
        );
        write(
          `${fact.label}${plan ? ` - ${plan.name}` : ""}: ${fact.value.display}`,
          { size: 10, font: bold },
        );
        if (fact.state !== "verified-plan")
          write(
            fact.state === "unverified-applicability"
              ? "Unverified applicability: document evidence, not a confirmed plan benefit."
              : fact.state === "conflicting-evidence"
                ? "Conflicting evidence: confirm which value applies."
                : "Needs verification.",
            { size: 9, color: MUTED },
          );
        for (const interpretation of fact.interpretations) {
          write(`${interpretation.kind === "potential-conflict" ? "Potential conflict: " : ""}${interpretation.statement}`, { size: 9, color: MUTED });
          if (interpretation.question) write(interpretation.question, { size: 9, color: MUTED });
        }
        if (fact.value.qualifiers.planTier)
          write(`Tier: ${fact.value.qualifiers.planTier}`, {
            size: 9,
            color: MUTED,
          });
        for (const condition of conditionLines(fact.value))
          write(condition, { size: 9, color: MUTED });
        for (const evidence of fact.value.evidence)
          write(
            `Source: ${input.table.documents.find((d) => d.documentId === evidence.documentId)?.filename}, page ${evidence.page}`,
            { size: 8.5, color: MUTED },
          );
        y -= 5;
      }
      if (block.type === "comparison-table") {
        const concepts = new Set(
          block.factIds.map((id) => facts.get(id)!.concept),
        );
        for (const concept of concepts)
          for (const planId of activeView.planIds) {
            if (
              !block.factIds.some(
                (id) =>
                  facts.get(id)!.concept === concept &&
                  facts.get(id)!.scope.planIds.includes(planId),
              )
            )
              write(
                `${input.table.plans?.find((p) => p.planId === planId)?.name}: ${concept} - Not stated for the selected plan; not a denial.`,
                { size: 9, color: MUTED },
              );
          }
      }
      y -= 8;
    }
  } else {
    const planViews = buildPlanViews(input.table, input.selection);
    const titleFor = (view: PlanView): string =>
      view.tier ? `${view.label} (${view.tier})` : view.label;
    const scopeDocumentIds = new Set(
      planViews.flatMap((view) => [...view.documentIds]),
    );
    if (planViews.some((view) => !view.provenPlanId)) {
      write(
        "Unverified applicability: document evidence does not establish a confirmed plan benefit or purchased option.",
        { size: 9, color: MUTED, gap: 10 },
      );
    }

    // ---- Concise personalized overview -------------------------------------
    const overview = input.overview;
    if (overview) {
      if (y < MARGIN + 110) addPage();
      write("Your overview", { font: bold, size: 13, gap: 6 });
      const confirmed = planViews.some((view) => view.provenPlanId);
      write(
        confirmed
          ? overview.headline
          : "Plan applicability is unverified. Review the document evidence below.",
        { font: bold, size: 11, gap: 2 },
      );
      // At most the three high-impact findings the UI surfaces upfront.
      for (const item of (confirmed ? overview.initialItems : []).slice(0, 3)) {
        const main = [item.label, item.value].filter(Boolean).join(": ");
        write(main || (item.statement ?? ""), { size: 9.5 });
        if (item.statement && main)
          write(item.statement, { size: 9, color: MUTED });
        if (item.action)
          write(`Action: ${item.action}`, { size: 9, color: MUTED });
        const evidence = item.evidence[0];
        if (evidence) {
          const document = input.table.documents.find(
            (d) => d.documentId === evidence.documentId,
          );
          write(
            `Source: ${document?.filename ?? evidence.documentId}, page ${evidence.page}`,
            {
              size: 8.5,
              color: MUTED,
            },
          );
        }
      }
      y -= 8;
    }

    // ---- Key financial terms for the selected plans/tiers ------------------
    const costRows = planViews
      .map((view) => ({
        view,
        terms: KEY_COST_FACTS.map((factName) => {
          const row = input.table.rows.find((r) => r.factName === factName);
          if (!row) return null;
          const values = valuesForView(row, view);
          return values.length > 0 ? { factName, values } : null;
        }).filter(
          (
            t,
          ): t is {
            factName: (typeof KEY_COST_FACTS)[number];
            values: RegisteredCellValue[];
          } => t !== null,
        ),
      }))
      .filter((entry) => entry.terms.length > 0);
    if (costRows.length > 0) {
      if (y < MARGIN + 90) addPage();
      write("Key financial terms", { font: bold, size: 13, gap: 6 });
      for (const entry of costRows) {
        write(titleFor(entry.view), { font: bold, size: 10, gap: 2 });
        for (const term of entry.terms) {
          for (const value of term.values) {
            const tier = value.qualifiers.planTier
              ? ` (${value.qualifiers.planTier} tier)`
              : "";
            write(`${verifyLabelFor(term.factName)}${tier}: ${value.display}`, {
              size: 9.5,
            });
            for (const condition of conditionLines(value))
              write(condition, { size: 8.5, color: MUTED });
            // Citation adjacent to every number.
            write(sourceLine(input.table, value), { size: 8.5, color: MUTED });
          }
        }
      }
      y -= 8;
    }

    // ---- Five-section comparison (empty sections hidden) -------------------
    const workspace = buildWorkspaceGroups(
      input.table.rows,
      input.table.presentationGroups as never,
    );
    const multiView = planViews.length > 1;
    const columnGap = 20;
    const columnWidth = multiView
      ? Math.floor(
          (TEXT_WIDTH - (planViews.length - 1) * columnGap) / planViews.length,
        )
      : TEXT_WIDTH;

    const writeViewColumn = (
      view: PlanView,
      row: RegisteredComparisonTable["rows"][number],
      indent: number,
    ) => {
      write(titleFor(view), { font: bold, size: 9, indent });
      const values = valuesForView(row, view);
      if (values.length === 0) {
        write("Not stated in this document.", { color: MUTED, indent, gap: 8 });
        return;
      }
      for (const value of values) {
        const tier = value.qualifiers.planTier
          ? `${value.qualifiers.planTier}: `
          : "";
        write(`${tier}${value.display}`, { indent, width: columnWidth });
        for (const condition of conditionLines(value))
          write(condition, {
            indent,
            width: columnWidth,
            size: 8.5,
            color: MUTED,
          });
        write(sourceLine(input.table, value), {
          indent,
          color: MUTED,
          size: 8.5,
          gap: 8,
          width: columnWidth,
        });
      }
    };

    for (const sectionNode of workspace) {
      if (y < MARGIN + 100) addPage();
      write(sectionNode.section.title, { font: bold, size: 13, gap: 8 });
      for (const subgroup of sectionNode.subgroups) {
        write(subgroup.title, { font: bold, size: 10, gap: 4 });
        for (const row of subgroup.rows) {
          if (y < MARGIN + 95) addPage();
          write(
            `${verifyLabelFor(row.factName)}${
              row.verdict !== "SUPPORTED" && row.verdict !== "NOT STATED"
                ? ` - ${row.verdict}`
                : ""
            }`,
            { font: bold, size: 10.5, gap: 4 },
          );
          if (multiView) {
            // Compact table for up to three plans: columns share one band, and
            // every column keeps its own tier labels and citations.
            const startPage = page;
            const startY = y;
            writeViewColumn(planViews[0], row, 0);
            const columnEnd = y;
            for (let i = 1; i < planViews.length; i++) {
              if (page !== startPage && startY < MARGIN + 95) {
                // The first column crossed a page boundary: draw the rest
                // sequentially at full width so nothing is misplaced.
                y = Math.max(columnEnd, MARGIN + 30);
                writeViewColumn(planViews[i], row, 0);
              } else {
                y = startY;
                writeViewColumn(
                  planViews[i],
                  row,
                  MARGIN - MARGIN + i * (columnWidth + columnGap),
                );
              }
            }
            y = Math.min(y, columnEnd);
          } else {
            writeViewColumn(planViews[0], row, 0);
          }
          y -= 7;
        }
      }
    }

    // Keep source-backed but plan-unassigned material risks in a separate
    // document-evidence area, never smuggled into a confirmed plan column.
    const unassigned = input.table.rows.flatMap((row) =>
      row.values
        .filter(
          (value) =>
            scopeDocumentIds.has(value.documentId) &&
            (!value.planId ||
              !input.table.plans?.some(
                (plan) => plan.planId === value.planId,
              )) &&
            planViews.some(
              (view) =>
                view.documentIds.includes(value.documentId) &&
                (!view.tier ||
                  !value.qualifiers.planTier ||
                  tierKey(view.tier) === tierKey(value.qualifiers.planTier)),
            ),
        )
        .map((value) => ({ factName: row.factName, value })),
    );
    if (unassigned.length > 0 && planViews.some((view) => view.provenPlanId)) {
      if (y < MARGIN + 100) addPage();
      write("Document evidence requiring verification", {
        font: bold,
        size: 13,
        gap: 8,
      });
      write(
        "Unverified applicability: these source facts are not confirmed benefits or costs of the selected plans.",
        { size: 9, color: MUTED, gap: 6 },
      );
      for (const { factName, value } of unassigned) {
        write(`${verifyLabelFor(factName)}: ${value.display}`, { size: 9.5 });
        if (value.qualifiers.planTier)
          write(`Tier: ${value.qualifiers.planTier}`, {
            size: 9,
            color: MUTED,
          });
        write(sourceLine(input.table, value), { size: 8.5, color: MUTED });
        for (const evidence of value.evidence)
          write(`Source wording: ${evidence.quote}`, {
            size: 8.5,
            color: MUTED,
            gap: 6,
          });
      }
    }

    // ---- Verify before enrolling (scoped) ----------------------------------
    const documents = input.table.documents.filter(
      (doc) => !input.selection || scopeDocumentIds.has(doc.documentId),
    );
    const questions = buildVerifyItems(
      input.table.rows as never,
      documents,
      (id) =>
        titleFor(
          planViews.find((view) => view.documentIds.includes(id)) ??
            planViews[0],
        ),
    ).filter(
      (item) =>
        item.documentId === null || scopeDocumentIds.has(item.documentId),
    );
    if (questions.length > 0) {
      if (y < MARGIN + 95) addPage();
      write("Verify before enrolling", { font: bold, size: 13, gap: 8 });
      for (const item of questions) {
        write(item.text, { size: 9 });
        if (item.citation) {
          const source = input.table.documents.find(
            (doc) => doc.documentId === item.citation?.documentId,
          );
          if (source)
            write(`Source: ${source.filename}, page ${item.citation.page}`, {
              color: MUTED,
              size: 8.5,
            });
        }
      }
    }
  }
  // A section addPage check can only create a page immediately before new
  // content; nothing is drawn afterwards, so a blank trailing page is
  // possible exactly when the last drawn action moved to a fresh page and
  // nothing followed — remove that page defensively.
  if (pdf.getPageCount() > 1 && !pageHasContent) {
    pdf.removePage(pdf.getPageCount() - 1);
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) =>
    sheet.drawText(`Insurance Simplified  |  ${index + 1} / ${pages.length}`, {
      x: MARGIN,
      y: 24,
      size: 8,
      font: regular,
      color: MUTED,
    }),
  );
  return pdf.save();
}
