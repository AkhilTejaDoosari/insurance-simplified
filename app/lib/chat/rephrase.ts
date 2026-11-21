// Model rephrase for grid-first chat (owner decision 2026-11-21): the model
// receives ONLY the verified fact lines and their citations — never whole
// pages — inside the same collision-checked source frames as every other
// prompt. Its output is untrusted: grid-first.ts uses it only if it passes
// verifyAnswerClaims against exactly these citations.
import { completeJson } from "@/app/lib/llm/client";
import { frameSources } from "@/app/lib/llm/safe-prompt";
import type { NamedJsonSchema } from "@/app/lib/llm/json-schema";
import type { GridFacts } from "@/app/lib/chat/grid-first";

export const REPHRASE_MAX_OUTPUT_TOKENS = 512;

const REPHRASE_SCHEMA: NamedJsonSchema = {
  name: "grid_rephrase",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answerText", "citations"],
    properties: {
      answerText: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["documentId", "page", "quote"],
          properties: {
            documentId: { type: "string", minLength: 1 },
            page: { type: "integer", minimum: 1 },
            quote: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  "You answer a health-insurance question using ONLY the verified facts in the FACTS block.",
  "Write a short, plain answer (at most three sentences). Keep every figure, condition and exception exactly as stated; do not add, infer or generalize anything.",
  "Keep source words such as deductible, coinsurance and maximum. If a fact has a condition line, keep it with that fact.",
  'Return ONLY JSON: {"answerText": string, "citations": [{"documentId", "page", "quote"}]} where every citation is copied exactly from the CITATIONS list for the facts you used.',
].join("\n");

export async function rephraseVerifiedFacts(facts: GridFacts, question: string): Promise<{ answerText: unknown; citations: unknown }> {
  const payload = [
    "FACTS:",
    ...facts.lines.map((l) => `- ${l}`),
    "CITATIONS:",
    JSON.stringify(facts.citations),
  ].join("\n");
  const raw = (await completeJson([{ role: "user", content: frameSources(`${INSTRUCTIONS}\nQuestion: ${question}`, [payload]) }], undefined, {
    schema: REPHRASE_SCHEMA,
    maxTokens: REPHRASE_MAX_OUTPUT_TOKENS,
  })) as { answerText?: unknown; citations?: unknown };
  return { answerText: raw.answerText, citations: raw.citations };
}
