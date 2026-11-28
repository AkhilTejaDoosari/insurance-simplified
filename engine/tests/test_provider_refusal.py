"""A provider that refuses (used-up budget, 422, 429, timeout) never fails a read: the
local readers' facts come back with their pages, everything else is couldn't confirm,
the provider is not called again for that document, and the response says the checks
are incomplete (fakes only - no model is called)."""

import dataclasses
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import extract as api
from app.api.extract import extract_pdf
from app.core.config import Environment, Settings
from app.main import create_app
from app.parsing.base import sha256
from app.providers.base import ModelReply, Usage
from app.providers.http import ProviderError
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from tests.test_key2_extract import PDF as BROCHURE
from tests.test_key2_extract import FakeClaude, _confirm_all
from tests.test_reconcile import _pdf

TABLE = _pdf()
ALLOW = CloudPolicy(
    enabled_providers=frozenset({"anthropic", "openai"}),
    retention_reviewed=frozenset({"anthropic", "openai", "kodekey"}),
    customer_documents_approved=True,
)


def auth(pdf: bytes) -> CloudAuthorization:
    return CloudAuthorization(
        sha256(pdf), DocumentClass.CUSTOMER, frozenset({"anthropic", "openai"}), "consent"
    )


class Refusing:
    """Every call refused the way KodeKey refuses a used-up budget (or 429, or timeout)."""

    def __init__(self, model: str, provider: str, status: int = 422) -> None:
        self.model, self.provider, self.status, self.calls = model, provider, status, 0

    def complete_json(self, *_: Any) -> ModelReply:
        self.calls += 1
        raise ProviderError(self.provider, self.status, "http_error" if self.status else "timeout")


class JudgeOnly:
    """Claude that only judges (confirms everything) and proposes nothing."""

    model = "claude-opus-5-5"

    def complete_json(self, system: str, user: str, name: str, *_: Any) -> ModelReply:
        data: Any = (
            _confirm_all(user)
            if name == "judge"
            else {"lines": []}
            if name == "plain_words"
            else {"facts": [], "clauses": [], "values": []}
        )
        return ModelReply("anthropic", self.model, data, Usage(100, 50), 0.01)


@pytest.fixture(autouse=True)
def prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in {
        "ENGINE_PRICE_ANTHROPIC_IN": "4",
        "ENGINE_PRICE_ANTHROPIC_OUT": "20",
        "ENGINE_PRICE_OPENAI_IN": "5",
        "ENGINE_PRICE_OPENAI_OUT": "30",
    }.items():
        monkeypatch.setenv(k, v)


@pytest.mark.parametrize("status", [422, 429, 402, 0])
def test_a_refusing_claude_still_returns_the_readers_facts(
    status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    # one fact per judge call, so a refusal is followed by calls that must be skipped
    limits = dataclasses.replace(api.CLAUDE_TEXT_LIMITS, judge_facts_per_call=1)
    monkeypatch.setattr(api, "CLAUDE_TEXT_LIMITS", limits)
    claude = Refusing("claude-opus-5-5", "anthropic", status)
    x = extract_pdf(TABLE, "p", auth(TABLE), text_model=claude, policy=ALLOW)
    assert x.facts and {f.state for f in x.facts} == {"couldnt_confirm"}
    assert all(f.check_page == 1 for f in x.facts)  # every one says where to look
    assert x.printed  # the printed words still come back
    assert claude.calls == 1  # refused once: not called again for this document
    assert x.checks_incomplete and "provider_unavailable" in x.checks_incomplete_reasons
    if status:  # rejected before any work: nothing is charged
        assert x.model_cost_usd == 0


def test_without_a_refusal_the_same_readers_facts_are_verified() -> None:
    x = extract_pdf(TABLE, "p", auth(TABLE), text_model=JudgeOnly(), policy=ALLOW)
    assert "verified" in {f.state for f in x.facts}
    assert not x.checks_incomplete and x.checks_incomplete_reasons == []


def test_a_refusing_gpt_leaves_claudes_lines_unconfirmed_and_says_so() -> None:
    gpt = Refusing("gpt-5.5", "openai", 429)
    x = extract_pdf(
        BROCHURE, "p", auth(BROCHURE), text_model=FakeClaude(), gpt_model=gpt, policy=ALLOW
    )
    assert x.facts and {f.state for f in x.facts} == {"couldnt_confirm"}
    assert x.printed and not x.plain
    assert gpt.calls == 1 and x.checks_incomplete


def test_no_consent_is_not_incomplete() -> None:
    x = extract_pdf(TABLE, "p", None, text_model=JudgeOnly(), policy=ALLOW)
    assert not x.checks_incomplete


def test_the_endpoint_answers_200_when_every_provider_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENGINE_CLOUD_PROVIDERS", "anthropic,openai")
    monkeypatch.setenv("ENGINE_CLOUD_RETENTION_REVIEWED", "anthropic,openai,kodekey")
    monkeypatch.setenv("ENGINE_CLOUD_CUSTOMER_DOCUMENTS", "approved")
    monkeypatch.delenv("ENGINE_CLAUDE_TOKEN_CAP", raising=False)
    monkeypatch.setattr(api, "claude_text_model", lambda: Refusing("claude-opus-5-5", "anthropic"))
    monkeypatch.setattr(api, "gpt_judge_model", lambda: Refusing("gpt-5.5", "openai"))
    client = TestClient(create_app(Settings(Environment.TEST, "test-token", "INFO")))
    res = client.post(
        "/v1/extract?plan_id=p1",
        content=TABLE,
        headers={
            "authorization": "Bearer test-token",
            "content-type": "application/pdf",
            "x-engine-cloud-consent": "anthropic, openai",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["checks_incomplete"] is True and body["facts"]
    assert {f["state"] for f in body["facts"]} == {"couldnt_confirm"}
    assert json.dumps(body).count("check_page") >= len(body["facts"])


def test_consent_without_a_configured_model_is_incomplete() -> None:
    x = extract_pdf(TABLE, "p", auth(TABLE), text_model=None, policy=ALLOW)
    assert x.checks_incomplete and x.checks_incomplete_reasons == ["models_not_configured"]


def test_spend_cap_configuration(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    monkeypatch.delenv("ENGINE_SPEND_CAP_USD", raising=False)
    assert api.spend_ledger() == (None, "")
    monkeypatch.setenv("ENGINE_SPEND_CAP_USD", "5")
    monkeypatch.delenv("ENGINE_SPEND_LEDGER", raising=False)
    assert api.spend_ledger() == (None, "spend_ledger_not_configured")
    monkeypatch.setenv("ENGINE_SPEND_CAP_USD", "-1")
    assert api.spend_ledger()[1] == "spend_cap_invalid"
    monkeypatch.setenv("ENGINE_SPEND_CAP_USD", "5")
    monkeypatch.setenv("ENGINE_SPEND_LEDGER", str(tmp_path / "spend.jsonl"))
    ledger, why = api.spend_ledger()
    assert ledger is not None and ledger.cap_usd == 5 and why == ""


def test_a_spent_allowance_is_a_hard_stop_across_documents(tmp_path: Any) -> None:
    from app.recovery.budget import SpendLedger  # noqa: PLC0415

    spend = SpendLedger(tmp_path / "spend.jsonl", 0.001)  # below one call's worst case
    judge = JudgeOnly()
    x = extract_pdf(TABLE, "p", auth(TABLE), text_model=judge, policy=ALLOW, spend=spend)
    assert {f.state for f in x.facts} == {"couldnt_confirm"}  # nothing sent, nothing verified
    assert x.checks_incomplete and x.model_calls == 0 and spend.committed_usd() == 0
