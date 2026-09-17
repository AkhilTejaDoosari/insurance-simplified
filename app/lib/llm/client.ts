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
  opts: { baseDelayMs?: number } = {}
): Promise<unknown> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("LLM not configured (set LLM_BASE_URL and LLM_API_KEY)");
  }
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  let res: Response | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
      }),
    });
    if (res.ok || !RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) break;
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
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return JSON.parse(content) as unknown;
}
