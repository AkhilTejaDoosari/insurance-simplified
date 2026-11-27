"""What every provider call returns: parsed JSON plus what it cost."""

import re
from dataclasses import dataclass
from typing import Any

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"^```(?:json)?\s*\n(.*?)\n```$", re.DOTALL | re.IGNORECASE)


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class ModelReply:
    provider: str
    model: str
    data: Any
    usage: Usage
    seconds: float


def json_text(content: str) -> str:
    """Strip a reasoning block and a Markdown fence around the JSON, nothing else.
    The result is parsed and schema-checked by the caller; it is never repaired."""
    text = _THINK.sub("", content).strip()
    fenced = _FENCE.match(text)
    return fenced.group(1) if fenced else text
