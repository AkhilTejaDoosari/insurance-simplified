// Concise Care & Coverage cell summaries. Primary cells show short
// human-readable answers ("You pay $20/visit"); the full source line stays
// in evidence. Nothing is inferred: a matched number is only shown when the
// source explicitly attaches it to a copay, deductible, or share.

export interface CareReading {
  display: string;
  certain: boolean;
}

const COPAY_AMOUNT = /copay[^$.\n]{0,24}\$([\d,]+)|\$([\d,]+)[^.\\n]{0,24}copay/i;
const ER_DEDUCTIBLE = /deductible[^$.\n]{0,32}\$([\d,]+)|\$([\d,]+)[^.\\n]{0,32}deductible/i;
const AFTER_DEDUCTIBLE = /covered after (the )?deductible|subject to (the )?deductible|after (the )?deductible (is met|applies)/i;
const NOT_COVERED = /\bnot covered\b|\bexcluded\b|\bdoes not cover\b|\bno coverage\b/i;
const TRAUMATIC_DENTAL =
  /traumatic|emergency dental|dental[^.\\n]{0,40}(injury|accident)|injury[^.\\n]{0,40}dental/i;
const ROUTINE_DENTAL = /routine|preventive dental|cleaning|check-?up/i;
const DISCOUNT_ONLY = /\bdiscount\b/i;

/** Derive a concise cell summary for a Care parent fact from one source line. */
export function summarizeCareDisplay(factName: string, source: string): CareReading {
  const line = source.trim();
  if (factName === "dental-coverage") {
    if (TRAUMATIC_DENTAL.test(line) && !ROUTINE_DENTAL.test(line)) {
      return { display: "Emergency/traumatic dental only", certain: true };
    }
  }
  if (factName === "vision-coverage") {
    if (DISCOUNT_ONLY.test(line) && !/cover/i.test(line)) {
      return { display: "Discount only", certain: true };
    }
  }
  if (factName === "emergency-care") {
    const copay = COPAY_AMOUNT.exec(line);
    if (copay) {
      const amount = (copay[1] ?? copay[2]).replace(/,/g, "");
      return {
        display: /visit/i.test(line) ? `You pay $${amount}/visit` : `You pay $${amount} ER copay`,
        certain: true,
      };
    }
    const deductible = ER_DEDUCTIBLE.exec(line);
    if (deductible) {
      const amount = (deductible[1] ?? deductible[2]).replace(/,/g, "");
      return { display: `$${amount} ER deductible`, certain: true };
    }
  } else {
    const copay = COPAY_AMOUNT.exec(line);
    if (copay) {
      const amount = (copay[1] ?? copay[2]).replace(/,/g, "");
      return {
        display: /visit/i.test(line) ? `You pay $${amount}/visit` : `You pay $${amount} copay`,
        certain: true,
      };
    }
    if (AFTER_DEDUCTIBLE.test(line)) {
      return { display: "Covered after deductible", certain: true };
    }
  }
  if (NOT_COVERED.test(line)) {
    return { display: "Not covered", certain: true };
  }
  return { display: line, certain: false };
}
