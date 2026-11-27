"""Check what the configured model endpoints accept, without sending any document.

    uv run python -m evaluation.probe_providers

Nemotron: model listed, JSON-schema and JSON-object structured output, and whether the
endpoint takes an image (the engine never sends it one: Nemotron 3 Ultra is text-only).
Prints a JSON report with no secrets (host name only).
"""

import json

from app.providers.nvidia import NvidiaClient, NvidiaConfig


def main() -> int:
    nv = NvidiaConfig.from_env()
    report: dict[str, object] = {
        "nvidia": NvidiaClient(nv).probe() if nv else "not configured (LLM_BASE_URL, LLM_API_KEY)"
    }
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
