// Provider-agnostic LLM client (OpenAI-compatible chat completions).
// Configured via LLM_BASE_URL, LLM_API_KEY, LLM_MODEL. No vendor SDK is
// bundled; any endpoint speaking the chat-completions shape works.

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

export async function completeJson(
  messages: LlmMessage[],
  model = process.env.LLM_MODEL ?? "default",
  opts: { baseDelayMs?: number; maxAttempts?: number; maxTokens?: number } = {}
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
        response_format: { type: "json_object" },
        temperature: 0,
        ...(opts.maxTokens === undefined ? {} : { max_tokens: opts.maxTokens }),
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
  };
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
