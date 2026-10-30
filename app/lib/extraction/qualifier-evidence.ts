// A verified quote for a value is not proof of every proposed qualifier.
// Only retain a material condition when that quote actually associates it
// with the cited figure. This is a pure shape/claim check; page verification
// still belongs to the existing session boundary.
import type { CellValue, Qualifiers } from "@/app/lib/extraction/types";

export const MATERIAL_QUALIFIERS = ["networkTier", "ageBand", "currency", "frequency", "conditions"] as const;
type MaterialQualifier = typeof MATERIAL_QUALIFIERS[number];

/** Tier names the fallback/header parser recognises. Replicated here to keep
 *  this module free of circular imports with the extraction pipeline. */
const TIER_NAME_PATTERN =
  /\b(elite|select|budget|smart|lite|plus|platinum|gold|silver|bronze|basic|enhanced|premium|standard|choice|reliable|ultimate|supreme|premier)\b/gi;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wording(key: MaterialQualifier, raw: string): RegExp {
  const text = raw.trim();
  if (key === "currency") {
    const names: Record<string, string> = {
      EUR: "\\bEUR\\b|€", GBP: "\\bGBP\\b|£", JPY: "\\bJPY\\b|¥",
      INR: "\\bINR\\b|₹", CAD: "\\bCAD\\b|C\\$", AUD: "\\bAUD\\b|A\\$",
      USD: "\\bUSD\\b|\\bUS dollars?\\b",
    };
    return new RegExp(names[text.toUpperCase()] ?? `\\b${escaped(text)}\\b`, "i");
  }
  if (key === "frequency") {
    if (/^(monthly|per month|\/mo)$/i.test(text)) return /\bmonthly\b|\bper\s+month\b|\/mo(?:nth)?\b/i;
    if (/^(annual|annually|yearly|per year|\/yr)$/i.test(text)) return /\bannual(?:ly)?\b|\byearly\b|\bper\s+year\b|\/yr\b/i;
  }
  if (key === "ageBand") {
    const range = /^(?:ages?\s*)?(\d+)\s*[-–—]\s*(\d+)$/i.exec(text);
    if (range) return new RegExp(`\\b(?:ages?\\s*)?${range[1]}\\s*[-–—]\\s*${range[2]}\\b`, "i");
  }
  if (key === "networkTier" && /\bin-network\b|\bout-of-network\b/i.test(text)) {
    const scopes = ["in-network", "out-of-network"].filter((s) =>
      new RegExp(`(?:^|[^a-z-])${s}\\b`, "i").test(text));
    return new RegExp(scopes.map((s) => `(?:^|[^a-z-])${s}\\b`).join("[\\s\\S]*"), "i");
  }
  return new RegExp(`(?:^|[^a-z0-9])${escaped(text)}(?:$|[^a-z0-9])`, "i");
}

function mentionsValue(clause: string, display: string): boolean {
  const figures = display.match(/\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/g) ?? [];
  if (figures.length === 0) return true; // textual network/age/eligibility facts
  return figures.some((figure) => {
    const number = figure.replace(/[^\d.]/g, "").replace(/(?<=\d),(?=\d)/g, "");
    return new RegExp(`(?:^|[^\\d])${escaped(number)}(?![\\d])`).test(clause.replace(/(?<=\d),(?=\d)/g, ""));
  });
}

/** Check a material qualifier against the same source clause as the value. */
export function qualifierHasEvidence(value: Pick<CellValue, "display" | "evidence">, key: MaterialQualifier, qualifier: string): boolean {
  if (!qualifier.trim()) return false;
  const pattern = wording(key, qualifier);
  return value.evidence.some((e) => e.quote.split(/\.(?!\d)|[!?;\n]+/).some((clause) => {
    if (!mentionsValue(clause, value.display)) return false;
    const displayFigures = value.display.match(/\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/g) ?? [];
    const citedFigures = clause.match(/\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/g) ?? [];
    if (displayFigures.length === 1 && citedFigures.length > 1) {
      // A qualifier elsewhere in a multi-figure line does not attach to
      // this value. Repeated amounts need the same condition in every slice.
      const slices = clause.split(/\s*(?:\/|\band\b)\s*/i).filter((part) => mentionsValue(part, value.display));
      return slices.length > 0 && slices.every((part) => pattern.test(part));
    }
    return pattern.test(clause);
  }));
}

/** Remove only unsupported claims; keep the amount and its original evidence. */
export function sourcedQualifiers(value: Pick<CellValue, "display" | "evidence" | "qualifiers">): Qualifiers {
  const qualifiers = { ...value.qualifiers };
  for (const key of MATERIAL_QUALIFIERS) {
    const bound = qualifiers[key];
    if (bound !== undefined && !qualifierHasEvidence(value, key, bound)) delete qualifiers[key];
  }
  return qualifiers;
}

interface DocumentPages {
  documentId: string;
  pages: readonly string[];
}

/** Check qualifiers that need document-wide evidence rather than a single-clause
 *  substring match. A `planTier` is kept only when the document contains a tier
 *  header naming that tier (deterministic fallback or LLM tier table). */
export function qualifierSupportedByDocument(
  value: Pick<CellValue, "documentId" | "display" | "evidence">,
  key: string,
  qualifier: string,
  documents: readonly DocumentPages[],
): boolean {
  if (key !== "planTier") return true;
  const doc = documents.find((d) => d.documentId === value.documentId);
  if (!doc) return false;
  const target = qualifier.toLowerCase().trim();
  return doc.pages.some((page) => {
    const lines = page.split(/\r?\n/);
    return lines.some((line) => {
      const matches = [...line.matchAll(TIER_NAME_PATTERN)].map((m) => m[0].toLowerCase());
      const unique = [...new Set(matches)];
      return unique.length >= 2 && unique.includes(target);
    });
  });
}

/** Evidence-bound qualifier filter that also consults the full uploaded document
 *  for qualifiers (planTier) whose support may live on a tier-header line rather
 *  than in the value's own citation. */
export function attestedQualifiers<T extends Pick<CellValue, "documentId" | "display" | "evidence" | "qualifiers">>(
  value: T,
  documents: readonly DocumentPages[],
): T["qualifiers"] {
  const qualifiers = sourcedQualifiers(value);
  if (qualifiers.planTier !== undefined &&
    !qualifierSupportedByDocument(value, "planTier", qualifiers.planTier, documents)) {
    const next = { ...qualifiers };
    delete next.planTier;
    return next;
  }
  return qualifiers;
}
