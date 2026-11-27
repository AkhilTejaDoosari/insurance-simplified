// Enrollment-scoped prose statements read by the closed statement grammar,
// through the production boundary (extractFallback → validateTable →
// verifyComparisonTable). Page 1 is a synthetic FEHB-style enrollment page; the real-page cases
// live in statement-facts-real.test.ts (REAL_FIXTURES_DIR).
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";
import { validateTable, type CellValue, type ComparisonTable } from "@/app/lib/extraction/types";
import { verifyComparisonTable } from "@/app/lib/extraction/verify-table";
import { statementClaims, verifyStatementAnchor } from "@/app/lib/extraction/statement-facts";

import { SYNTHETIC_FEHB_P1 as FEHB_P1 } from "@/tests/unit/helpers/fehb-page";

const fehb = (...pages: string[]) => ({ documentId: "fehb", filename: "fehb.pdf", pageCount: pages.length, pages });
const run = (doc: ReturnType<typeof fehb>): ComparisonTable => verifyComparisonTable(validateTable(extractFallback([doc], {})), [doc]);
const statements = (t: ComparisonTable, fact: string) =>
  t.rows.find((r) => r.factName === fact)!.values.filter((v) => v.anchor?.kind === "statement");
const claimsOn = (sentence: string) => statementClaims(fehb(FEHB_P1, sentence));

describe("the grammar binds scope, concept and amount — or makes no claim", () => {
  it.each([
    ["one-line statement", "• For Self Only contracts, the calendar year deductible is now $1,000.", "Self Only"],
    ["statement wrapped across lines", "• For Self Plus One, and Self and Family contracts, the\ndeductible is now $2,000 (see page 27).", "Self Plus One, and Self and Family"],
    ["'or' joined scope with article", "For a Self Plus One or a Self and Family enrollment, your deductible is $2,000.", "Self Plus One or a Self and Family"],
  ])("%s", (_l, sentence, scope) => {
    expect(claimsOn(sentence).map((c) => c.value.qualifiers.conditions)).toEqual([scope]);
  });

  it.each([
    ["abbreviated category", "For SO contracts, the deductible is now $1,000."],
    ["unknown category", "For Self Plus contracts, the deductible is now $2,000."],
    ["extra condition after the amount", "For Self Only contracts, your out-of-pocket maximum is $11,000 when you use Preferred providers."],
    ["per-person basis after the amount", "For Self Only contracts, the deductible is $1,000 per person."],
    ["two amounts", "For Self Only contracts, the deductible is now $1,000 or $2,000."],
    ["negation", "For Self Only contracts, the deductible is not $1,000."],
    ["another concept", "For Self Only contracts, the premium is now $100."],
    ["fee stated after the concept", "For Self Only contracts, the deductible fee is now $100."],
    ["not a sentence start", "Unlike plans where for Self Only contracts, the deductible is now $1,000."],
    ["statement cut before its end", "For Self Only contracts, the deductible is now $1,000 for"],
  ])("%s → no claim", (_l, sentence) => {
    expect(claimsOn(sentence)).toEqual([]);
  });

  it("makes no claim when the document declares no enrollment record", () => {
    expect(statementClaims(fehb("Some other plan", "For Self Only contracts, the deductible is now $1,000."))).toEqual([]);
  });
});

describe("statement anchors cannot be forged", () => {
  const doc = fehb(FEHB_P1, "• For Self Only contracts, the calendar year deductible is now $1,000.");
  const genuine = (): CellValue => statementClaims(doc)[0].value;

  it("a genuine anchor re-derives", () => {
    expect(verifyStatementAnchor("annual-deductible", genuine(), [doc])).toBe(true);
  });
  it.each([
    ["altered amount", (v: CellValue) => ({ ...v, display: v.display.replace("$1,000", "$100") })],
    ["widened scope", (v: CellValue) => ({ ...v, qualifiers: { ...v.qualifiers, conditions: "Self Only, Self and Family" } })],
    ["added network", (v: CellValue) => ({ ...v, qualifiers: { ...v.qualifiers, networkTier: "Preferred" } })],
    ["shifted span", (v: CellValue) => ({ ...v, anchor: { ...v.anchor!, start: (v.anchor as { start: number }).start + 1 } as CellValue["anchor"] })],
    ["other page", (v: CellValue) => ({ ...v, anchor: { ...v.anchor!, page: 1 } as CellValue["anchor"] })],
  ])("%s does not verify", (_l, mutate) => {
    expect(verifyStatementAnchor("annual-deductible", mutate(genuine()), [doc])).toBe(false);
  });
  it("another fact does not verify", () => {
    expect(verifyStatementAnchor("out-of-pocket-maximum", genuine(), [doc])).toBe(false);
  });
});

