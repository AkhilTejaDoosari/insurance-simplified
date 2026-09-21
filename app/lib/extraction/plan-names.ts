// Plan name extraction utilities.
// Per USER_FLOWS.md: "Do not use raw PDF filenames as primary plan names.
// Use confidently extracted product/plan names. Show filename only as secondary
// source metadata. If no reliable plan name exists: use a cleaned filename fallback.
// Never invent a plan name."

/** Clean a PDF filename into a reasonable display name fallback.
 *  Strips .pdf extension, common prefixes/suffixes, and normalizes separators. */
export function cleanFilenameForDisplay(filename: string): string {
  let name = filename.replace(/\.pdf$/i, "");
  // Remove common document-type prefixes
  name = name.replace(/^(plan|policy|summary|schedule|brochure|benefit)[-_]\s*/i, "");
  // Replace underscores, hyphens with spaces
  name = name.replace(/[-_]+/g, " ");
  // Remove common suffixes like dates, versions
  name = name.replace(/\s*(20\d{2}|v\d+|final|draft|copy)\s*$/i, "");
  // Collapse multiple spaces
  name = name.replace(/\s+/g, " ").trim();
  // Title case
  name = name
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(" ");
  return name || "Unnamed Plan";
}

/** Extract a plan name from document text if confidently present.
 *  Returns null if no reliable name can be determined (caller should use fallback).
 *  This is a stub — real extraction would use NLP/patterns on the first few pages. */
export function extractPlanNameFromText(_pages: string[]): string | null {
  // TODO: Implement actual plan name extraction from document content.
  // For now, return null to signal "not confident" and use filename fallback.
  return null;
}

/** Get the display name for a plan: extracted name if confident, else cleaned filename. */
export function getPlanDisplayName(
  document: { filename: string; pages?: string[] }
): { name: string; source: "extracted" | "filename" } {
  if (document.pages) {
    const extracted = extractPlanNameFromText(document.pages);
    if (extracted) return { name: extracted, source: "extracted" };
  }
  return { name: cleanFilenameForDisplay(document.filename), source: "filename" };
}