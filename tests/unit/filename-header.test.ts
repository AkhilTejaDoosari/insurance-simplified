// Owner decision 2026-11-22 (third round, 2): in the benchmark the model put
// the document's file name on its own line above a verified answer; that
// line is a label, not a claim, and it caused the whole answer to be
// rejected. In a one-document answer a line that is exactly an in-scope
// document's file name (with or without ".pdf") is stripped, like a verified
// plan-name header. Any other line still verifies. Synthetic text only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => false),
}));

import { answerViaLlm } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import { answerCiting } from "../helpers/chat-refs";

const PAGE = ["SCHEDULE", "Annual maximum $1,000,000", "Deductible $100"].join("\n");
const DOCS = [{ documentId: "doc-1", filename: "07_example_travel_plan.pdf", pageCount: 1, pages: [PAGE] }];
beforeEach(() => vi.clearAllMocks());

describe("a file-name header line is stripped from a one-document answer", () => {
  it.each(["07_example_travel_plan.pdf", "07_example_travel_plan"])("%s", async (header) => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting(`${header}\nAnnual maximum $1,000,000`, "Annual maximum $1,000,000") as never);
    const r = await answerViaLlm(DOCS, "What is the annual maximum?");
    expect(r.kind).toBe("answer");
    expect(r.kind === "answer" && r.answerText).toBe("Annual maximum $1,000,000");
  });
  it("control: another unverifiable line still rejects the answer", async () => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Example travel plan\nAnnual maximum $1,000,000", "Annual maximum $1,000,000") as never);
    const r = await answerViaLlm(DOCS, "What is the annual maximum?");
    expect(r.kind).toBe("refusal");
  });
});
