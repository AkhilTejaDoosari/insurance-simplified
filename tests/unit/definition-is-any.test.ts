// Owner decision 2026-11-22 (third round, 2): the benchmark's grid answer to
// "Are pre-existing conditions covered?" on one document was the definition
// of the term ("** A pre-existing condition is any injury or illness, which
// existed before …") — not an answer. A definition worded "<term> is any /
// is defined as / refers to", with an optional article and footnote marks,
// is a definition line like "<term> means". Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";

function table(pages: string[]) {
  return extractFallback([{ documentId: "doc-1", filename: "plan.pdf", pageCount: pages.length, pages }], {});
}
const shown = (t: ReturnType<typeof table>, fact: string) => (t.rows.find((r) => r.factName === fact)?.values ?? []).map((v) => v.display);
const withheld = (t: ReturnType<typeof table>, fact: string) => (t.rows.find((r) => r.factName === fact)?.withheld ?? []).map((w) => w.reason);

describe("'<term> is any …' is a definition, not a value", () => {
  it.each([
    "** A pre-existing condition is any injury or illness which existed before your effective date.",
    "A pre-existing condition is defined as any illness treated before coverage.",
    "Pre-existing condition refers to any illness treated before coverage.",
  ])("%s", (line) => {
    const t = table([["Pre-existing conditions Covered", line].join("\n")]);
    expect(shown(t, "pre-existing-conditions")).toEqual(["Pre-existing conditions Covered"]);
  });
  it("a document's only definition line is withheld for verification", () => {
    const t = table(["** A pre-existing condition is any injury or illness which existed before your effective date."]);
    expect(shown(t, "pre-existing-conditions")).toEqual([]);
    expect(withheld(t, "pre-existing-conditions")).toEqual(["definition-line"]);
  });
  it("controls: a rule that uses 'is any' later in the sentence is kept", () => {
    const t = table(["Acute onset of a pre-existing condition is covered up to $25,000, which is any amount after the deductible."]);
    expect(shown(t, "pre-existing-conditions").length).toBe(1);
  });
});
