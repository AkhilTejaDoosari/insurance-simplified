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

function evidenceQuotes(value: { evidence?: readonly unknown[] }): string {
  const e = value.evidence;
  if (!Array.isArray(e)) return "";
  return e
    .map((entry) => {
      if (typeof entry === "object" && entry !== null) {
        const q = entry as Record<string, unknown>;
        return typeof q.quote === "string" ? q.quote : "";
      }
      return "";
    })
    .join(" ");
}

/** Derive an implicit applicability scope from the value display and its
 *  evidence. This catches scope differences that extraction did not turn into
 *  explicit qualifiers (e.g. emergency vs routine dental). */
export function benefitScope(value: { display?: unknown; evidence?: readonly unknown[] }): string {
  const text = `${String(value.display ?? "")} ${evidenceQuotes(value)}`;
  const found = APPLICABILITY_SCOPE_TERMS
    .filter((term) => term.pattern.test(text))
    .map((term) => term.label);
  return [...new Set(found)].sort().join("|");
}

/** Full scope key used for contradiction and disagreement grouping. */
export function applicabilityScopeKey(
  value: { qualifiers: unknown; display?: unknown; evidence?: readonly unknown[] },
): string {
  return `${scopeSignature(value.qualifiers)}|${benefitScope(value)}`;
}

export function hasSameScopeContradiction(
  values: { documentId: unknown; planId?: unknown; display: unknown; qualifiers: unknown; evidence?: readonly unknown[] }[],
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
      if (applicabilityScopeKey(a) !== applicabilityScopeKey(b)) continue;
      if (typeof a.display !== "string" || typeof b.display !== "string") continue;
      if (normalize(a.display) !== normalize(b.display)) return true;
    }
  }
  return false;
}
