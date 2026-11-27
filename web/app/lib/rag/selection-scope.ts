// Deterministic selected-scope restriction for chat retrieval (M5 task 17).
//
// Scope-before-retrieval: only passages inside the validated selected plan
// scope plus evidenced shared policy text may reach the answering engines.
// The restriction is computed from the SERVER-side validated table — never
// from model output — and the widening rule mirrors the product constraint:
// a question that explicitly names exactly one other proven plan may widen
// to that plan only when it exists in the validated table (i.e. "supported");
// anything ambiguous stays scoped and the normal unsupported-answer refusal
// applies.
//
// The masking produces agents (RagDocument copies) whose ineligible lines are
// removed while eligible lines stay verbatim, so every later citation still
// verifies byte-for-byte against the session documents (fail-closed chain is
// untouched). Legacy tables without proven plans scope whole documents —
// their synthetic plan views ARE documents.

import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { hasProvenPlans } from "@/app/lib/extraction/selection-request";
import { planMentionPattern } from "@/app/lib/extraction/plan-identity";
import type { RagDocument } from "@/app/lib/rag/answer";
import type { ActiveView } from "@/app/lib/presentation/adaptive";

function namedPlans(
  line: string,
  plans: RegisteredComparisonTable["plans"],
): Map<string, string> {
  const found = new Map<string, string>();
  for (const plan of plans ?? []) {
    const pattern = planMentionPattern(plan.name);
    if (pattern?.test(line)) found.set(plan.planId, plan.name);
  }
  return found;
}

/** Plans the question explicitly names (word-boundary) that are not already
 *  selected. Widening requires the mention to pick out exactly ONE other
 *  plan unambiguously; its presence in the validated table is the
 *  "supported" condition, checked by the caller's scope validation. */
export function widenedPlanIds(
  question: string,
  table: RegisteredComparisonTable,
  selectedPlanIds: string[],
): string[] {
  const selected = new Set(selectedPlanIds);
  const named = new Set<string>();
  for (const plan of table.plans ?? []) {
    const pattern = planMentionPattern(plan.name);
    if (!pattern || selected.has(plan.planId)) continue;
    if (pattern.test(question)) named.add(plan.planId);
  }
  return named.size === 1 ? [...named] : [];
}

function documentHasSharedRows(
  table: RegisteredComparisonTable,
  documentId: string,
): boolean {
  return table.rows.some((row) =>
    row.values.some(
      (value) => value.documentId === documentId && !value.planId,
    ),
  );
}

export interface ChatScope {
  /** Session documents restricted to the selected scope; ineligible lines removed. */
  documents: RagDocument[];
  /** True when the question explicitly named exactly one other proven plan. */
  widened: boolean;
}

export function scopeDocumentsForChat(
  documents: readonly RagDocument[],
  table: RegisteredComparisonTable,
  selectedPlanIds: string[],
  question: string,
  view?: ActiveView,
): ChatScope {
  // Explicit active views never widen: a question is not authorization.
  if (view) {
    const ids = new Set(
      view.mode === "understand"
        ? [view.documentId]
        : (table.plans
            ?.filter((p) => selectedPlanIds.includes(p.planId))
            .flatMap((p) => p.sources.map((s) => s.documentId)) ??
            selectedPlanIds),
    );
    const scoped = documents
      .filter((d) => ids.has(d.documentId))
      .map((doc) => {
        const plans =
          table.plans?.filter((p) =>
            p.sources.some((s) => s.documentId === doc.documentId),
          ) ?? [];
        if (
          !plans.length &&
          view.mode === "understand" &&
          !view.tiers[doc.documentId]
        )
          return doc;
        const quotes = new Map<number, string[]>();
        const add = (page: number, quote: string) =>
          quotes.set(page, [...(quotes.get(page) ?? []), quote]);
        for (const row of table.rows)
          for (const value of row.values) {
            if (
              value.documentId !== doc.documentId ||
              (!value.planId && selectedPlanIds.length > 0) ||
              (value.planId && !selectedPlanIds.includes(value.planId))
            )
              continue;
            const tier =
              view.tiers[
                value.planId ??
                  (view.mode === "understand" && selectedPlanIds.length === 1
                    ? selectedPlanIds[0]
                    : doc.documentId)
              ];
            if (
              tier &&
              value.qualifiers.planTier &&
              tier.toLowerCase() !==
                value.qualifiers.planTier.trim().toLowerCase()
            )
              continue;
            for (const e of value.evidence)
              if (e.documentId === doc.documentId) add(e.page, e.quote);
          }
        for (const p of plans.filter((p) => selectedPlanIds.includes(p.planId)))
          for (const s of p.sources)
            if (s.documentId === doc.documentId) add(s.page, s.quote);
        // Keep only verified source spans, not unnamed following lines of an
        // unselected plan in a mixed-plan PDF. Page numbering stays unchanged.
        return {
          ...doc,
          pages: doc.pages.map((page, index) => {
            const allowed = new Uint8Array(page.length);
            for (const quote of quotes.get(index + 1) ?? []) {
              const at = page.indexOf(quote);
              if (at >= 0) allowed.fill(1, at, at + quote.length);
            }
            return page
              .split("")
              .map((char, i) => (allowed[i] || char === "\n" ? char : " "))
              .join("");
          }),
        };
      });
    return { documents: scoped, widened: false };
  }
  const widenedIds = widenedPlanIds(question, table, selectedPlanIds);
  if (widenedIds.length > 0)
    selectedPlanIds = [...selectedPlanIds, ...widenedIds];
  const selected = new Set(selectedPlanIds);

  if (!hasProvenPlans(table)) {
    // Legacy representation: selected plans ARE documents; only their own
    // pages are eligible (document-specific V1 view, no cross-doc sharing).
    const docs = documents.filter((doc) => selected.has(doc.documentId));
    return { documents: docs, widened: widenedIds.length > 0 };
  }

  const plans = table.plans ?? [];
  const scoped = documents
    .map((doc) => {
      // Document membership is proven by plan-name declarations in the page
      // content only — filenames are never plan identity (Phase B).
      const docPlans: string[] = [];
      for (const page of doc.pages) {
        for (const id of namedPlans(page, plans).keys()) {
          if (!docPlans.includes(id)) docPlans.push(id);
        }
      }
      const ownSelected = docPlans.filter((id) => selected.has(id));
      if (docPlans.length === 0) {
        // No proven plan is recognizable in this document: it can only be
        // shared policy information, and only when the validated table
        // carries unattributed (shared-scope) rows for it.
        return documentHasSharedRows(table, doc.documentId) ? doc : null;
      }
      if (docPlans.every((id) => selected.has(id))) return doc;
      if (ownSelected.length === 0) return null;
      // Mixed document: keep only lines inside the selected scope (shared
      // text and lines naming selected plans stay verbatim).
      const pages = doc.pages.map((page) =>
        page
          .split(/\r?\n/)
          .filter((line) => {
            const named = namedPlans(line, plans);
            if (named.size === 0) return true;
            return [...named.keys()].every((id) => selected.has(id));
          })
          .join("\n"),
      );
      return { ...doc, pages };
    })
    .filter((doc): doc is RagDocument => doc !== null);
  return { documents: scoped, widened: widenedIds.length > 0 };
}
