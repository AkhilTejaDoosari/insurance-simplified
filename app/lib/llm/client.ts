// Provider-agnostic LLM client (OpenAI-compatible chat completions).
// Configured via LLM_BASE_URL, LLM_API_KEY, LLM_MODEL. No vendor SDK is
// bundled; any endpoint speaking the chat-completions shape works.
//
// Structured output (EC-9, defect "No schema enforcement on LLM output"):
// a caller that passes `schema` gets a strict `json_schema` response format
// (OpenAI-compatible; Ollama and other local runtimes honour the same field)
// AND a runtime check of the parsed output against that schema. Off-schema
// output is rejected as a whole — never repaired or partially used.

import { assertSupportedSchema, validateJsonSchema, type NamedJsonSchema } from "@/app/lib/llm/json-schema";

export class LlmSchemaError extends Error {
  readonly violations: readonly string[];
  constructor(name: string, violations: readonly string[]) {
    // Paths and rule names only: never the model output (may echo documents).
    super(`LLM output failed schema "${name}" (${violations.length} violation(s): ${violations.slice(0, 3).join("; ")})`);
    this.name = "LlmSchemaError";
    this.violations = violations;
  }
}

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_BASE_URL);
}

/** Rate limits and provider hiccups are retried; other failures are not. */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const REASONING_EFFORTS: ReadonlySet<string> = new Set(["none", "minimal", "low", "medium", "high"]);
/** Truncation check (see completeJson): prompts shorter than this are not
 *  checked, and a long prompt reported at more characters per token than
 *  this was cut by the provider. */
const TRUNCATION_CHECK_MIN_CHARS = 4000;
const MAX_CHARS_PER_PROMPT_TOKEN = 8;

export async function completeJson(
  messages: LlmMessage[],
  model = process.env.LLM_MODEL ?? "default",
  opts: { baseDelayMs?: number; maxAttempts?: number; maxTokens?: number; schema?: NamedJsonSchema } = {}
): Promise<unknown> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("LLM not configured (set LLM_BASE_URL and LLM_API_KEY)");
  }
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("LLM maxAttempts must be a positive integer");
  }
  if (opts.maxTokens !== undefined && (!Number.isInteger(opts.maxTokens) || opts.maxTokens < 1)) {
    throw new RangeError("LLM maxTokens must be a positive integer");
  }
  if (opts.schema) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(opts.schema.name)) throw new RangeError("LLM schema name must match [A-Za-z0-9_-]{1,64}");
    assertSupportedSchema(opts.schema.schema);
  }
  const responseFormat = opts.schema
    ? { type: "json_schema", json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } }
    : { type: "json_object" };
  // Opt-in reasoning control for providers that accept the OpenAI-style
  // field (owner decision 2026-11-21: local qwen3 via Ollama, "none" turns
  // its reasoning step off). Unset: the body is unchanged. Closed set only.
  const reasoningEffort = process.env.LLM_REASONING_EFFORT?.trim();
  if (reasoningEffort && !REASONING_EFFORTS.has(reasoningEffort)) {
    throw new RangeError("LLM_REASONING_EFFORT must be one of none, minimal, low, medium, high");
  }
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  let res: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: responseFormat,
        temperature: 0,
        ...(opts.maxTokens === undefined ? {} : { max_tokens: opts.maxTokens }),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
    });
    if (res.ok || !RETRYABLE.has(res.status) || attempt === maxAttempts) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** (attempt - 1);
    console.warn(`[llm] status ${res.status}; retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(delay);
  }
  if (!res || !res.ok) {
    throw new Error(`LLM request failed with status ${res?.status ?? "unknown"}`);
  }
  const data = (await res.json()) as {
    choices?: { finish_reason?: string | null; message?: { content?: string } }[];
    usage?: { prompt_tokens?: unknown };
  };
  // A provider whose context window is smaller than the prompt may drop the
  // prompt's beginning — the trusted instructions and the question — and
  // answer from untrusted document text alone. Detected from the provider's
  // own usage report: ordinary text runs ~3–5 characters per token, so a
  // long prompt reported at under one token per 8 characters was cut. Fail
  // closed (A-026: a provider/configuration failure, retryable upstream).
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const promptTokens = data.usage?.prompt_tokens;
  if (typeof promptTokens === "number" && promptTokens > 0 && promptChars >= TRUNCATION_CHECK_MIN_CHARS && promptChars / promptTokens > MAX_CHARS_PER_PROMPT_TOKEN) {
    throw new Error("LLM prompt truncated by provider: context window smaller than the prompt");
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("LLM incomplete generation: provider finish_reason=length");
  }
  const content = choice?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  const responseText = content.trim();
  const fenced = /^```json\s*\n([\s\S]*?)\n```$/i.exec(responseText);
  const jsonText = fenced ? fenced[1] : responseText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("LLM returned malformed JSON");
  }
  if (opts.schema) {
    // Strict path: the parsed output itself must satisfy the schema. No
    // envelope unwrapping, no coercion, no partial acceptance.
    const violations = validateJsonSchema(opts.schema.schema, parsed);
    if (violations.length > 0) throw new LlmSchemaError(opts.schema.name, violations);
    return parsed;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return parsed;

  const envelopeFields = ["name", "type", "content"].filter((field) => field in parsed).length;
  if (envelopeFields < 2) return parsed;
  if (
    Object.keys(parsed).length !== 3 ||
    !("name" in parsed) || !("type" in parsed) || !("content" in parsed) ||
    parsed.name !== "answer" ||
    parsed.type !== "json_object" ||
    typeof parsed.content !== "string"
  ) {
    throw new Error("Unsupported LLM response envelope");
  }

  const inner: unknown = JSON.parse(parsed.content);
  if (
    typeof inner !== "object" || inner === null || Array.isArray(inner) ||
    Object.keys(inner).length !== 2 ||
    !("answerText" in inner) || !("citations" in inner) ||
    typeof inner.answerText !== "string" || !inner.answerText.trim() ||
    !Array.isArray(inner.citations) || inner.citations.length === 0 ||
    !inner.citations.every((citation: unknown) =>
      typeof citation === "object" && citation !== null && !Array.isArray(citation) &&
      "documentId" in citation && typeof citation.documentId === "string" &&
      "page" in citation && (
        typeof citation.page === "number" && citation.page >= 1 ||
        typeof citation.page === "string" && /^\d+$/.test(citation.page.trim()) && Number(citation.page) >= 1
      ) &&
      "quote" in citation && typeof citation.quote === "string" && !!citation.quote.trim()
    )
  ) {
    throw new Error("Invalid LLM response envelope content");
  }
  return inner;
}
