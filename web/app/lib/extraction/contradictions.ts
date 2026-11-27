// Pure same-document/same-plan/same-scope contradiction rule shared by
// extraction and rendering. Never equate values from different documents.
export const SCOPE_KEYS = ["planTier", "networkTier", "period", "ageBand", "conditions", "currency", "frequency"] as const;

/** Scope-bearing words that are not always captured in explicit qualifiers
 *  (e.g. "emergency dental" vs "routine dental" within the same fact).
 *  Sorted labels keep the generated scope key stable. */
const APPLICABILITY_SCOPE_TERMS = [
  { label: "accidental", pattern: /\baccidental\b/i },
  { label: "basic", pattern: /\bbasic\b/i },
  { label: "diagnostic", pattern: /\bdiagnostic\b/i },
  { label: "emergency", pattern: /\bemergency\b/i },
  { label: "endodontic", pattern: /\bendodontic\b/i },
  { label: "injury", pattern: /\binjury\b/i },
  { label: "in-network", pattern: /\bin[-\s]?network\b/i },
  { label: "major", pattern: /\bmajor\b/i },
  { label: "medical", pattern: /\bmedical\b/i },
  { label: "oral-surgery", pattern: /\boral\s+surgery\b/i },
  { label: "orthodontic", pattern: /\borthodontic\b/i },
  { label: "out-of-network", pattern: /\bout[-\s]?of[-\s]?network\b/i },
  { label: "periodontic", pattern: /\bperiodontic\b/i },
  { label: "preventive", pattern: /\bprevent(?:ive|ative)\b/i },
  { label: "restorative", pattern: /\brestorative\b/i },
  { label: "routine", pattern: /\broutine\b/i },
  { label: "surgical", pattern: /\bsurgical\b/i },
  { label: "urgent", pattern: /\burgent\b/i },
] as const;

export function scopeSignature(qualifiers: unknown): string {
  const q = typeof qualifiers === "object" && qualifiers !== null
    ? qualifiers as Record<string, unknown> : {};
  return SCOPE_KEYS.map((k) => {
    const v = q[k];
    return typeof v === "string" ? v.toLowerCase().trim() : "";
  }).join("|");
}

function quoteList(value: { evidence?: readonly unknown[] }): string[] {
  const e = value.evidence;
  if (!Array.isArray(e)) return [];
  return e.map((entry) => {
    if (typeof entry === "object" && entry !== null) {
      const q = entry as Record<string, unknown>;
      return typeof q.quote === "string" ? q.quote : "";
    }
    return "";
  });
}

function isTableCell(value: { anchor?: unknown }): boolean {
  return (value.anchor as { kind?: unknown } | undefined)?.kind === "table-cell";
}

/** Derive an implicit applicability scope from the value display and its
 *  evidence. This catches scope differences that extraction did not turn into
 *  explicit qualifiers (e.g. emergency vs routine dental). */
export function benefitScope(
  value: { display?: unknown; evidence?: readonly unknown[]; anchor?: unknown },
  structuralQuotes: ReadonlySet<string> = new Set(),
): string {
  // A table cell's scope is structural (EC-3/EC-4): its own column heading
  // and governing notes, which its display already carries. Its evidence also
  // cites the whole header line, whose NEIGHBOURING headings are other
  // columns' scopes — never this cell's. For any other value, quotes that
  // are a compared table cell's own evidence (e.g. that header line) are that
  // table's structure, not the value's stated scope.
  const quotes = isTableCell(value) ? [] : quoteList(value).filter((q) => !structuralQuotes.has(q));
  const text = `${String(value.display ?? "")} ${quotes.join(" ")}`;
  const found = APPLICABILITY_SCOPE_TERMS
    .filter((term) => term.pattern.test(text))
    .map((term) => term.label);
  return [...new Set(found)].sort().join("|");
}

/** Full scope key used for contradiction and disagreement grouping. */
export function applicabilityScopeKey(
  value: { qualifiers: unknown; display?: unknown; evidence?: readonly unknown[]; anchor?: unknown },
  structuralQuotes?: ReadonlySet<string>,
): string {
  return `${scopeSignature(value.qualifiers)}|${benefitScope(value, structuralQuotes)}`;
}

/** Evidence quotes of the table cells in a compared pair. */
function pairStructuralQuotes(a: { evidence?: readonly unknown[]; anchor?: unknown }, b: { evidence?: readonly unknown[]; anchor?: unknown }): Set<string> {
  return new Set([a, b].filter(isTableCell).flatMap(quoteList).filter(Boolean));
}

function tableLabel(value: { anchor?: unknown }): string | undefined {
  const anchor = value.anchor as { kind?: unknown; label?: unknown } | undefined;
  return anchor?.kind === "table-cell" && typeof anchor.label === "string"
    ? anchor.label.trim().toLowerCase().replace(/\s+/g, " ")
    : undefined;
}

export function hasSameScopeContradiction(
  values: { documentId: unknown; planId?: unknown; display: unknown; qualifiers: unknown; evidence?: readonly unknown[]; anchor?: unknown }[],
): boolean {
  const normalize = (display: string) => display.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, "");
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i];
      const b = values[j];
      if (a.documentId !== b.documentId) continue;
      // An absent plan ID is document/unknown scope, not proof that a fact
      // belongs to whichever named plan happens to share the same PDF.
      if (a.planId !== b.planId) continue;
      // Two table cells from differently-labelled rows are different
      // provisions ("Maternity Care" vs "Therapeutic Termination of
      // Pregnancy"), not rival values for one scope.
      const la = tableLabel(a);
      const lb = tableLabel(b);
      if (la !== undefined && lb !== undefined && la !== lb) continue;
      const structural = pairStructuralQuotes(a, b);
      if (applicabilityScopeKey(a, structural) !== applicabilityScopeKey(b, structural)) continue;
      if (typeof a.display !== "string" || typeof b.display !== "string") continue;
      if (normalize(a.display) !== normalize(b.display)) return true;
    }
  }
  return false;
}
