"""/v1/extract with Claude text recovery: Claude proposes, code verifies (fakes only)."""

from typing import Any

import pytest

from app.api.extract import document_cost_cap, extract_pdf
from app.parsing.base import sha256
from app.providers.base import ModelReply, Usage
from app.reconcile.layout import read_layouts
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from app.recovery.present import page_text
from tests.test_labelled import _brochure

PDF = _brochure()
ALLOW = CloudPolicy(
    enabled_providers=frozenset({"anthropic"}),
    retention_reviewed=frozenset({"anthropic", "kodekey"}),
    customer_documents_approved=True,
)
AUTH = CloudAuthorization(
    sha256(PDF), DocumentClass.CUSTOMER, frozenset({"anthropic"}), "caller_consent"
)
PROPOSALS = {
    "facts": [],
    "clauses": [],
    "values": [
        {"page": 1, "label": "Deductible", "value": "$250", "quote": "$250 per Policy Year"},
        {"page": 1, "label": "Coinsurance", "value": "80%", "quote": "80% after Deductible"},
        {
            "page": 1,
            "label": "Emergency Room",
            "value": "$250 copay per visit",
            "quote": "$250 copay per visit, then 100% of Usual & Customary",
        },
        # invented: not printed on the page
        {"page": 1, "label": "Hospital", "value": "$1,000", "quote": "$1,000 per day"},
        # a real value under the wrong label
        {"page": 1, "label": "Prescription Drugs", "value": "80%", "quote": "80% after Deductible"},
        # truncated quote
        {"page": 1, "label": "Deductible", "value": "$250", "quote": "$250"},
    ],
}


class FakeClaude:
    model = "claude-opus-5-5"

    def __init__(self, data: Any = PROPOSALS) -> None:
        self.data = data
        self.calls = 0

    def complete_json(self, system: str, user: str, *_: Any) -> ModelReply:
        self.calls += 1
        assert "values" in system or "brochure" in system.lower()
        return ModelReply("anthropic", self.model, self.data, Usage(4_000, 1_500), 0.01)


@pytest.fixture(autouse=True)
def price(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENGINE_PRICE_ANTHROPIC_IN", "4")
    monkeypatch.setenv("ENGINE_PRICE_ANTHROPIC_OUT", "20")
    monkeypatch.delenv("ENGINE_DOCUMENT_COST_CAP_USD", raising=False)


def test_claude_lines_come_back_with_exact_quotes_and_pages() -> None:
    claude = FakeClaude()
    x = extract_pdf(PDF, "plan-a", AUTH, text_model=claude, policy=ALLOW)
    assert claude.calls >= 1 and x.model_calls == claude.calls
    quotes = {p.text for p in x.printed.values()}
    assert "$250 per Policy Year" in quotes
    assert "80% after Deductible" in quotes
    assert "$250 copay per visit, then 100% of Usual Customary" in quotes  # "&" not in layer
    assert "$1,000 per day" not in quotes and "$250" not in quotes
    text = page_text(read_layouts(PDF)[0])
    assert all(q in text for q in quotes)  # every quote is printed on its page
    by_id = {f.id: f for f in x.facts}
    labels = {by_id[i].benefit_label for i, p in x.printed.items()}
    assert "Prescription Drugs" not in labels  # wrong label refused
    assert {f.state for f in x.facts} == {"couldnt_confirm"}  # no key 2 without a judge
    assert all(f.check_page == 1 for f in x.facts)
    assert x.model_cost_usd == pytest.approx(claude.calls * (4_000 * 4 + 1_500 * 20) / 1e6)


def test_no_consent_no_call() -> None:
    claude = FakeClaude()
    x = extract_pdf(PDF, "plan-a", None, text_model=claude, policy=ALLOW)
    assert claude.calls == 0 and x.model_calls == 0 and x.model_cost_usd == 0


def test_policy_that_does_not_allow_customer_documents_refuses() -> None:
    claude = FakeClaude()
    policy = CloudPolicy(ALLOW.enabled_providers, ALLOW.retention_reviewed, False)
    x = extract_pdf(PDF, "plan-a", AUTH, text_model=claude, policy=policy)
    assert claude.calls == 0 and x.model_calls == 0


def test_cost_cap_refuses_a_call_whose_worst_case_does_not_fit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENGINE_PRICE_ANTHROPIC_OUT", "200")  # 8k output tokens = $1.60
    claude = FakeClaude()
    x = extract_pdf(PDF, "plan-a", AUTH, text_model=claude, policy=ALLOW)
    assert claude.calls == 0 and x.model_cost_usd == 0


def test_cost_cap_is_never_above_one_dollar(monkeypatch: pytest.MonkeyPatch) -> None:
    assert document_cost_cap() == 1.0
    monkeypatch.setenv("ENGINE_DOCUMENT_COST_CAP_USD", "5")
    assert document_cost_cap() == 1.0
    monkeypatch.setenv("ENGINE_DOCUMENT_COST_CAP_USD", "0.25")
    assert document_cost_cap() == 0.25


def test_unruled_table_cell_proposal_is_rechecked_as_a_brochure_line() -> None:
    cell = {"page": 1, "group_label": "", "column_header": "Benefit Amount"}
    data = {
        "facts": [
            {**cell, "row_label": "Deductible", "value": "$250 per Policy Year"},
            {**cell, "row_label": "Coinsurance", "value": "$250 per Policy Year"},  # wrong row
        ],
        "clauses": [],
        "values": [],
    }
    x = extract_pdf(PDF, "plan-a", AUTH, text_model=FakeClaude(data), policy=ALLOW)
    by_id = {f.id: f for f in x.facts}
    got = {(by_id[i].benefit_label, p.text, p.column_header) for i, p in x.printed.items()}
    assert ("Deductible", "$250 per Policy Year", "") in got  # invented header not carried
    assert not any(label == "Coinsurance" for label, *_ in got)


def test_facts_carry_their_category_and_absent_categories_are_searched() -> None:
    x = extract_pdf(PDF, "plan-a", AUTH, text_model=FakeClaude(), policy=ALLOW)
    keys = {f.benefit_label: f.category_key for f in x.facts}
    assert keys["Deductible"] == "ded" and keys["Coinsurance"] == "coins"
    assert keys["Emergency Room"] == "er"
    assert "ded" not in x.category_search  # found as a fact
    assert x.category_search["rx"] == 1  # "Prescription Drugs" is printed: check page 1
    assert x.category_search["mat"] is None  # no maternity wording anywhere
    assert {c.key for c in x.categories} >= {"ded", "oop", "er", "hosp", "rx", "pre"}
