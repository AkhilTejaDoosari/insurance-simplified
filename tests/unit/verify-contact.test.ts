import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ComparisonTable from "@/app/components/ComparisonTable";
import VerifyContact from "@/app/components/VerifyContact";
import type { ContactHit } from "@/app/lib/extraction/contacts";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

const ev = (documentId: string, page: number, quote: string) => ({
  documentId,
  page,
  quote,
  evidenceId: evidenceIdFor(documentId, page, quote),
});

const TABLE: Table = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 }],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$250",
          qualifiers: {},
          evidence: [ev("doc-1", 1, "Annual deductible: $250.")],
        },
      ],
    },
    { factName: "premium", verdict: "NOT STATED", values: [] },
  ],
};

const NAMES = new Map([["doc-1", { name: "A", source: "filename" as const }]]);

const CONTACTS: ContactHit[] = [
  {
    kind: "email",
    value: "support@example.com",
    purpose: null,
    documentId: "doc-1",
    filename: "plan-a.pdf",
    page: 2,
    quote: "Email support@example.com for help.",
  },
];

describe("Verify & Contact section", () => {
  it("A. fifth Verify & Contact tab exists", () => {
    const out = renderToStaticMarkup(
      createElement(ComparisonTable, { table: TABLE, sessionId: "sess-1" }),
    );
    for (const tab of ["Essentials", "Care &amp; Coverage", "Rules &amp; Restrictions", "Plan Highlights", "Verify &amp; Contact"]) {
      expect(out).toContain(tab);
    }
  });

  it("B. CORE NOT STATED surfaces in Verify before enrolling", () => {
    const out = renderToStaticMarkup(
      createElement(VerifyContact, {
        table: TABLE,
        sessionId: "sess-1",
        contacts: [],
        planNames: NAMES,
      }),
    );
    expect(out).toContain("Verify before enrolling");
    expect(out).toContain("Premium / price — Not stated for A");
  });

  it("F. email/phone/website display under the correct logical plan", () => {
    const out = renderToStaticMarkup(
      createElement(VerifyContact, {
        table: TABLE,
        sessionId: "sess-1",
        contacts: CONTACTS,
        planNames: NAMES,
      }),
    );
    expect(out).toContain("Contact the plan");
    expect(out).toContain("support@example.com");
    expect(out).toContain("mailto:support@example.com");
  });

  it("J. zero contacts shows the honest absence once", () => {
    const out = renderToStaticMarkup(
      createElement(VerifyContact, {
        table: TABLE,
        sessionId: "sess-1",
        contacts: [],
        planNames: NAMES,
      }),
    );
    expect(out).toContain("No contact information found in the uploaded documents.");
    expect(out).not.toContain("Email — NOT STATED");
  });

  it("K+M. postal text never renders; unsafe schemes stay plain text", () => {
    const out = renderToStaticMarkup(
      createElement(VerifyContact, {
        table: TABLE,
        sessionId: "sess-1",
        contacts: [
          {
            kind: "website",
            value: "javascript:alert(1)",
            purpose: null,
            documentId: "doc-1",
            filename: "plan-a.pdf",
            page: 1,
            quote: "See javascript:alert(1).",
          },
        ],
        planNames: NAMES,
      }),
    );
    expect(out).not.toContain('href="javascript:');
    expect(out).toContain("javascript:alert(1)");
  });
});
