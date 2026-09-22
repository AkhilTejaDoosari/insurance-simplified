import { describe, expect, it } from "vitest";
import { buildVerifyItems } from "@/app/lib/extraction/verify-items";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { RegisteredTableRow } from "@/app/lib/extraction/types";

const ev = (documentId: string, page: number, quote: string) => ({
  documentId,
  page,
  quote,
  evidenceId: evidenceIdFor(documentId, page, quote),
});

const val = (documentId: string, display: string, quote: string) => ({
  documentId,
  display,
  qualifiers: {},
  evidence: [ev(documentId, 1, quote)],
});

const row = (
  factName: string,
  verdict: RegisteredTableRow["verdict"],
  values: ReturnType<typeof val>[] = [],
  rationale?: string,
): RegisteredTableRow =>
  ({ factName, verdict, values, ...(rationale ? { rationale } : {}) }) as RegisteredTableRow;

const DOCS = [{ documentId: "doc-1" }, { documentId: "doc-2" }];
const names = (id: string) => (id === "doc-1" ? "Plan A" : "Plan B");

describe("buildVerifyItems", () => {
  it("B. CORE NOT STATED appears per plan", () => {
    const items = buildVerifyItems([row("premium", "NOT STATED")], DOCS, names);
    expect(items.map((i) => i.text)).toEqual([
      "Premium / price — Not stated for Plan A",
      "Premium / price — Not stated for Plan B",
    ]);
    expect(items.every((i) => i.kind === "not-stated")).toBe(true);
  });

  it("ignores NOT STATED on non-CORE rows", () => {
    const items = buildVerifyItems([row("dental-coverage", "NOT STATED")], DOCS, names);
    expect(items).toEqual([]);
  });

  it("C. NEEDS VERIFICATION appears with a citation", () => {
    const items = buildVerifyItems(
      [row("coinsurance", "NEEDS VERIFICATION", [val("doc-2", "90%?", "Coinsurance may vary.")])],
      DOCS,
      names,
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Coinsurance / your share — Needs verification for Plan B");
    expect(items[0].citation).toMatchObject({ documentId: "doc-2", page: 1 });
    expect(typeof items[0].citation?.evidenceId).toBe("string");
  });

  it("D. same-plan/same-scope CONFLICTED appears within the plan", () => {
    const items = buildVerifyItems(
      [
        row(
          "annual-deductible",
          "CONFLICTED",
          [val("doc-1", "$250", "Deductible $250."), val("doc-1", "$500", "Deductible $500.")],
        ),
      ],
      DOCS,
      names,
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Annual deductible — Conflicting evidence within Plan A");
  });
  it("E. Plan A differing from Plan B is not a conflict", () => {
    const items = buildVerifyItems(
      [
        row("annual-deductible", "SUPPORTED", [
          val("doc-1", "$250", "Deductible $250."),
          val("doc-2", "$500", "Deductible $500."),
        ]),
      ],
      DOCS,
      names,
    );
    expect(items.filter((i) => i.kind === "conflicted")).toEqual([]);
  });

  it("skips hidden eligibility feeders; the composite speaks for them", () => {
    const items = buildVerifyItems(
      [
        row("student-eligibility", "NEEDS VERIFICATION", [
          val("doc-1", "F-1 only", "F-1 only."),
        ]),
        row("eligibility-for-you", "SUPPORTED", [
          val("doc-1", "Open enrollment", "Open enrollment."),
        ]),
      ],
      DOCS,
      names,
    );
    expect(items.some((i) => i.factName === "student-eligibility")).toBe(false);
    expect(items).toEqual([]);
  });
});
