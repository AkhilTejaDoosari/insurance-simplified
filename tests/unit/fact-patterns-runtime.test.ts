// Review (2026-11-21): the runtime is Node 20 (Dockerfile, CI). RegExp
// modifiers such as "(?-i:…)" throw there ("Invalid group") even though newer
// local Node accepts them; a fact pattern that fails to compile would break
// deterministic extraction. No fact pattern may use them, and a lower-case
// line start is a code guard, not a regex.
import { describe, expect, it } from "vitest";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { extractFallback } from "@/app/lib/extraction/extract";

const allPatterns = FACTS.flatMap((f) => [
  ...f.patterns,
  ...(f.excludePatterns ?? []),
  ...(f.requiredPatterns ?? []),
  ...(f.notUnderLabelPatterns ?? []),
  ...(f.governedPatterns ?? []).flatMap((g) => [g.heading, g.line]),
  ...(f.labelHeadPattern ? [f.labelHeadPattern] : []),
]);

describe("fact patterns compile on the deployment runtime", () => {
  it("no pattern uses RegExp modifier groups", () => {
    expect(allPatterns.filter((p) => /\(\?-?[ims]+(?:-[ims]+)?:/.test(p))).toEqual([]);
  });

  it("the wrapped-fragment guard still keeps fragments out of the policy limit", () => {
    const table = extractFallback([{ documentId: "d", filename: "d.pdf", pageCount: 1, pages: ["COVERAGE\nis in effect at birth. Maximum coverage is $500.\nAnnual maximum $1,000,000"] }], {});
    expect(table.rows.find((r) => r.factName === "policy-limit")?.values.map((v) => v.display)).toEqual(["Annual maximum $1,000,000"]);
  });
});
