import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;
import EvidencePanel from "@/app/components/EvidencePanel";
import ChatPanel from "@/app/components/ChatPanel";
import type { SelectedCell } from "@/app/components/ComparisonTable";

const DOCUMENTS = [{ documentId: "doc-1", filename: "plan-a.pdf" }];

const CELL: SelectedCell = {
  factName: "annual-deductible",
  verdict: "SUPPORTED",
  values: [
    {
      documentId: "doc-1",
      display: "Annual deductible: $250 in-network.",
      qualifiers: { networkTier: "in-network" },
      evidence: [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250 in-network." }],
    },
  ],
};

describe("citation links use the working viewer URL", () => {
  it("EvidencePanel citations point at the viewer with the cited page", () => {
    const html = renderToStaticMarkup(
      createElement(EvidencePanel, { cell: CELL, sessionId: "sess-1", documents: DOCUMENTS })
    );
    expect(html).toContain('href="/view/sess-1/doc-1/plan-a.pdf?page=2"');
    expect(html).not.toContain("#page=");
  });

  it("ChatPanel citations use the same viewer URL", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        sessionId: "sess-1",
        documents: DOCUMENTS,
        initialTurns: [
          {
            question: "What is the deductible?",
            response: {
              schemaVersion: "v1",
              kind: "answer",
              answerText: "The deductible is $250.",
              citations: [{ documentId: "doc-1", page: 2, quote: "Annual deductible: $250." }],
            },
          },
        ],
      })
    );
    expect(html).toContain('href="/view/sess-1/doc-1/plan-a.pdf?page=2"');
    expect(html).not.toContain("#page=");
  });
});
