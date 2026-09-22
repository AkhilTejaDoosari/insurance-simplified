import { describe, expect, it } from "vitest";
import {
  contactHref,
  extractContacts,
  groupContactsByPlan,
  normalizeContactValue,
} from "@/app/lib/extraction/contacts";

const DOCS = [
  {
    documentId: "doc-1",
    filename: "plan-a.pdf",
    pages: [
      "Questions? Email support@example.com or call 1-800-555-0100.",
      "Visit https://example.com/claims for claim status.",
    ],
  },
  {
    documentId: "doc-2",
    filename: "plan-a-brochure.pdf",
    pages: ["Emergency assistance: +1 (800) 555-0100, available 24/7."],
  },
  {
    documentId: "doc-3",
    filename: "other-plan.pdf",
    pages: ["Call 1-800-555-0100 for help."],
  },
];

const names = new Map([
  ["doc-1", "Plan A"],
  ["doc-2", "Plan A"],
  ["doc-3", "Plan B"],
]);

describe("extractContacts", () => {
  it("F. finds email/phone/website with document + page provenance", () => {
    const hits = extractContacts(DOCS);
    const email = hits.find((h) => h.kind === "email")!;
    expect(email.value).toBe("support@example.com");
    expect(email.documentId).toBe("doc-1");
    expect(email.page).toBe(1);
    expect(email.quote).toContain("support@example.com");
    expect(hits.some((h) => h.kind === "phone" && h.page === 1)).toBe(true);
    const site = hits.find((h) => h.kind === "website")!;
    expect(site.value).toBe("https://example.com/claims");
    expect(site.page).toBe(2);
  });

  it("uses a source-provided purpose label only when clearly stated", () => {
    const hits = extractContacts(DOCS);
    const emergency = hits.find((h) => h.quote.includes("Emergency assistance"))!;
    expect(emergency.purpose).toBe("Emergency assistance");
    const plain = hits.find((h) => h.kind === "email")!;
    expect(plain.purpose).toBeNull();
  });

  it("K. never emits postal addresses", () => {
    const hits = extractContacts([
      {
        documentId: "doc-1",
        filename: "a.pdf",
        pages: ["Write to us at 123 Main Street, Springfield, IL 62701."],
      },
    ]);
    expect(hits).toEqual([]);
  });

  it("L. references only the uploaded documents it scanned", () => {
    const hits = extractContacts(DOCS);
    for (const h of hits) {
      expect(["doc-1", "doc-2", "doc-3"]).toContain(h.documentId);
    }
  });
});

describe("groupContactsByPlan", () => {
  it("G. deduplicates one contact repeated across a plan's documents, keeping evidence", () => {
    const cards = groupContactsByPlan(
      extractContacts(DOCS),
      (id) => names.get(id) ?? id,
    );
    const planA = cards.find((c) => c.planName === "Plan A")!;
    const phones = planA.contacts.filter((c) => c.kind === "phone");
    expect(phones).toHaveLength(1);
    expect(phones[0].evidence.map((e) => e.documentId).sort()).toEqual(["doc-1", "doc-2"]);
  });

  it("H. same number under different plans stays on separate cards", () => {
    const cards = groupContactsByPlan(
      extractContacts(DOCS),
      (id) => names.get(id) ?? id,
    );
    const planB = cards.find((c) => c.planName === "Plan B")!;
    expect(planB.contacts.filter((c) => c.kind === "phone")).toHaveLength(1);
  });

  it("I/J. grouping carries no empty NOT STATED rows; emptiness is card-level", () => {
    expect(groupContactsByPlan([], (id) => names.get(id) ?? id)).toEqual([]);
  });

  it("normalizes phone formatting for dedup without inventing data", () => {
    expect(normalizeContactValue("phone", "+1 (800) 555-0100")).toBe(
      normalizeContactValue("phone", "1-800-555-0100"),
    );
  });
});

describe("contactHref", () => {
  it("builds safe mailto/tel/https targets", () => {
    expect(contactHref("email", "support@example.com")).toBe("mailto:support@example.com");
    expect(contactHref("phone", "1-800-555-0100")).toBe("tel:+18005550100");
    expect(contactHref("website", "https://example.com/claims")).toBe("https://example.com/claims");
    expect(contactHref("website", "www.example.com/help")).toBe("https://www.example.com/help");
  });

  it("M. refuses unsafe schemes", () => {
    expect(contactHref("website", "javascript:alert(1)")).toBeNull();
    expect(contactHref("website", "data:text/html,hi")).toBeNull();
    expect(contactHref("email", "not-an-email")).toBeNull();
  });
});
