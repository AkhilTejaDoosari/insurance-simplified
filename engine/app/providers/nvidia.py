"""Nemotron through NVIDIA's OpenAI-compatible endpoint (build.nvidia.com / NIM).

Same contract and same variables as the web app's client (``web/app/lib/llm/client.ts``):
LLM_BASE_URL, LLM_API_KEY, LLM_MODEL. Nemotron 3 Ultra takes **text only**, so this
client's interface accepts strings and nothing else: a page image cannot be sent to it
by construction. ``probe`` checks what the configured endpoint actually accepts.
"""

import json
import os
import time
from dataclasses import dataclass
from typing import Any

from app.providers.base import ModelReply, Usage, json_text
from app.providers.http import ProviderError, RateLimiter, get_json, post_json

PROVIDER = "nvidia"
DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"


@dataclass(frozen=True)
class NvidiaConfig:
    base_url: str
    api_key: str
    model: str
    timeout_s: float = 180.0
    max_attempts: int = 3
    min_interval_s: float = 1.6  # 40 requests a minute on the free tier
    structured: str = "json_schema"  # or "json_object" when the endpoint rejects schemas

    @classmethod
    def from_env(cls) -> "NvidiaConfig | None":
        base, key = os.environ.get("LLM_BASE_URL"), os.environ.get("LLM_API_KEY")
        if not base or not key:
            return None
        return cls(
            base_url=base.rstrip("/"),
            api_key=key,
            model=os.environ.get("LLM_MODEL") or DEFAULT_MODEL,
            structured=os.environ.get("NEMOTRON_STRUCTURED", "json_schema"),
        )


class NvidiaClient:
    def __init__(self, config: NvidiaConfig) -> None:
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
        if self.config.structured == "json_schema":
            fmt: dict[str, Any] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            }
        else:
            fmt = {"type": "json_object"}
        body = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": fmt,
            "temperature": 0,
            "max_tokens": max_tokens,
        }
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
        if choice.get("finish_reason") == "length":
            raise ProviderError(
                PROVIDER,
                200,
                "incomplete_generation",
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            )
        content = (choice.get("message") or {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise ProviderError(
                PROVIDER,
                200,
                "empty_content",
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                failed_attempts=tuple(failed),
            )
        try:
            data = json.loads(json_text(content))
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

    def probe(self) -> dict[str, Any]:
        """What the configured endpoint accepts. Sends no document content: a model
        listing, a one-line JSON request, and a request with a 1x1 blank image that a
        text-only model must refuse (or ignore)."""
        out: dict[str, Any] = {"model": self.config.model, "base_url_host": _host(self.config)}
        try:
            listing = get_json(PROVIDER, f"{self.config.base_url}/models", self._headers(), 30)
            ids = {m.get("id") for m in listing.get("data", []) if isinstance(m, dict)}
            out["model_listed"] = self.config.model in ids
        except ProviderError as exc:
            out["model_listed"] = f"error:{exc.status}"
        schema = {
            "type": "object",
            "properties": {"ok": {"type": "boolean"}},
            "required": ["ok"],
            "additionalProperties": False,
        }
        for mode in ("json_schema", "json_object"):
            client = NvidiaClient(_with(self.config, structured=mode, max_attempts=1))
            try:
                reply = client.complete_json(
                    "Reply with JSON only.", 'Return {"ok": true}.', "probe", schema, 4000
                )
                out[f"structured_{mode}"] = reply.data == {"ok": True}
            except ProviderError as exc:
                out[f"structured_{mode}"] = f"error:{exc.status}:{exc.reason}"
        out["accepts_image_input"] = self._probe_image()
        return out

    def _probe_image(self) -> str:
        pixel = (
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
            "/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
        )
        body = {
            "model": self.config.model,
            "max_tokens": 4000,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What colour is this pixel? One word."},
                        {"type": "image_url", "image_url": {"url": pixel}},
                    ],
                }
            ],
        }
        try:
            post_json(
                PROVIDER,
                f"{self.config.base_url}/chat/completions",
                self._headers(),
                body,
                timeout_s=60,
                max_attempts=1,
            )
        except ProviderError as exc:
            return f"refused:{exc.status}"
        # Accepted at the HTTP level. The model card says text input only; the engine
        # never sends images to this provider either way.
        return "accepted_by_endpoint_not_used"


def _host(config: NvidiaConfig) -> str:
    from urllib.parse import urlparse  # noqa: PLC0415

    return urlparse(config.base_url).hostname or ""


def _with(config: NvidiaConfig, **changes: Any) -> NvidiaConfig:
    from dataclasses import replace  # noqa: PLC0415

    return replace(config, **changes)
