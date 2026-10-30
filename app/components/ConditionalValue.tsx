"use client";

import React, { Fragment } from "react";
import type { Qualifiers, RegisteredCellValue } from "@/app/lib/extraction/types";
import { moneyAmounts, conditionBindingKnown } from "@/app/lib/extraction/conditions";
import { summarizeNetworkDisplay } from "@/app/lib/extraction/network-display";
import { documentUrl } from "@/app/lib/document-url";
import { sourcedQualifiers } from "@/app/lib/extraction/qualifier-evidence";

/** V1.1 M2 task 6: one material value, rendered with the conditions needed to
 *  understand it beside the amount, its original-page citation intact, and an
 *  explicit question when the source never says which figure applies. Nothing
 *  here invents a label — every note is a qualifier the extractor bound from
 *  the source, or an honest statement of what is not stated. */

const UNRESOLVED_PROMPT =
  "Unresolved: which amount applies? Confirm the applicable figure against the source page.";

interface Note {
  text: string;
  /** The user's own age lands inside this band (presentation only). */
  match?: boolean;
}

/** True only when the band provably brackets the user's age: numeric bounds,
 *  an explicit "25-29" range, or the exact figure. Never guesses from prose
 *  like "Under 25", which would claim a match the source does not support. */
function ageBandMatches(q: Qualifiers, ageText?: string): boolean {
  const raw = (ageText ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return false;
  const age = Number(raw);
  if (typeof q.ageMin === "number" && typeof q.ageMax === "number") {
    return age >= q.ageMin && age <= q.ageMax;
  }
  const band = (q.ageBand ?? "").trim();
  const range = /^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/.exec(band);
  if (range) return age >= Number(range[1]) && age <= Number(range[2]);
  return band === raw;
}

/** Display per-figure network labels only when the source associates every
 * percentage with its own named scope. A single network qualifier is not a
 * label for a whole slash-separated sequence. */
function networkPercentages(value: RegisteredCellValue): string[] {
  const figures = value.display.match(/\d+(?:\.\d+)?\s*%/g) ?? [];
  if (figures.length < 2) return [];
  for (const evidence of value.evidence) {
    const parts = evidence.quote.split(/\s*(?:\/|;|\band\b)\s*/i)
      .filter((part) => /\d+(?:\.\d+)?\s*%/.test(part));
    if (parts.length !== figures.length) continue;
    const labels = figures.map((figure, index) => {
      const part = parts[index];
      const matches = part.match(/\d+(?:\.\d+)?\s*%/g) ?? [];
      if (matches.length !== 1 || matches[0].replace(/\s+/g, "") !== figure.replace(/\s+/g, "")) return undefined;
      const scopes = part.match(/(?:^|[^a-z-])(in-network|out-of-network)\b/gi) ?? [];
      return scopes.length === 1 ? /out-of-network/i.test(scopes[0]) ? "out-of-network" : "in-network" : undefined;
    });
    if (labels.every(Boolean)) return figures.map((figure, index) => `${figure.trim()} ${labels[index]}`);
  }
  return [];
}

/** Compact condition notes, each skipped when the rendered value already says
 *  it (raw source line and concise text both count), so a qualifier is never
 *  dropped and never repeated as noise lifted out of the display. A concise
 *  network cell renders only its scope: everything else on that source line
 *  belongs to the evidence, not to the network identity. */
function conditionNotes(
  rawDisplay: string,
  displayText: string,
  q: Qualifiers,
  userAge?: string,
  concise = false,
  showTierQualifier = true,
): Note[] {
  const stated = (raw: string) =>
    (concise ? "" : rawDisplay).toLowerCase().includes(raw.toLowerCase()) ||
    displayText.toLowerCase().includes(raw.toLowerCase());
  const notes: Note[] = [];
  // A network scope that swallows dollar amounts is extraction noise, not a
  // network condition; the full source line stays available in evidence.
  if (q.networkTier && !stated(q.networkTier) && !q.networkTier.includes("$")) {
    notes.push({ text: `Network: ${q.networkTier}` });
  }
  if (concise) return notes;
  if (showTierQualifier && q.planTier && !stated(q.planTier)) {
    notes.push({ text: `Tier: ${q.planTier}` });
  }
  // A bare number is a figure lifted out of the display, not an age band;
  // showing it would claim a condition the source never states.
  const bandIsReadable = (band: string) =>
    /[a-z]/i.test(band) || /[-–—]/.test(band);
  if (q.ageBand && !stated(q.ageBand) && bandIsReadable(q.ageBand)) {
    const match = ageBandMatches(q, userAge);
    notes.push({
      text: match
        ? `Ages: ${q.ageBand} · matches your age ${userAge!.trim()}`
        : `Ages: ${q.ageBand}`,
      match,
    });
  }
  if (q.period && !stated(q.period)) notes.push({ text: q.period });
  if (q.frequency && !stated(q.frequency)) {
    notes.push({ text: `Billed ${q.frequency}` });
  }
  if (q.currency && !stated(q.currency)) {
    notes.push({ text: `Currency: ${q.currency}` });
  }
  if (q.costType && !stated(q.costType)) notes.push({ text: q.costType });
  if (q.selectionStatus === "purchased") {
    notes.push({ text: "Purchased option stated by the source." });
  } else if (q.selectionStatus === "selectable") {
    notes.push({
      text: "Available options — your purchased option is not stated.",
    });
  } else if (moneyAmounts(displayText) >= 2) {
    // Several dollar figures and no attested choice: the document lists
    // amounts without proving which one the member bought (spec I).
    notes.push({
      text: "Your purchased option is unknown (not stated in the document).",
    });
  }
  return notes;
}

export interface ConditionalValueProps {
  value: RegisteredCellValue;
  /** Row fact label, used for the accessible source link name. */
  factLabel: string;
  /** Plan/document display name behind this cell's source link. */
  documentName: string;
  sessionId: string;
  userContext?: Record<string, string>;
  /** Network row: show the concise network identity instead of the line. */
  concise?: boolean;
  /** Append the in/out-of-network scope the source states beside the figure. */
  numericScope?: boolean;
  /** Hide a repeated tier note when the containing table group labels that tier. */
  showTierQualifier?: boolean;
}

export default function ConditionalValue({
  value,
  factLabel,
  documentName,
  sessionId,
  userContext,
  concise = false,
  numericScope = false,
  showTierQualifier = true,
}: ConditionalValueProps) {
  const q = sourcedQualifiers(value);
  const primary = value.evidence[0];
  const base = concise ? summarizeNetworkDisplay(value.display) : value.display;
  const scope = numericScope && primary
    ? (["in-network", "out-of-network"] as const).find((s) =>
        primary.quote.toLowerCase().includes(`${value.display.trim().toLowerCase()} ${s}`),
      )
    : undefined;
  const displayText = scope ? `${base} ${scope}` : base;

  const known = conditionBindingKnown({ ...value, qualifiers: q });
  const networkNotes = known ? networkPercentages(value) : [];
  const notes = conditionNotes(value.display, displayText,
    known && networkNotes.length === 0 ? q : { ...q, networkTier: undefined, ageBand: known ? q.ageBand : undefined }, userContext?.age, concise, showTierQualifier);

  return (
    <Fragment>
      {primary ? (
        <a
          className="cell-value"
          href={documentUrl(sessionId, value.documentId, documentName, primary.page, primary.evidenceId)}
          target="_blank"
          rel="noopener"
          title={`View source evidence for ${factLabel} — ${documentName}, page ${primary.page}`}
          aria-label={`View source evidence for ${factLabel} — ${documentName}, page ${primary.page}`}
        >
          {displayText}
        </a>
      ) : (
        <span className="cell-value">{displayText}</span>
      )}
      {notes.map((note, i) => (
        <span
          key={i}
          className={note.match ? "cell-condition cell-condition--match" : "cell-condition"}
        >
          {note.text}
        </span>
      ))}
      {networkNotes.map((text) => (
        <span key={text} className="cell-condition">{text}</span>
      ))}
      {!known && (
        <span className="cell-condition cell-condition--question" role="note">
          {UNRESOLVED_PROMPT}
        </span>
      )}
      {q.conditions && (
        <details className="cell-detail">
          <summary>Conditions</summary>
          <span>{q.conditions}</span>
        </details>
      )}
    </Fragment>
  );
}
