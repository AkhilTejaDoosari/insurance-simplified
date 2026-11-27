import json

import pytest
from fastapi.testclient import TestClient

from app.core.config import Environment, Settings
from app.main import CONTRACT_MODELS, create_app
from scripts.export_openapi import TARGET, render

TOKEN = "test-token"  # noqa: S105 - test-only value


def client(token: str | None = TOKEN) -> TestClient:
    return TestClient(create_app(Settings(Environment.TEST, token, "INFO")))


def test_health_and_ready() -> None:
    c = client()
    assert c.get("/health").json() == {"ok": True}
    assert c.get("/ready").json() == {"ok": True}


def test_trace_id_is_echoed_or_generated() -> None:
    c = client()
    assert c.get("/health", headers={"x-trace-id": "abcd1234-trace"}).headers["x-trace-id"] == (
        "abcd1234-trace"
    )
    generated = c.get("/health", headers={"x-trace-id": "bad id!"}).headers["x-trace-id"]
    assert generated != "bad id!" and len(generated) == 32


def test_logs_are_json_with_trace_id_and_no_body(capsys: pytest.CaptureFixture[str]) -> None:
    c = client()
    capsys.readouterr()
    c.post("/health", content=b"secret document text", headers={"x-trace-id": "trace-12345"})
    lines = [
        json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")
    ]
    entry = next(e for e in lines if e.get("msg") == "request")
    assert entry["trace_id"] == "trace-12345"
    assert "secret document text" not in json.dumps(lines)


def test_v1_requires_the_service_token() -> None:
    assert client(None).get("/v1/meta").status_code == 503
    c = client()
    assert c.get("/v1/meta").status_code == 401
    assert c.get("/v1/meta", headers={"authorization": "Bearer nope"}).status_code == 401
    ok = c.get("/v1/meta", headers={"authorization": f"Bearer {TOKEN}"})
    assert ok.status_code == 200
    assert ok.json()["document_model_version"] == "1.0"


def test_openapi_publishes_every_contract_model() -> None:
    schemas = create_app(Settings(Environment.TEST, None, "INFO")).openapi()["components"][
        "schemas"
    ]
    for model in CONTRACT_MODELS:
        assert model.__name__ in schemas


def test_committed_contract_is_current() -> None:
    assert TARGET.read_text() == render(), "run: uv run python scripts/export_openapi.py"
