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
from app.providers.http import ProviderError, RateLimiter, get_json, post_json

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

    def probe(self) -> dict[str, Any]:
        """Key and model check through the Models API: no tokens, no document content.
        Reports the host and status only - never the key."""
        host = self.config.base_url.split("//", 1)[-1].split("/", 1)[0]
        out: dict[str, Any] = {"model": self.config.model, "base_url_host": host}
        headers = {"x-api-key": self.config.api_key, "anthropic-version": API_VERSION}
        try:
            data = get_json(
                PROVIDER, f"{self.config.base_url}/v1/models/{self.config.model}", headers, 30
            )
            out["model_available"] = isinstance(data, dict) and data.get("id") == self.config.model
        except ProviderError as exc:
            out["model_available"] = f"error:{exc.status}"  # 401 key, 404 model
        return out

    def complete_json(
        self, system: str, user: str, schema_name: str, schema: dict[str, Any], max_tokens: int
    ) -> ModelReply:
        """Text in, schema-bound JSON out (the semantic judge). No document file is sent."""
        del schema_name  # Anthropic's structured output takes the schema only
        return self._messages(system, [{"type": "text", "text": user}], schema, max_tokens)

    def read_pdf_pages(
        self, pdf: bytes, system: str, instruction: str, schema: dict[str, Any], max_tokens: int
    ) -> ModelReply:
        document = {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.b64encode(pdf).decode(),
            },
        }
        return self._messages(
            system, [document, {"type": "text", "text": instruction}], schema, max_tokens
        )

    def _messages(
        self,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
    ) -> ModelReply:
        body = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": content}],
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
        headers = {"x-api-key": self.config.api_key, "anthropic-version": API_VERSION}
        started = time.perf_counter()
        failed: list[int] = []
        res = post_json(
            PROVIDER,
            f"{self.config.base_url}/v1/messages",
            headers,
            body,
            timeout_s=self.config.timeout_s,
            max_attempts=self.config.max_attempts,
            limiter=self._limiter,
            failed_attempts=failed,
        )
        usage = res.get("usage") or {}
        tokens_in = int(usage.get("input_tokens") or 0)
        tokens_out = int(usage.get("output_tokens") or 0)
        if res.get("stop_reason") == "max_tokens":
            raise ProviderError(
                PROVIDER,
                200,
                "incomplete_generation",
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            )
        if res.get("stop_reason") == "refusal":
            raise ProviderError(
                PROVIDER,
                200,
                "refusal",
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            )
        texts = [
            b.get("text", "")
            for b in res.get("content") or []
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if not texts:
            raise ProviderError(
                PROVIDER,
                200,
                "empty_content",
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            )
        try:
            data = json.loads(json_text("".join(texts)))
        except json.JSONDecodeError:
            raise ProviderError(
                PROVIDER,
                200,
                "malformed_json",
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            ) from None
        return ModelReply(
            PROVIDER,
            str(res.get("model") or self.config.model),
            data,
            Usage(tokens_in, tokens_out),
            time.perf_counter() - started,
            tuple(failed),
        )
