// Owner decision 2026-11-21, doc 02 fix 1: an item from an enumerated
// exclusions list states what is NOT covered and must never be filed as a
// benefit or cost value. The exclusions section is found structurally (the
// shared C1 scanner: an exclusion heading followed by enumerated items), not
// by any insurer- or document-specific wording. Reproduced on an owner PDF
// where four exclusion items appeared under emergency care, prescriptions,
// maternity and dental. The scanner reads a list only from item 1 in
// sequence (fail-closed), so the fixture starts at 1. Synthetic text only.
import { describe, expect, it } from "vitest";
import { extractFallback } from "@/app/lib/extraction/extract";

const SCHEDULE = [
  "SCHEDULE OF BENEFITS",
  "Emergency room copay (waived if admitted) $300",
  "Prescription drugs 80% after deductible",
  "Maternity Covered as any sickness",
  "Emergency dental expense benefit: injury to sound natural teeth only",
].join("\n");

const EXCLUSIONS = [
  "EXCLUSIONS",
  "The plan does not pay for:",
  "1. Cosmetic surgery, except reconstructive surgery after an injury;",
  "2. Elective abortion or any complications of pregnancy following it;",
  "3. Eyeglasses, contact lenses or prescriptions therefore;",
  "4. Dental treatment other than care of sound, natural teeth after an injury;",
  "5. Expenses incurred during an emergency room visit that is not of an emergency nature;",
  "6. Pre-existing conditions during the first 12 months of coverage.",
].join("\n");

const doc = (pages: string[]) => ({ documentId: "doc-1", filename: "plan.pdf", pageCount: pages.length, pages });

const valuesOn = (table: ReturnType<typeof extractFallback>, fact: string, page: number) =>
  (table.rows.find((r) => r.factName === fact)?.values ?? []).filter((v) => v.evidence.some((e) => e.page === page));

describe("exclusion-list items are never benefit values", () => {
  const table = extractFallback([doc([SCHEDULE, EXCLUSIONS])], {});

  it.each(["emergency-care", "prescriptions", "maternity-coverage", "dental-coverage", "surgery"])(
    "%s takes nothing from the exclusions list",
    (fact) => {
      expect(valuesOn(table, fact, 2)).toEqual([]);
    },
  );

  it("the schedule's own benefit lines are still read", () => {
    expect(valuesOn(table, "emergency-care", 1).length).toBeGreaterThan(0);
    expect(valuesOn(table, "prescriptions", 1).length).toBeGreaterThan(0);
    expect(valuesOn(table, "maternity-coverage", 1).length).toBeGreaterThan(0);
    expect(valuesOn(table, "dental-coverage", 1).length).toBeGreaterThan(0);
  });

  it("a rule stated as an exclusion item still reads as that rule", () => {
    expect(valuesOn(table, "pre-existing-conditions", 2).length).toBe(1);
  });

  it("control: the same lines outside an exclusions section are still benefit lines", () => {
    const plain = extractFallback([doc([EXCLUSIONS.replace("EXCLUSIONS\n", "BENEFIT NOTES\n")])], {});
    expect(valuesOn(plain, "dental-coverage", 1).length).toBeGreaterThan(0);
  });
});
