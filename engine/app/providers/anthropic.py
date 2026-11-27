"""Claude through the Anthropic Messages API: independent visual reading of original pages.

Claude receives the original PDF pages themselves (a page-subset PDF in a ``document``
block, which the API reads both as page images and as text), never only a parser's
output. JSON comes back through structured outputs (``output_config.format``).

Engine-specific variable names (ENGINE_ANTHROPIC_*) so this client can never pick up
another tool's Anthropic configuration by accident.
"""

import base64
import json
import os
import time
from dataclasses import dataclass
from typing import Any

from app.providers.base import ModelReply, Usage, json_text
from app.providers.http import ProviderError, RateLimiter, post_json

PROVIDER = "anthropic"
DEFAULT_MODEL = "claude-opus-5-5"
API_VERSION = "2023-06-01"


@dataclass(frozen=True)
class AnthropicConfig:
    api_key: str
    model: str = DEFAULT_MODEL
    base_url: str = "https://api.anthropic.com"
    timeout_s: float = 300.0
    max_attempts: int = 3
    min_interval_s: float = 0.5

    @classmethod
    def from_env(cls) -> "AnthropicConfig | None":
        key = os.environ.get("ENGINE_ANTHROPIC_API_KEY")
        if not key:
            return None
        return cls(
            api_key=key,
            model=os.environ.get("ENGINE_ANTHROPIC_MODEL") or DEFAULT_MODEL,
            base_url=(
                os.environ.get("ENGINE_ANTHROPIC_BASE_URL") or "https://api.anthropic.com"
            ).rstrip("/"),
        )


class AnthropicClient:
    def __init__(self, config: AnthropicConfig) -> None:
        self.config = config
        self._limiter = RateLimiter(config.min_interval_s)

    @property
    def model(self) -> str:
        return self.config.model

    def read_pdf_pages(
        self, pdf: bytes, system: str, instruction: str, schema: dict[str, Any], max_tokens: int
    ) -> ModelReply:
        body = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": base64.b64encode(pdf).decode(),
                            },
                        },
                        {"type": "text", "text": instruction},
                    ],
                }
            ],
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
        headers = {"x-api-key": self.config.api_key, "anthropic-version": API_VERSION}
        started = time.perf_counter()
        res = post_json(
            PROVIDER,
            f"{self.config.base_url}/v1/messages",
            headers,
            body,
            timeout_s=self.config.timeout_s,
            max_attempts=self.config.max_attempts,
            limiter=self._limiter,
        )
        if res.get("stop_reason") == "max_tokens":
            raise ProviderError(PROVIDER, 200, "incomplete_generation")
        if res.get("stop_reason") == "refusal":
            raise ProviderError(PROVIDER, 200, "refusal")
        texts = [
            b.get("text", "")
            for b in res.get("content") or []
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if not texts:
            raise ProviderError(PROVIDER, 200, "empty_content")
        try:
            data = json.loads(json_text("".join(texts)))
        except json.JSONDecodeError:
            raise ProviderError(PROVIDER, 200, "malformed_json") from None
        usage = res.get("usage") or {}
        return ModelReply(
            PROVIDER,
            str(res.get("model") or self.config.model),
            data,
            Usage(int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)),
            time.perf_counter() - started,
        )