describe("governing context: examples and disclaimers never become plan provisions", () => {
  const S = "For Self Only contracts, the deductible is $1,000.";
  it.each([
    ["reviewer case", `The following example does not describe this plan.\n${S}`],
    ["example heading", `Example 2: a family with a different plan\n${S}`],
    ["illustration lead-in", `For illustration only, consider these figures:\n• ${S}`],
    ["hypothetical", `Suppose a hypothetical member enrolls.\n${S}`],
    ["another plan", `Under another plan offered by a competitor:\n${S}`],
    ["sample", `SAMPLE FIGURES\n${S}`],
    ["disclaimer a few lines above", `This section is an example.\nIt is not a quote.\nDetails vary.\n${S}`],
    ["following modifier: example", `${S} This is an example only.`],
    ["following modifier: unless", `${S}\nUnless you enroll in the Standard Option.`],
    ["following modifier: only if", `${S} Only if you use Preferred providers.`],
  ])("%s → no claim", (_l, text) => {
    expect(claimsOn(text)).toEqual([]);
  });

  it("disclaimer at the bottom of the previous page governs a statement at the top of the next", () => {
    expect(statementClaims(fehb(FEHB_P1, "The figures below are an illustration.", S))).toEqual([]);
  });

  it.each([
    ["brochure 'Changes' list", `Changes to our Zenith Care\n• We will no longer provide 8 over-the-counter (OTC) COVID-19 tests per member.\n• ${S}`],
    ["plain statement", S],
    ["followed by another statement", `${S} For Self Plus One contracts, the deductible is $2,000.`],
  ])("%s → claim kept", (_l, text) => {
    expect(claimsOn(text).length).toBeGreaterThan(0);
  });

  it("the context rule is part of anchor verification (a context-blocked statement cannot be re-verified)", () => {
    const doc = fehb(FEHB_P1, S);
    const v = statementClaims(doc)[0].value;
    const blocked = fehb(FEHB_P1, `The following example does not describe this plan.\n${S}`);
    const shift = "The following example does not describe this plan.\n".length;
    const anchor = { ...v.anchor!, start: (v.anchor as { start: number }).start + shift, end: (v.anchor as { end: number }).end + shift } as CellValue["anchor"];
    expect(verifyStatementAnchor("annual-deductible", { ...v, anchor }, [blocked])).toBe(false);
  });
});

// Governing context is the statement's section (source structure), not a
// fixed window. Each case states why the statement is or is not this plan's
// unconditional provision.
describe("governing context is structural: section, item, neighbours, next page", () => {
  const S = "For Self Only contracts, the deductible is $1,000.";
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i} about benefits.`).join("\n");
  const pages = (...p: string[]) => statementClaims(fehb(FEHB_P1, ...p));

  it.each([
    ["same-line hypothetical", `This is a hypothetical example. ${S}`],
    ["same-line hypothetical inside the statement's own bullet", `• This is a hypothetical example. ${S}`],
    ["two-line hypothetical", `The figures that follow are\nhypothetical.\n${S}`],
    ["example disclaimer eight lines earlier, same section", `This is an example.\n${filler(8)}\n${S}`],
    ["example disclaimer twenty lines earlier, same section", `Section 4. Example costs\nThe following example does not describe this plan.\n${filler(20)}\n${S}`],
    ["governing restriction before the statement", `Only if you use Preferred providers.\n${S}`],
    ["governing restriction as a list lead-in", `Only if you use Preferred providers:\n• ${S}`],
    ["restriction following the statement", `${S} Unless you enroll in the Standard Option.`],
    ["restriction following on the next line", `${S}\nonly when you use Preferred providers.`],
    ["dangling condition bullet right after", `• ${S}\n• Only if you use Preferred providers.`],
    ["mixed-capitalization disclaimer", `THIS IS A HYPOTHETICAL EXAMPLE.\n${S}`],
    ["mixed-capitalization modifier", `${S} ONLY IF you use Preferred providers.`],
    ["lowercase modifier", `${S} only if you use Preferred providers.`],
    ["illustration list lead-in, statement deep in the list", `For illustration:\n• A.\n• B.\n• C.\n• D.\n• E.\n• F.\n• G.\n• ${S}`],
  ])("%s → no claim", (_l, text) => {
    expect(claimsOn(text)).toEqual([]);
  });

  it("restriction at the top of the next page governs a statement that ends its page", () => {
    expect(pages(S, "Only if you use Preferred providers.")).toEqual([]);
    // Running footer lines between the statement and the page break do not hide it.
    expect(pages(`${S}\n2027 Harbor Mutual Service Benefit Plan\nPage 15`, "Only if you use Preferred providers.")).toEqual([]);
  });

  it("disclaimer on an earlier page of the same section governs", () => {
    expect(pages("Section 4. Cost examples\nThe following example does not describe this plan.", filler(3), S)).toEqual([]);
  });

  it.each([
    ["legitimate deductible statement", `Changes to our Zenith Care\n• ${S}`],
    ["legitimate out-of-pocket statement", "Changes to our Zenith Care\n• For Self Only contracts, your Preferred Provider catastrophic out-of-pocket maximum is now $11,000."],
    ["unrelated restriction in a sibling provision", `• Your copayment is $3,000 only if you use a Preferred facility.\n• ${S}`],
    ["complete conditional provision before it", `If you use Preferred providers, the copay is $20. ${S}`],
    ["complete conditional provision after it in a sibling bullet", `• ${S}\n• If you use Non-preferred providers, the copay is $40.`],
    ["quotation of a disclaimer, not applied", `Our glossary explains the term "hypothetical example".\n${S}`],
    ["example in an earlier section, ended by a major heading", `Section 3. Cost examples\nThe following example does not describe this plan.\nSection 4. Your costs for covered services\n${S}`],
    ["example explicitly ended", `Example: a family with a different plan pays $500.\nEnd of example.\n${S}`],
    ["statement that ends its page, next page starts a new section", S],
  ])("%s → claim kept", (_l, text) => {
    expect(claimsOn(text).length).toBeGreaterThan(0);
  });

  it("a next page starting a new provision does not restrict a statement that ends its page", () => {
    expect(pages(S, "Section 5. Benefits\nOnly if you use Preferred providers.").length).toBe(1);
    expect(pages(S, "Your copay for office visits is $30.").length).toBe(1);
  });
});
