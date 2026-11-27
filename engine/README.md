# Engine (V2)

Python 3.12 · FastAPI · Pydantic v2. Owns everything the user is told about a
document: parsing, extraction, two-key verification, comparison, match score
and chat answers. The web app calls it over a private network with a service
token; it is never exposed to browsers.

```sh
uv sync
ENGINE_ENV=development ENGINE_SERVICE_TOKEN=dev uv run uvicorn app.main:app --port 8000
uv run pytest && uv run ruff check . && uv run mypy
uv run python scripts/export_openapi.py   # regenerate ../contracts/openapi.json
```

`app/schemas/` is the contract and a one-way door. Its validators are the
guardrails (five states kept apart, two keys for Verified, basis on every
amount, "not mentioned" only after a search and only relative to another
plan, levels in document order, score arithmetic). Never weaken one to get a
test green.

Status: WP3 skeleton (health, readiness, version metadata, trace-id logs,
service auth). Parsing and the rest arrive in WP4 onward (`docs/roadmap.md` §0).
