// Concise Rules & Restrictions cell summaries. Primary cells carry short
// scoped answers ("Preauthorization required for inpatient care"); the full
// source line stays in evidence. Nothing is inferred: numbers and scopes
// come only from explicit source wording.

export interface RulesReading {
  display: string;
  certain: boolean;
}

const NEG = /\b(no|not|n't|without|never|waived|waives|none)\b/i;

function scopeAfter(line: string, anchor: RegExp): string {
  const at = line.search(anchor);
  if (at < 0) return "";
  const rest = line
    .slice(at)
    .replace(anchor, "")
    .trim()
    .replace(/^(?:required|is|[\s:,-])+/i, "")
    .split(/[.;]/)[0]
    .trim();
  const words = rest.split(/\s+/).slice(0, 5).join(" ").replace(/\s+(for|of|to|in|at|on|and|or)$/i, "");
  return words ? ` ${words}` : "";
}

/** Derive a concise cell summary for a Rules parent fact from one source line. */
export function summarizeRulesDisplay(factName: string, source: string): RulesReading {
  const line = source.trim();

  if (factName === "preauthorization") {
    if (/\bno\b[^.\\n]{0,24}pre-?authorization|pre-?authorization[^.\\n]{0,24}\bnot required\b|without[^.\\n]{0,24}pre-?authorization/i.test(line)) {
      return { display: "No preauthorization required", certain: true };
    }
    if (/pre-?authorization|prior authorization|pre-certification|precertification/i.test(line)) {
      return {
        display: `Preauthorization required${scopeAfter(line, /pre-?authorization|prior authorization|pre-certification|precertification|approved in advance/i)}`,
        certain: true,
      };
    }
    return { display: line, certain: false };
  }

  if (factName === "referral-requirement") {
    if (/\bno\b[^.\\n]{0,20}referral|referral[^.\\n]{0,20}\bnot required\b|without[^.\\n]{0,20}referral/i.test(line)) {
      return { display: "No referral required", certain: true };
    }
    if (/referral[^.\\n]{0,20}required|must (obtain|get)[^.\\n]{0,20}referral|referral[^.\\n]{0,20}must/i.test(line)) {
      return { display: "Referral required", certain: true };
    }
    return { display: line, certain: false };
  }

  if (factName === "material-exclusions") {
    const item = /([A-Za-z][^. ;,][^. ;,]*(?: [^. ;,]+){0,3})\s+(?:are\s+)?excluded\b/i.exec(line);
    if (item) {
      const text = item[1].trim();
      if (!/^until\b/i.test(text)) return { display: `${text[0].toUpperCase()}${text.slice(1)} excluded`, certain: true };
    }
    return { display: line, certain: false };
  }

  if (factName === "waiting-period") {
    if (NEG.test(line)) return { display: "No waiting period stated", certain: true };
    const duration = /(\d+)\s*-?\s*(day|week|month|year)s?/i.exec(line);
    if (duration) {
      const benefit = /for ([a-z][a-z \-]{0,32}?)(?:\.|,|;|$)/i.exec(line)?.[1].trim();
      const unit = duration[2].toLowerCase();
      const n = duration[1];
      return {
        display: benefit ? `${n} ${unit}${n === "1" ? "" : "s"} for ${benefit}` : `${n}-${unit} waiting period`,
        certain: true,
      };
    }
    return { display: line, certain: false };
  }

  if (factName === "coverage-duration") {
    const term = /(minimum|maximum|up to|renewable)([^.;]{0,48})/i.exec(line);
    if (term) {
      const text = `${term[1]}${term[2]}`.replace(/\s+/g, " ").trim();
      return { display: `${text[0].toUpperCase()}${text.slice(1)}`, certain: true };
    }
    return { display: line, certain: false };
  }

  if (factName === "age-limits") {
    if (/\bno\b[^.\\n]{0,20}age (limit|restriction)/i.test(line)) {
      return { display: "No age limit stated", certain: true };
    }
    const normUnit = (u: string | undefined): string =>
      !u ? "" : /^old$/i.test(u) ? "years" : u.toLowerCase();
    const explicit =
      /(\d+)\s*(days?|months?|years?|old)?\s*(?:to|through|-|–)\s*([<>]=?)?\s*(\d+)\s*(days?|months?|years?|old)/i.exec(line);
    if (explicit) {
      const comp = explicit[3] !== undefined && /[<>]/.test(explicit[3]) ? explicit[3] : undefined;
      const leftNum = explicit[1];
      const leftUnit = normUnit(explicit[2]);
      const rightNum = explicit[4];
      const rightUnit = normUnit(explicit[5]);
      if (comp === undefined && !explicit[2] && (rightUnit === "years" || rightUnit === "") && /\bage\b|\bold\b/i.test(line)) {
        return { display: `Age ${leftNum}–${rightNum}`, certain: true };
      }
      if (comp !== undefined || explicit[2]) {
        const left = leftUnit ? `${leftNum} ${leftUnit}` : leftNum;
        const right =
          comp === "<"
            ? `under ${rightNum} ${rightUnit}`.trim()
            : comp === "<="
              ? `${rightNum} ${rightUnit} or younger`.trim()
              : `${rightNum} ${rightUnit}`.trim();
        if (!comp) return { display: `${leftNum} ${leftUnit}–${rightNum} ${rightUnit}`, certain: true };
        return { display: `${left} to ${right}`, certain: true };
      }
    }
    const range =
      /(\d+)\s*(days?|months?|years?)\s*(?:to|through|-|–)\s*(\d+)\s*(days?|months?|years?)/i.exec(line) ??
      /(\d+)\s*(days?|months?|years?)\s*(?:old\s*)?(?:up to|and under|and not yet|but not yet|to)\s*(\d+)\s*(days?|months?|years?)/i.exec(line);
    if (range) {
      return { display: `${range[1]} ${range[2]}–${range[3]} ${range[4]}`, certain: true };
    }
    const max = /maximum age\s*(\d+)|(?:up to|under)\s*age\s*(\d+)/i.exec(line);
    if (max) return { display: `Maximum age ${max[1] ?? max[2]}`, certain: true };
    const bareAgeRange = /\bage\D{0,8}(\d+)\s*[–-]\s*(\d+)\b/i.exec(line);
    if (bareAgeRange) return { display: `Age ${bareAgeRange[1]}–${bareAgeRange[2]}`, certain: true };
    const symbolMax = /<=?\s*(\d+)\s*(years? old|years?|yrs?)\b/i.exec(line);
    if (symbolMax) return { display: `Maximum age ${symbolMax[1]}`, certain: true };
    const symbolMin = />=?\s*(\d+)\s*(years? old|years?|yrs?)\b/i.exec(line);
    if (symbolMin) return { display: `Minimum age ${symbolMin[1]}`, certain: true };
    return { display: line, certain: false };
  }

  if (factName === "network-rules") {
    const lower = line.toLowerCase();
    const pcts = [...line.matchAll(/(\d+)\s*%/g)].map((m) => ({
      value: m[1],
      at: m.index ?? 0,
    }));
    const pairs: string[] = [];
    for (const [scope, label] of [
      ["in-network", "In-network"],
      ["out-of-network", "Out-of-network"],
    ] as const) {
      const at = lower.indexOf(scope);
      if (at < 0) continue;
      let nearest: { value: string; at: number } | null = null;
      for (const p of pcts) {
        if (!nearest || Math.abs(p.at - at) < Math.abs(nearest.at - at)) nearest = p;
      }
      pairs.push(nearest ? `${label}: ${nearest.value}%` : label);
    }
    if (pairs.length > 0) return { display: pairs.join("; "), certain: true };
    return { display: line, certain: false };
  }

  return { display: line, certain: false };
}
