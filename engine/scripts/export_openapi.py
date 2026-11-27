"""Write the engine's OpenAPI document to contracts/openapi.json (deterministic).

Usage: uv run python scripts/export_openapi.py [--check]
--check exits 1 when the committed file differs (used in CI).
"""

import json
import sys
from pathlib import Path

from app.core.config import Environment, Settings
from app.main import create_app

TARGET = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"


def render() -> str:
    settings = Settings(environment=Environment.TEST, service_token=None, log_level="WARNING")
    schema = create_app(settings).openapi()
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        current = TARGET.read_text() if TARGET.exists() else ""
        if current != text:
            print("contracts/openapi.json is stale: run scripts/export_openapi.py", file=sys.stderr)
            return 1
        print("contracts/openapi.json is current")
        return 0
    TARGET.write_text(text)
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
