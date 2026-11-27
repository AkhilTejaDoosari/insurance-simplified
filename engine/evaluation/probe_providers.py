"""Check what the configured model endpoints accept, without sending any document.

    uv run python -m evaluation.probe_providers

Nemotron: model listed, JSON-schema and JSON-object structured output, and whether the
endpoint takes an image (the engine never sends it one: Nemotron 3 Ultra is text-only).
Claude: key and model through the Models API (no tokens).
Prints a JSON report with no secrets (host name only). Exit 1 when a configured provider
is unreachable, so a paid run never starts on a broken setup.
"""

import json

from app.providers.anthropic import AnthropicClient, AnthropicConfig
from app.providers.nvidia import NvidiaClient, NvidiaConfig


def main() -> int:
    nv = NvidiaConfig.from_env()
    an = AnthropicConfig.from_env()
    report: dict[str, object] = {
        "nvidia": NvidiaClient(nv).probe() if nv else "not configured (LLM_BASE_URL, LLM_API_KEY)",
        "anthropic": AnthropicClient(an).probe()
        if an
        else "not configured (ENGINE_ANTHROPIC_API_KEY)",
    }
    print(json.dumps(report, indent=1))
    ok = True
    if nv:
        r = report["nvidia"]
        ok &= (
            isinstance(r, dict)
            and r.get("model_listed") is True
            and (r.get("structured_json_schema") is True or r.get("structured_json_object") is True)
        )
    if an:
        r = report["anthropic"]
        ok &= isinstance(r, dict) and r.get("model_available") is True
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
