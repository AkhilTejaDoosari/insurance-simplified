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

export async function completeJson(
  messages: LlmMessage[],
  model = process.env.LLM_MODEL ?? "default"
): Promise<unknown> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("LLM not configured (set LLM_BASE_URL and LLM_API_KEY)");
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
  if (!res.ok) {
    throw new Error(`LLM request failed with status ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return JSON.parse(content) as unknown;
}
