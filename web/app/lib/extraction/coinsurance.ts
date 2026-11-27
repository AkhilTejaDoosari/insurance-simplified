// Coinsurance "your share" interpretation. The row answers what the USER
// pays, so a percentage is only displayable as a member share when the
// source explicitly attributes it to the member. Plan-paid and ambiguous
// percentages keep honest non-member displays with uncertainty verdicts.

export interface CoinsuranceReading {
  display: string;
  isMemberShare: boolean;
}

const MEMBER_SUBJECT =
  /you pay|your share|your coinsurance|member pays|insured pays|patient pays|your responsibility|you are responsible/i;
const PLAN_SUBJECT =
  /plan pays|we pay|insurer pays|company pays|paid at|covered at|reimbursed at/i;
const PERCENT = /(\d+)\s*%/g;
const FIRST_PERCENT = /(\d+)\s*%/;
const SCOPE =
  /in-network|out-of-network|outside the (?:U\.S\.|United States|country)|international(?:ly)?/i;

/** Interpret one source line; never invents a share. */
export function interpretCoinsuranceShare(source: string): CoinsuranceReading {
  const line = source.trim();
  const scope = SCOPE.exec(line)?.[0].trim();
  const suffix = scope ? ` ${scope}` : "";
  const member = MEMBER_SUBJECT.exec(line);
  if (member) {
    const percents = [...line.slice(member.index).matchAll(PERCENT)].map((m) => m[1]);
    if (percents.length === 1) {
      return { display: `You pay ${percents[0]}%${suffix}`, isMemberShare: true };
    }
    return { display: line, isMemberShare: percents.length > 0 };
  }
  const plan = PLAN_SUBJECT.exec(line);
  const percent = FIRST_PERCENT.exec(line);
  if (plan && percent) {
    return { display: `Plan pays ${percent[1]}%`, isMemberShare: false };
  }
  return { display: line, isMemberShare: false };
}
