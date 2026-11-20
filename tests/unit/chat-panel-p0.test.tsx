// P0-02 / P0-04 chat rendering regression:
// - a "cannot be confirmed" outcome shows the fixed message and its passages
//   as collapsed, page-linked sources, never as an answer;
// - turns asked under a different selection are grouped, collapsed and
//   labelled, after which the current selection's turns lead; their evidence
//   links keep the real filename even when that document is out of scope.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatPanel, { type ChatSelectionPayload } from "@/app/components/ChatPanel";
import { UNCERTAIN_TEXT, type RegisteredChatResponse } from "@/app/lib/rag/answer";
(globalThis as Record<string, unknown>).React ??= React;

const selection = (selectionKey: string): ChatSelectionPayload => ({
  resultFingerprint: "fp",
  planIds: ["b"],
  tiers: {},
  legacyTiersByDocument: {},
  selectionKey,
});
const uncertain: RegisteredChatResponse = {
  schemaVersion: "v1",
  kind: "refusal",
  refusalText: UNCERTAIN_TEXT,
  citations: [{ documentId: "doc-a", page: 3, quote: "Deductible elsewhere $100", evidenceId: "ev-a" }],
};
const answerB: RegisteredChatResponse = {
  schemaVersion: "v1",
  kind: "answer",
  answerText: "Deductible $250",
  citations: [{ documentId: "doc-b", page: 2, quote: "Deductible $250", evidenceId: "ev-b" }],
};

const render = (turns: React.ComponentProps<typeof ChatPanel>["initialTurns"], key = "key-b") =>
  renderToStaticMarkup(
    <ChatPanel
      sessionId="s"
      documents={[{ documentId: "doc-b", filename: "plan-b.pdf" }]}
      allDocuments={[{ documentId: "doc-a", filename: "plan-a.pdf" }, { documentId: "doc-b", filename: "plan-b.pdf" }]}
      selection={selection(key)}
      scopeLabel="Plan B"
      initialTurns={turns}
    />,
  );

describe("chat panel (P0-02, P0-04)", () => {
  it("shows cannot-be-confirmed with collapsed, page-linked passages", () => {
    const html = render([{ question: "Deductible?", response: uncertain, selectionKey: "key-b", scopeLabel: "Plan B" }]);
    expect(html).toContain(UNCERTAIN_TEXT);
    const sources = /<details class="chat__passages">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "";
    expect(sources).toContain("Deductible elsewhere $100");
    expect(sources).toContain("evidence=ev-a");
    expect(html).not.toContain('class="chat__a"');
  });

  it("groups earlier-selection turns, collapsed and labelled, before the current ones, with real filenames", () => {
    const html = render([
      { question: "Under A?", response: uncertain, selectionKey: "key-a", scopeLabel: "Plan A" },
      { question: "Under B?", response: answerB, selectionKey: "key-b", scopeLabel: "Plan B" },
    ]);
    const start = html.indexOf('<details class="chat__history">');
    expect(start).toBeGreaterThanOrEqual(0);
    const history = html.slice(start, html.indexOf("Under B?"));
    expect(history).toContain("Earlier questions — different selection");
    expect(history).toContain("Under A?");
    expect(history).toContain("Answered earlier for: Plan A");
    expect(history).toContain("/plan-a.pdf?page=3");
    expect(history).not.toContain("Under B?");
    expect(html.indexOf("Under B?")).toBeGreaterThan(html.indexOf("Under A?"));
    expect(html).not.toContain("/doc-a?page=3");
  });

  it("a turn asked before any selection is grouped and labelled once a selection exists", () => {
    const html = render([
      { question: "Before selecting?", response: answerB },
      { question: "Under B?", response: answerB, selectionKey: "key-b", scopeLabel: "Plan B" },
    ]);
    const start = html.indexOf('<details class="chat__history">');
    expect(start).toBeGreaterThanOrEqual(0);
    const history = html.slice(start, html.indexOf("Under B?"));
    expect(history).toContain("Before selecting?");
    expect(history).toContain("Answered earlier for: All documents");
  });

  it("answer citations name the document by filename, not by id", () => {
    const html = render([{ question: "Under B?", response: answerB, selectionKey: "key-b", scopeLabel: "Plan B" }]);
    expect(html).toContain("plan-b.pdf, <a");
    expect(html).not.toContain("doc-b, <a");
  });
});
