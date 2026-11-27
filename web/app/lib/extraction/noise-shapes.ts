// Source-line shapes that name or define a topic without stating a plan's
// provision: table-of-contents/index entries and glossary definitions.
// Shared by the Stage E inferred-ownership guard (plan-identity.ts) and the
// route's post-Stage-E display filter. Pure and deterministic.

/** A line stating an amount or percentage is never treated as navigation or
 *  glossary text: schedule-of-benefits rows may use dot leaders or labels. */
const AMOUNT_OR_PERCENT = /\$\s?\d|\d\s*%/;

/** A dot leader ending the line, optionally followed by page numbers/ranges
 *  ("....29", "....54-55, 121", "...51-52"). */
const TOC_ENTRY =
  /(?:\.{5,}\s*|\.{3,}\s*(?=\d))(?:(?:pages?\s*)?\d{1,3}(?:\s*[-–]\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*)?\s*$/i;

/** "Term: A/An/Any …" or "Title Case Term: The …". */
const GLOSSARY_ENTRY = /^([A-Z][A-Za-z0-9 ()'/&-]{1,60}?):\s+(A|An|Any|The)\s+[a-z]/;
const TITLE_SMALL_WORDS = new Set(["of", "and", "or", "the", "in", "for", "to", "a", "an", "on"]);

export function isTocEntryLine(line: string): boolean {
  return !AMOUNT_OR_PERCENT.test(line) && TOC_ENTRY.test(line);
}

/** Definition lead in any capitalization ("Term: the/The/THE/A/An/Any word"),
 *  where the article is followed by a word, not an amount. */
const GLOSSARY_LEAD = /^([A-Z][A-Za-z0-9 ()'/&-]{1,60}?):\s+(a|an|any|the)\s+[A-Za-z]/i;

/** Ownership-strength check: true when the line OPENS as a glossary
 *  definition, regardless of any amount, percentage or number later in the
 *  line. An amount elsewhere cannot turn a definition into a provision
 *  ("Telehealth: The distribution of … Administrative fee: $100."). A schedule
 *  entry whose label is followed directly by an amount ("Deductible: $500",
 *  "Coinsurance: 80% …") never matches. "The" leads require a Title Case or
 *  ALL-CAPS term, so lowercase labels ("Not covered: The services…") do not. */
export function hasGlossaryLead(line: string): boolean {
  const lead = line.trim().match(GLOSSARY_LEAD);
  if (!lead) return false;
  if (lead[2].toLowerCase() !== "the") return true;
  return lead[1].split(/\s+/).every((word, i) =>
    /^[([]?[A-Z0-9]/.test(word) || (i > 0 && TITLE_SMALL_WORDS.has(word.toLowerCase()))
  );
}

/** Display-filter check (post-Stage-E): only lines with no amount at all are
 *  dropped, so an amount-bearing line stays visible as unattributed evidence.
 *  Lowercase labels such as "Not covered: The services listed below…" are not
 *  glossary terms and are never matched. */
export function isGlossaryDefinitionLine(line: string): boolean {
  if (AMOUNT_OR_PERCENT.test(line)) return false;
  const glossary = line.match(GLOSSARY_ENTRY);
  if (!glossary) return false;
  if (glossary[2] !== "The") return true;
  return glossary[1].split(/\s+/).every((word, i) =>
    /^[([]?[A-Z0-9]/.test(word) || (i > 0 && TITLE_SMALL_WORDS.has(word))
  );
}
