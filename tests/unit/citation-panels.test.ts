import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ChatPanel from "@/app/components/ChatPanel";
import SourceFrame from "@/app/components/SourceFrame";
import { evidenceIdFor } from "@/app/lib/evidence-ids";

const DOCUMENTS = [{ documentId: "doc-1", filename: "plan-a.pdf" }];

const QUOTE = "Annual deductible: $250 in-network.";
const EVIDENCE_ID = evidenceIdFor("doc-1", 2, QUOTE);

describe("chat citation links use the same source viewer", () => {
  it("points at the viewer with the cited page and opaque evidence ID", () => {
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
              citations: [{ documentId: "doc-1", page: 2, quote: QUOTE, evidenceId: EVIDENCE_ID }],
            },
          },
        ],
      })
    );
    expect(html).toContain(`href="/view/sess-1/doc-1/plan-a.pdf?page=2&amp;evidence=${EVIDENCE_ID}"`);
    expect(html).not.toContain("#page=");
  });
});

describe("SourceFrame (embedded source page)", () => {
  it("embeds the single-page source URL immediately", () => {
    const html = renderToStaticMarkup(
      createElement(SourceFrame, {
        pageUrl: "/api/document/sess-1/doc-1/plan-a.pdf?page=2",
        fullUrl: "/api/document/sess-1/doc-1/plan-a.pdf",
        title: "plan-a.pdf, page 2",
      })
    );
    expect(html).toContain('src="/api/document/sess-1/doc-1/plan-a.pdf?page=2"');
    expect(html).toContain("<iframe");
  });
});
