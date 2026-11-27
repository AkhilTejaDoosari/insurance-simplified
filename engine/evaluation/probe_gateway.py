"""Which request shape and auth header does the Claude gateway (KodeKey) accept?

    uv run python -m evaluation.probe_gateway

Uses the key the evaluation would use (found by eval_env, never printed). Prints HTTP
status codes per combination and the Claude model ids the key can see - no key, no
response bodies. The two chat requests are one-line prompts (a fraction of a cent).
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from evaluation.eval_env import collect, resolve


def _call(url: str, headers: dict[str, str], body: dict[str, Any] | None) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    for k, v in {**headers, "content-type": "application/json"}.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 - https only
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return 0, type(exc).__name__


def main() -> int:
    repo = Path(__file__).resolve().parents[2]
    env, _notes, _missing, _ = resolve(*collect(repo))
    base = env.get("ENGINE_ANTHROPIC_BASE_URL", "").rstrip("/")
    key = env.get("ENGINE_ANTHROPIC_API_KEY", "")
    model = env.get("ENGINE_ANTHROPIC_MODEL", "")
    if not base.startswith("https://") or not key:
        print("no gateway configured (KODEKEY_BASE_URL / KODEKEY_API_KEY)")
        return 1
    root = base[: -len("/v1")] if base.endswith("/v1") else base
    bearer = {"authorization": f"Bearer {key}"}
    xkey = {"x-api-key": key, "anthropic-version": "2023-06-01"}
    report: dict[str, Any] = {"host": root.split("//", 1)[1], "model_asked_for": model}

    status, listing = _call(f"{root}/v1/models", bearer, None)
    report["GET /v1/models (Bearer)"] = status
    if status == 200 and isinstance(listing, dict):
        ids = [m.get("id", "") for m in listing.get("data", []) if isinstance(m, dict)]
        report["claude_models_visible"] = sorted(i for i in ids if "claude" in i.lower())
        report["models_visible_total"] = len(ids)
    report["GET /v1/models (x-api-key)"] = _call(f"{root}/v1/models", xkey, None)[0]

    ping = [{"role": "user", "content": "Reply with the word ok."}]
    report["POST /v1/chat/completions (OpenAI format, Bearer)"] = _call(
        f"{root}/v1/chat/completions", bearer, {"model": model, "messages": ping, "max_tokens": 5}
    )[0]
    anthropic_body = {"model": model, "messages": ping, "max_tokens": 5}
    report["POST /v1/messages (Anthropic format, x-api-key)"] = _call(
        f"{root}/v1/messages", xkey, anthropic_body
    )[0]
    report["POST /v1/messages (Anthropic format, Bearer)"] = _call(
        f"{root}/v1/messages", {**bearer, "anthropic-version": "2023-06-01"}, anthropic_body
    )[0]
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
