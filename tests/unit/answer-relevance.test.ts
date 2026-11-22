// Owner decision 2026-11-22 (third round, 2): a verified answer must address
// the question asked. A model answer whose every sentence verifies but none
// states a concept of the question (its words, or the topic vocabulary) is
// not shown as an answer: "cannot be confirmed" (stage off-topic). Tightens
// only; verification is unchanged. Synthetic text only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/client", () => ({ completeJson: vi.fn() }));
vi.mock("@/app/lib/rag/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/rag/embeddings")>()),
  isEmbeddingConfigured: vi.fn(() => true),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));

import { answerViaLlm, UNCERTAIN_TEXT, type ChatRejection } from "@/app/lib/rag/answer";
import { completeJson } from "@/app/lib/llm/client";
import { answerCiting } from "../helpers/chat-refs";

const PAGE = [
  "SCHEDULE OF BENEFITS",
  "Emergency room copay $250 per visit.",
  "Ambulance $100 per trip.",
  "Pregnancy is covered as any other sickness.",
  "Benefits are not payable in your home country.",
].join("\n");
const DOCS = [{ documentId: "doc-1", filename: "plan.pdf", pageCount: 1, pages: [PAGE] }];

beforeEach(() => vi.clearAllMocks());

async function ask(question: string, answer: string) {
  vi.mocked(completeJson).mockImplementationOnce(answerCiting(answer, answer) as never);
  const seen: ChatRejection[] = [];
  const r = await answerViaLlm(DOCS, question, { onRejection: (d) => seen.push(d) });
  return { r, seen };
}

describe("an off-topic verified answer is not an answer", () => {
  it("ER question answered with the ambulance line → cannot be confirmed", async () => {
    const { r, seen } = await ask("What is the emergency room copay?", "Ambulance $100 per trip.");
    expect(r.kind).toBe("refusal");
    expect(r.kind === "refusal" && r.refusalText).toBe(UNCERTAIN_TEXT);
    expect("answerText" in r).toBe(false);
    expect(seen).toEqual([expect.objectContaining({ stage: "off-topic", answerText: "Ambulance $100 per trip." })]);
  });
});

describe("controls: on-topic answers stay answers", () => {
  it("the question's own words", async () => {
    const { r } = await ask("What is the emergency room copay?", "Emergency room copay $250 per visit.");
    expect(r.kind).toBe("answer");
  });
  it("the topic vocabulary (maternity → pregnancy)", async () => {
    const { r } = await ask("Is maternity covered?", "Pregnancy is covered as any other sickness.");
    expect(r.kind).toBe("answer");
  });
  it("the topic vocabulary (geographic → home country)", async () => {
    const { r } = await ask("Are there any geographic restrictions on coverage?", "Benefits are not payable in your home country.");
    expect(r.kind).toBe("answer");
  });
});

// Review (third round, S2): a shared generic word ("copay", "room") is not
// relevance; the question's specific words (or topic vocabulary) must appear.
describe("relevance needs the question's specific words, not a generic one", () => {
  it.each([
    ["What is the ambulance copay?", "Specialist copay $60 per visit."],
    ["What is the emergency room copay?", "Room and board $500 per day."],
  ])("%s → cannot be confirmed", async (question, answer) => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting(answer, answer) as never);
    const extra = { ...DOCS[0], pages: [`${PAGE}\nSpecialist copay $60 per visit.\nRoom and board $500 per day.`] };
    const r = await answerViaLlm([extra], question);
    expect(r.kind).toBe("refusal");
  });
  it("control: a question of generic words only accepts a generic match", async () => {
    const docs = [{ ...DOCS[0], pages: ["SCHEDULE\nAnnual maximum $1,000,000\nOther terms."] }];
    vi.mocked(completeJson).mockImplementationOnce(answerCiting("Annual maximum $1,000,000", "Annual maximum $1,000,000") as never);
    const r = await answerViaLlm(docs, "What is the annual maximum?");
    expect(r.kind).toBe("answer");
  });
});

// Follow-up review: short words matched by prefix ("out" → "outpatient"),
// and one specific word was enough when the question named two.
describe("follow-up: every specific word of the question (4+ letters)", () => {
  it.each([
    ["What is the out-of-pocket maximum?", "Outpatient surgery $500 copay."],
    ["What is the ambulance copay out of network?", "In-network specialist copay $30."],
    ["Is dental covered for children?", "Child vision exam $0."],
  ])("%s → cannot be confirmed", async (question, answer) => {
    vi.mocked(completeJson).mockImplementationOnce(answerCiting(answer, answer) as never);
    const r = await answerViaLlm([{ ...DOCS[0], pages: [`${PAGE}\n${answer}`] }], question);
    expect(r.kind).toBe("refusal");
  });
});
