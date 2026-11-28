/**
 * Read-back gate for saved engine results (reload of "/"). A saved result is data at rest:
 * before it is shown again, every fact is re-checked against the session's own documents.
 *
 * - its printed words (quote) must still be on its page of the uploaded document;
 * - a VERIFIED value's number must be printed inside that quote.
 *
 * A fact that fails is shown as "couldn't confirm" on its page, without a value or a
 * plain-words line (fail-closed: never a value the document doesn't print). This mirrors,
 * for the V2 screen, what TB-3 (evidence-core.md §5) requires of stored V1 results.
 */
import type { V2Document, V2Fact } from "@/app/lib/engine/client";

/** Lower-case word tokens (letters and digits), so spacing and punctuation don't matter. */
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The quote's tokens appear, in order and contiguous, among the page's tokens. */
function printedOn(quote: string, page: string): boolean {
  const q = tokens(quote);
  const p = tokens(page);
  if (!q.length) return false;
  outer: for (let i = 0; i + q.length <= p.length; i++) {
    for (let j = 0; j < q.length; j++) if (p[i + j] !== q[j]) continue outer;
    return true;
  }
  return false;
}

/** A number as compared: no thousands separators, no trailing decimal zeros. */
const canon = (n: string) => {
  const s = n.replace(/,/g, "");
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** The value's number is one of the whole numbers printed in the quote. */
function numberPrinted(n: string, quote: string): boolean {
  const printed = quote.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return printed.some((x) => canon(x) === canon(n));
}

function confirmFact(f: V2Fact, pages: string[]): V2Fact {
  const page = pages[f.page - 1];
  const onPage = page !== undefined && printedOn(f.quote, page);
  const valueOk =
    f.state !== "verified" ||
    (f.value !== null && (f.value.number == null || numberPrinted(String(f.value.number), f.quote)));
  if (onPage && valueOk) return f;
  return { ...f, state: "couldnt_confirm", value: null, plain: "" };
}

export function confirmSavedEngineDocuments(
  saved: V2Document[],
  session: { documentId: string; pages: string[] }[],
): V2Document[] {
  const byId = new Map(session.map((d) => [d.documentId, d.pages] as const));
  return saved
    .filter((d) => byId.has(d.documentId))
    .map((d) => ({ ...d, facts: d.facts.map((f) => confirmFact(f, byId.get(d.documentId)!)) }));
}
