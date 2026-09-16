import { describe, expect, it } from "vitest";
import { buildChecklist } from "@/app/lib/checklist";

describe("guided no-documents checklist flow (User Story 5)", () => {
  it("produces what-to-look-for items and documents to collect", () => {
    const list = buildChecklist({ age: "34", countryOrResidency: "Germany" });
    expect(list.whatToLookFor.length).toBeGreaterThan(0);
    expect(list.documentsToCollect.length).toBeGreaterThan(0);
    expect(list.nextStep).toMatch(/upload/i);
  });

  it("tailors items to supplied context without recommending plans", () => {
    const list = buildChecklist({ visaOrStatus: "F-1 student" });
    const text = [...list.whatToLookFor, ...list.documentsToCollect].join(" ").toLowerCase();
    expect(text).toContain("visa");
    expect(text).not.toMatch(/we recommend|best plan|you should buy|rank/);
  });
});
