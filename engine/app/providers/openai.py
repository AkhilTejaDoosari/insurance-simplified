"""OpenAI GPT through an OpenAI-compatible Chat Completions endpoint (owner decision
2026-11-28: gpt-5.5 through KodeKey, as the semantic judge of facts Claude proposed).

Text only: this client's interface accepts strings and nothing else. Engine-specific
variable names (ENGINE_OPENAI_*) so it never picks up another tool's configuration.
Structured output through ``response_format`` (strict JSON schema); a reply is parsed
and schema-checked by the caller, never repaired.
"""

import json
import os
import time
from dataclasses import dataclass
from typing import Any

from app.providers.base import ModelReply, Usage, json_text
from app.providers.http import ProviderError, RateLimiter, post_json

PROVIDER = "openai"
FAMILY = "openai-gpt"
DEFAULT_MODEL = "gpt-5.5"
OPENAI_URL = "https://api.openai.com/v1"


@dataclass(frozen=True)
class OpenAIConfig:
    api_key: str
    model: str = DEFAULT_MODEL
    base_url: str = OPENAI_URL
    timeout_s: float = 180.0
    max_attempts: int = 2
    min_interval_s: float = 0.5
    reasoning_effort: str = "low"  # judging a quote needs little reasoning; "" omits it

    @classmethod
    def from_env(cls) -> "OpenAIConfig | None":
        key = os.environ.get("ENGINE_OPENAI_API_KEY")
        if not key:
            return None
        return cls(
            api_key=key,
            model=os.environ.get("ENGINE_OPENAI_MODEL") or DEFAULT_MODEL,
            base_url=(os.environ.get("ENGINE_OPENAI_BASE_URL") or OPENAI_URL).rstrip("/"),
            reasoning_effort=os.environ.get("ENGINE_OPENAI_REASONING_EFFORT", "low"),
        )


class OpenAIClient:
    def __init__(self, config: OpenAIConfig) -> None:
        self.config = config
        self._limiter = RateLimiter(config.min_interval_s)

    @property
    def model(self) -> str:
        return self.config.model

    def _headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.config.api_key}", "accept": "application/json"}

    def complete_json(
        self, system: str, user: str, schema_name: str, schema: dict[str, Any], max_tokens: int
    ) -> ModelReply:
        body: dict[str, Any] = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            # GPT-5 models count reasoning in this limit and take no temperature
            "max_completion_tokens": max_tokens,
        }
        if self.config.reasoning_effort:
            body["reasoning_effort"] = self.config.reasoning_effort
        started = time.perf_counter()
        failed: list[int] = []
        res = post_json(
            PROVIDER,
            f"{self.config.base_url}/chat/completions",
            self._headers(),
            body,
            timeout_s=self.config.timeout_s,
            max_attempts=self.config.max_attempts,
            limiter=self._limiter,
            failed_attempts=failed,
        )
        usage = res.get("usage") or {}
        tokens_in = int(usage.get("prompt_tokens") or 0)
        tokens_out = int(usage.get("completion_tokens") or 0)
        choice = (res.get("choices") or [{}])[0]
        message = choice.get("message") or {}

        def fail(reason: str) -> ProviderError:
            return ProviderError(
                PROVIDER,
                200,
                reason,
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            )

        if choice.get("finish_reason") == "length":
            raise fail("incomplete_generation")
        if message.get("refusal"):
            raise fail("refusal")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise fail("empty_content")
        try:
            data = json.loads(json_text(content))
        except json.JSONDecodeError:
            raise fail("malformed_json") from None
        return ModelReply(
            PROVIDER,
            str(res.get("model") or self.config.model),
            data,
            Usage(tokens_in, tokens_out),
            time.perf_counter() - started,
            tuple(failed),
        )
