import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
(globalThis as Record<string, unknown>).React ??= React;

import ComparisonTable from "@/app/components/ComparisonTable";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

describe("P1 contact sourcing guard (todo 46)", () => {
  it("unsourced phone numbers never render as tel: links", () => {
    const quote = "Call 1-800-555-0100 for help.";
    const table = {
      schemaVersion: "v1",
      factListVersion: "v1",
      documents: [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1 }],
      rows: [
        {
          factName: "contact",
          verdict: "SUPPORTED",
          values: [
            {
              documentId: "doc-1",
              display: "Call 1-800-555-0100 for help.",
              qualifiers: {},
              evidence: [
                {
                  documentId: "doc-1",
                  page: 1,
                  quote,
                  evidenceId: evidenceIdFor("doc-1", 1, quote),
                },
              ],
            },
          ],
        },
      ],
    } as never;
    const html = renderToStaticMarkup(
      React.createElement(ComparisonTable, { table, sessionId: "sess-test" } as never),
    );
    expect(html).not.toContain("tel:");
    expect(html).toContain("1-800-555-0100");
  });
});
