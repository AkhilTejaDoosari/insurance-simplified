"""/v1/extract key 2: Claude judges reader facts, GPT judges Claude's, never the same family;
plain-words lines only for VERIFIED facts; the cumulative Claude token allowance (fakes)."""

import io
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.api import extract as api
from app.api.extract import extract_pdf
from app.core.config import Environment, Settings
from app.main import create_app
from app.parsing.base import sha256
from app.providers.base import ModelReply, Usage
from app.recovery.budget import SpendLedger
from app.recovery.plain import PlainItem, check_plain, parse_plain
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from app.recovery.semantic import (
    confirmed,
    interpret,
    model_family,
    parse_judge,
    proposer_families,
)
from tests.test_claude_text_recovery import PROPOSALS
from tests.test_labelled import _brochure


def _single_column_brochure() -> bytes:
    """An unruled benefit list with no network-tier wording anywhere on the page."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.setFont("Helvetica", 9)
    for y, label, value in (
        (100, "Deductible", "$250 per Policy Year"),
        (120, "Coinsurance", "80% after Deductible"),
        (140, "Emergency Room", "$250 copay per visit, then"),
        (152, "", "100% of Usual & Customary"),
    ):
        if label:
            c.drawString(40, 792 - y, label)
        c.drawString(250, 792 - y, value)
    c.showPage()
    c.save()
    return buf.getvalue()


PDF = _single_column_brochure()
ALLOW = CloudPolicy(
    enabled_providers=frozenset({"anthropic", "openai"}),
    retention_reviewed=frozenset({"anthropic", "openai", "kodekey"}),
    customer_documents_approved=True,
)
BOTH = CloudAuthorization(
    sha256(PDF), DocumentClass.CUSTOMER, frozenset({"anthropic", "openai"}), "caller_consent"
)


def _confirm_all(user: str) -> dict[str, Any]:
    n = len(json.loads(user)["facts"])
    fields = dict.fromkeys(
        ("value", "basis", "network_tier", "person_level", "negation", "conditions"), "confirm"
    )
    return {
        "verdicts": [
            {"id": i, "fields": fields, "meaning_complete": True, "issues": []} for i in range(n)
        ]
    }


class FakeClaude:
    """Proposes brochure lines; judges (when asked) and writes plain words."""

    model = "claude-opus-5-5"

    def __init__(self, plain: str = "You pay the first $250 yourself each policy year.") -> None:
        self.by_stage: dict[str, int] = {}
        self.plain = plain

    def complete_json(self, system: str, user: str, name: str, *_: Any) -> ModelReply:
        self.by_stage[name] = self.by_stage.get(name, 0) + 1
        if name == "judge":
            data: Any = _confirm_all(user)
        elif name == "plain_words":
            items = json.loads(user)["items"]
            data = {"lines": [{"id": it["id"], "text": self.plain} for it in items]}
        else:
            data = PROPOSALS
        return ModelReply("anthropic", self.model, data, Usage(2_000, 500), 0.01)


class FakeGPT:
    model = "gpt-5.5"

    def __init__(self, data: Any = None) -> None:
        self.calls = 0
        self.data = data

    def complete_json(self, system: str, user: str, name: str, *_: Any) -> ModelReply:
        assert name == "judge"
        self.calls += 1
        data = _confirm_all(user) if self.data is None else self.data
        return ModelReply("openai", self.model, data, Usage(1_500, 300), 0.01)


@pytest.fixture(autouse=True)
def prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in {
        "ENGINE_PRICE_ANTHROPIC_IN": "4",
        "ENGINE_PRICE_ANTHROPIC_OUT": "20",
        "ENGINE_PRICE_OPENAI_IN": "5",
        "ENGINE_PRICE_OPENAI_OUT": "30",
    }.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("ENGINE_DOCUMENT_COST_CAP_USD", raising=False)


# ------------------------------------------------------------------ family rule


def test_family_comes_from_the_model_name_not_the_stage() -> None:
    assert model_family("claude-opus-5-5") == "anthropic-claude"
    assert model_family("kodekloud/claude-opus") == "anthropic-claude"
    assert model_family("gpt-5.5") == "openai-gpt"
    assert model_family("nvidia/nemotron-3-ultra") == "nvidia-nemotron"
    assert model_family("mystery-1") == "unknown"
    # the text stage running Claude is Claude, not Nemotron (the old stage-based rule)
    assert proposer_families({"text:claude-opus-5-5", "opendataloader"}) == {"anthropic-claude"}


def test_claude_can_never_confirm_what_claude_proposed() -> None:
    code = interpret("$45 copay/visit", header="In-Network")
    (claude,) = parse_judge(_confirm_all(json.dumps({"facts": [{}]})), 1, "anthropic-claude", "c")
    (gpt,) = parse_judge(_confirm_all(json.dumps({"facts": [{}]})), 1, "openai-gpt", "g")
    assert confirmed(code, claude, {"text:claude-opus-5-5"}) == (
        False,
        ("judge_same_family_as_proposer",),
    )
    assert confirmed(code, gpt, {"text:claude-opus-5-5"})[0]
    assert confirmed(code, gpt, {"text:mystery-1"}) == (False, ("proposer_family_unknown",))


# ------------------------------------------------------------------ /v1/extract


def test_gpt_judges_claude_lines_and_they_become_verified() -> None:
    claude, gpt = FakeClaude(), FakeGPT()
    x = extract_pdf(PDF, "plan-a", BOTH, text_model=claude, gpt_model=gpt, policy=ALLOW)
    verified = [f for f in x.facts if f.state == "verified"]
    assert gpt.calls >= 1 and verified
    assert claude.by_stage.get("judge", 0) == 0  # nothing here was proposed by a reader
    for f in verified:
        judge = f.provenance.judge_check
        assert judge is not None and judge.model_family == "openai-gpt"
        assert f.evidence and f.value is not None
    ded = next(f for f in verified if f.benefit_label == "Deductible")
    assert x.printed[ded.id].text == "$250 per Policy Year"
    assert x.plain[ded.id] == "You pay the first $250 yourself each policy year."
    assert set(x.plain) <= {f.id for f in verified}  # never for anything not verified
    stages = {(u.provider, u.stage) for u in x.model_usage}
    assert {("anthropic", "text"), ("openai", "judge"), ("anthropic", "plain")} <= stages
    assert x.model_cost_usd == pytest.approx(sum(u.cost_usd or 0 for u in x.model_usage))


def test_a_page_with_network_tiers_keeps_brochure_lines_unproven() -> None:
    pdf = _brochure()  # same lines, but "in-network" and "PPO" are printed on the page
    auth = CloudAuthorization(sha256(pdf), DocumentClass.CUSTOMER, BOTH.providers, "c")
    gpt = FakeGPT()
    x = extract_pdf(pdf, "plan-a", auth, text_model=FakeClaude(), gpt_model=gpt, policy=ALLOW)
    assert {f.state for f in x.facts} == {"couldnt_confirm"}  # the column may matter


def test_without_gpt_claude_lines_stay_unconfirmed() -> None:
    x = extract_pdf(PDF, "plan-a", BOTH, text_model=FakeClaude(), gpt_model=None, policy=ALLOW)
    assert {f.state for f in x.facts} == {"couldnt_confirm"} and not x.plain


def test_a_gpt_rejection_keeps_the_line_unconfirmed() -> None:
    gpt = FakeGPT({"verdicts": []})  # off-schema for every id: a rejection
    x = extract_pdf(PDF, "plan-a", BOTH, text_model=FakeClaude(), gpt_model=gpt, policy=ALLOW)
    assert gpt.calls >= 1 and {f.state for f in x.facts} == {"couldnt_confirm"}


def test_gpt_needs_its_own_consent_and_policy() -> None:
    claude_only = CloudAuthorization(
        sha256(PDF), DocumentClass.CUSTOMER, frozenset({"anthropic"}), "caller_consent"
    )
    gpt = FakeGPT()
    x = extract_pdf(
        PDF, "plan-a", claude_only, text_model=FakeClaude(), gpt_model=gpt, policy=ALLOW
    )
    assert gpt.calls == 0 and not [f for f in x.facts if f.state == "verified"]
    no_openai = CloudPolicy(
        frozenset({"anthropic"}), ALLOW.retention_reviewed, customer_documents_approved=True
    )
    x = extract_pdf(PDF, "plan-a", BOTH, text_model=FakeClaude(), gpt_model=gpt, policy=no_openai)
    assert gpt.calls == 0


def test_a_plain_line_with_an_unprinted_number_is_dropped() -> None:
    claude = FakeClaude(plain="You pay the first $500 yourself each year.")
    x = extract_pdf(PDF, "plan-a", BOTH, text_model=claude, gpt_model=FakeGPT(), policy=ALLOW)
    assert claude.by_stage.get("plain_words") == 1 and not x.plain


def test_claude_token_allowance_is_cumulative(tmp_path: Path) -> None:
    tokens = SpendLedger(tmp_path / "claude-tokens.jsonl", 1_000_000)
    for _ in range(2):
        x = extract_pdf(
            PDF,
            "plan-a",
            BOTH,
            text_model=FakeClaude(),
            gpt_model=FakeGPT(),
            policy=ALLOW,
            tokens=tokens,
        )
    claude_used = sum(
        u.input_tokens + u.output_tokens for u in x.model_usage if u.provider == "anthropic"
    )
    assert x.claude_tokens is not None and x.claude_tokens.cap == 1_000_000
    assert x.claude_tokens.committed == 2 * claude_used  # both documents, GPT not counted
    assert x.claude_tokens.remaining == 1_000_000 - 2 * claude_used


def test_an_exhausted_token_allowance_sends_nothing_to_claude(tmp_path: Path) -> None:
    claude = FakeClaude()
    tokens = SpendLedger(tmp_path / "t.jsonl", 100)  # far below one call's worst case
    x = extract_pdf(
        PDF, "plan-a", BOTH, text_model=claude, gpt_model=FakeGPT(), policy=ALLOW, tokens=tokens
    )
    assert claude.by_stage == {} and x.claude_tokens is not None and x.claude_tokens.committed == 0


def test_token_cap_configuration(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("ENGINE_CLAUDE_TOKEN_CAP", raising=False)
    assert api.claude_token_ledger() == (None, "")
    monkeypatch.setenv("ENGINE_CLAUDE_TOKEN_CAP", "5000")
    monkeypatch.delenv("ENGINE_CLAUDE_TOKEN_LEDGER", raising=False)
    assert api.claude_token_ledger() == (None, "token_ledger_not_configured")
    monkeypatch.setenv("ENGINE_CLAUDE_TOKEN_CAP", "lots")
    assert api.claude_token_ledger()[1] == "token_cap_invalid"
    monkeypatch.setenv("ENGINE_CLAUDE_TOKEN_CAP", "5000")
    monkeypatch.setenv("ENGINE_CLAUDE_TOKEN_LEDGER", str(tmp_path / "t.jsonl"))
    ledger, why = api.claude_token_ledger()
    assert ledger is not None and ledger.cap_usd == 5000 and why == ""


def test_consent_header_names_only_known_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[frozenset[str]] = []

    def fake(pdf: bytes, plan_id: str, auth: Any, **_: Any) -> Any:
        seen.append(auth.providers)
        raise RuntimeError("stop here")

    monkeypatch.setattr(api, "extract_pdf", fake)
    client = TestClient(create_app(Settings(Environment.TEST, "test-token", "INFO")))
    headers = {"authorization": "Bearer test-token", "content-type": "application/pdf"}
    for value, status in (
        ("anthropic, openai", 422),  # reaches extract (the fake stops it: unreadable)
        ("anthropic", 422),
        ("openai", 422),  # GPT judges Claude's lines: never without Claude
        ("anthropic,gemini", 422),
    ):
        r = client.post(
            "/v1/extract?plan_id=p1",
            content=PDF,
            headers={**headers, "x-engine-cloud-consent": value},
        )
        assert r.status_code == status
    assert seen == [frozenset({"anthropic", "openai"}), frozenset({"anthropic"})]


# ------------------------------------------------------------------ plain-words check


def test_plain_check_keeps_only_what_is_printed() -> None:
    item = PlainItem("Deductible", "$250 per Policy Year")
    assert check_plain("You pay the first $250 yourself each policy year.", item)[1] == ()
    assert "number_not_printed" in check_plain("You pay $250, or $500 for a family.", item)[1]
    assert "negation_not_printed" in check_plain("Dental is not covered, $250.", item)[1]
    assert "advice" in check_plain("You should pick this $250 plan.", item)[1]
    assert "more_than_one_sentence" in check_plain("You pay $250. Then it pays.", item)[1]
    assert check_plain("You pay $250.00 a year.", item)[1] == ()
    excl = PlainItem("Pre-existing conditions", "Not covered")
    assert check_plain("Conditions you had before are not covered.", excl)[1] == ()


def test_plain_parse_is_strict() -> None:
    items = [PlainItem("A", "$1"), PlainItem("B", "$2")]
    assert parse_plain({"lines": [{"id": 0, "text": "You pay $1."}]}, items) == ["You pay $1.", ""]
    dup = {"lines": [{"id": 0, "text": "You pay $1."}, {"id": 0, "text": "You pay $1."}]}
    assert parse_plain(dup, items) == ["", ""]
    assert parse_plain({"lines": "x"}, items) == ["", ""]


# ------------------------------------------------------------------ code reading rules


def test_a_cell_that_repeats_its_column_header_is_not_a_value() -> None:
    from app.recovery.semantic import is_column_header  # noqa: PLC0415

    assert is_column_header("IN-NETWORK PROVIDER", "In-Network Provider")
    assert not is_column_header("$250", "In-Network Provider")
    assert not is_column_header("In-Network Provider", "")


def test_trip_wording_is_a_trip_basis_and_brochures_use_printed_words_only() -> None:
    trip = interpret("$250 per covered trip", label="Deductible", term_rules=False)
    assert [str(r.basis) for r in trip.interpretations] == ["per_period_of_coverage"]
    period = interpret("$500 per certificate period", label="Deductible", term_rules=False)
    assert [str(r.basis) for r in period.interpretations] == ["per_period_of_coverage"]
    # SBC term rule ("a deductible is per year") never applies to a brochure line
    bare = interpret("$250", label="Deductible", term_rules=False)
    assert not bare.passed and "basis_unclear" in bare.problems
    assert interpret("$250", label="Deductible").passed  # SBC tables keep the term rule


def test_brochure_line_with_printed_basis_reads_as_an_amount() -> None:
    x = extract_pdf(PDF, "plan-a", BOTH, text_model=FakeClaude(), gpt_model=FakeGPT(), policy=ALLOW)
    ded = next(f for f in x.facts if f.benefit_label == "Deductible" and f.state == "verified")
    assert ded.value is not None and ded.value.kind == "amount" and ded.value.basis == "per_year"
    assert str(ded.value.number) == "250"
    coins = next(f for f in x.facts if f.benefit_label == "Coinsurance")
    # "80% after Deductible": no printed basis - verified as the printed words, not a number
    assert coins.state != "verified" or (coins.value is not None and coins.value.kind == "text")
