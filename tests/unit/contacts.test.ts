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

describe("phone false positives from real documents", () => {
  const doc = (pages: string[]) => [{ documentId: "doc-1", filename: "a.pdf", pages }];

  it("rejects a document/form ID tail (0426CM0050A1973230118)", () => {
    const hits = extractContacts(
      doc(["0426CM0050A1973230118 This invitation to inquire allows eligi"]),
    );
    expect(hits.filter((h) => h.kind === "phone")).toEqual([]);
  });

  it("rejects policy-number fragments (Policy number 47250153ION1109 ...)", () => {
    const hits = extractContacts(
      doc(["Policy number 47250153ION1109 47250153ION1110 Medical expense benefit"]),
    );
    expect(hits.filter((h) => h.kind === "phone")).toEqual([]);
  });

  it("keeps explicit dialing context with strict formatting", () => {
    const hits = extractContacts(
      doc(["Contact IMG at +1.317.655.4500 or precertification@imglobal.com."]),
    );
    expect(hits.filter((h) => h.kind === "phone").map((h) => h.value)).toEqual([
      "+1.317.655.4500",
    ]);
  });

  it("keeps strictly formatted numbers without explicit context", () => {
    const hits = extractContacts(doc(["Aetna – (833) 577-2586 / www.aetna.com"]) );
    expect(hits.filter((h) => h.kind === "phone").map((h) => h.value)).toEqual([
      "(833) 577-2586",
    ]);
  });

  it("keeps bare digits only with explicit dialing context", () => {
    const withContext = extractContacts(doc(["Call 8005550100 for help."]));
    expect(withContext.filter((h) => h.kind === "phone")).toHaveLength(1);
    const withoutContext = extractContacts(doc(["Reference 8005550100 filed."]));
    expect(withoutContext.filter((h) => h.kind === "phone")).toEqual([]);
  });
});
