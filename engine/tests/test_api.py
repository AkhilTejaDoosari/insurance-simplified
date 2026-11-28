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


def test_extract_needs_the_service_token_and_a_pdf() -> None:
    c = client()
    assert c.post("/v1/extract?plan_id=p1", content=b"%PDF-1.4").status_code == 401
    auth = {"authorization": f"Bearer {TOKEN}"}
    not_pdf = c.post(
        "/v1/extract?plan_id=p1", content=b"hello", headers={**auth, "content-type": "text/plain"}
    )
    assert not_pdf.status_code == 415
    fake = c.post(
        "/v1/extract?plan_id=p1",
        content=b"not a pdf",
        headers={**auth, "content-type": "application/pdf"},
    )
    assert fake.status_code == 415
    bad_id = c.post(
        "/v1/extract?plan_id=../x",
        content=b"%PDF-1.4",
        headers={**auth, "content-type": "application/pdf"},
    )
    assert bad_id.status_code == 422


def test_extract_reads_a_plan_page_and_never_calls_a_model() -> None:
    from tests.test_reconcile import _pdf  # noqa: PLC0415

    c = client()
    res = c.post(
        "/v1/extract?plan_id=plan-a",
        content=_pdf(),
        headers={"authorization": f"Bearer {TOKEN}", "content-type": "application/pdf"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model_calls"] == 0 and body["pages"] == 1
    states = {f["state"] for f in body["facts"]}
    assert states <= {"couldnt_confirm"}  # no judge here: nothing claims "verified"
    from app.reconcile.layout import read_layouts  # noqa: PLC0415
    from app.recovery.present import page_text  # noqa: PLC0415

    text = page_text(read_layouts(_pdf())[0])
    assert body["printed"] and all(p["text"] in text for p in body["printed"].values())
    ids = [f["id"] for f in body["facts"]]
    assert len(ids) == len(set(ids))  # one id per printed cell
    assert set(body["printed"]) == {f["id"] for f in body["facts"] if f["evidence"]}
    assert all(f["value"] is None for f in body["facts"])  # nothing interpreted unconfirmed
    assert all(f["plan_id"] == "plan-a" and f["check_page"] == 1 for f in body["facts"])


def test_extract_cloud_consent_header_is_checked_and_never_enough_alone() -> None:
    from tests.test_reconcile import _pdf  # noqa: PLC0415

    c = client()
    headers = {"authorization": f"Bearer {TOKEN}", "content-type": "application/pdf"}
    bad = c.post(
        "/v1/extract?plan_id=p1", content=_pdf(), headers={**headers, "x-engine-cloud-consent": "x"}
    )
    assert bad.status_code == 422
    res = c.post(
        "/v1/extract?plan_id=p1",
        content=_pdf(),
        headers={**headers, "x-engine-cloud-consent": "anthropic"},
    )
    assert res.status_code == 200 and res.json()["model_calls"] == 0  # policy not set here
