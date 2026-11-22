// Owner decision 2026-11-22 (blocker 2, critical): chat must never say "not
// in your documents" (REFUSAL_TEXT) once the model has been consulted on
// passages that may state the answer; that case is "cannot be confirmed"
// with passages. Reproduced on doc 02 / doc 03 (geographic restrictions):
// the passages say "home country", no line contains "geographic", and a
// rejected answer or a model refusal fell through to the plain refusal.
// The plain refusal stays when retrieval finds nothing useful. Synthetic text.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => false),
  embedTexts: vi.fn(async () => []),
}));

import { answerViaLlm, REFUSAL_TEXT, UNCERTAIN_TEXT } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import { embedTexts, isEmbeddingConfigured } from "@/app/lib/rag/embeddings";
import { answerCiting } from "../helpers/chat-refs";

const PAGE = [
  "GENERAL PROVISIONS",
  "Benefits incurred in your home country (passport country) are not covered under this plan.",
  "Coverage ends when you return to your home country.",
].join("\n");
const DOCS = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [PAGE] }];
const GEO = "What should I verify about geographic restrictions?";

function semanticOn() {
  vi.mocked(isEmbeddingConfigured).mockReturnValue(true);
  vi.mocked(embedTexts).mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isEmbeddingConfigured).mockReturnValue(false);
});

describe("a rejected answer keeps the passages the model cited", () => {
  it("unsupported extra sentence → cannot be confirmed with the cited lines, not the plain refusal", async () => {
    semanticOn();
    vi.mocked(completeJson).mockImplementationOnce(
      answerCiting(
        "Benefits incurred in your home country (passport country) are not covered under this plan.\nYou must stay abroad.",
        "Benefits incurred in your home country (passport country) are not covered under this plan.",
      ) as never,
    );
    const r = await answerViaLlm(DOCS, GEO);
    expect(r.kind).toBe("refusal");
    expect(r.kind === "refusal" && r.refusalText).toBe(UNCERTAIN_TEXT);
    expect(r.kind === "refusal" && r.citations?.[0].quote).toContain("home country (passport country)");
  });
});

describe("a model refusal with useful retrieval is never 'not in your documents'", () => {
  it("cantAnswer on semantic passages without the question's words → cannot be confirmed with passages", async () => {
    semanticOn();
    vi.mocked(completeJson).mockResolvedValueOnce({ cantAnswer: true, answerText: null, citations: null } as never);
    const r = await answerViaLlm(DOCS, GEO);
    expect(r.kind === "refusal" && r.refusalText).toBe(UNCERTAIN_TEXT);
    expect(r.kind === "refusal" && r.citations?.length).toBeGreaterThan(0);
  });

  it("control: nothing useful retrieved → the plain refusal, no model call", async () => {
    const r = await answerViaLlm(DOCS, "Does this cover space tourism?");
    expect(r).toEqual({ schemaVersion: "v1", kind: "refusal", refusalText: REFUSAL_TEXT });
    expect(completeJson).not.toHaveBeenCalled();
  });
});
