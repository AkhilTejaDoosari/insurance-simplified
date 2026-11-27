"""Engine facts -> user contract; the contract's own validators are the last gate."""

from typing import Any

import pytest

from app.reconcile.layout import read_layouts
from app.recovery.pipeline import Engines, RecoveryPipeline
from app.recovery.present import page_text, to_contract
from app.schemas.document import ParserInfo
from app.schemas.facts import Basis, FactState, NetworkTier
from tests.test_reconcile import _doc, _pdf
from tests.test_recovery import NET, OPEN, FakeReader, _auth
from tests.test_semantic import FakeJudge


@pytest.fixture(autouse=True)
def _prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for provider in ("NVIDIA", "ANTHROPIC"):
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_IN", "0")
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_OUT", "0")


def _facts(judge: FakeJudge | None, rows: list[tuple[str, str, str]]) -> tuple[Any, bytes]:
    pdf = _pdf()
    reader = FakeReader(_doc("opendataloader", rows))
    result = RecoveryPipeline(Engines(reader, judge=judge), policy=OPEN).run(pdf, _auth(pdf))
    return result, pdf


def _contract(fact: Any, pdf: bytes, sha: str) -> list[Any]:
    layouts = {lay.number: lay for lay in read_layouts(pdf)}
    return to_contract(
        fact,
        fact.readings,
        fact.judge,
        layouts=layouts,
        document_sha256=sha,
        plan_id="plan-a",
        parser=ParserInfo(name="opendataloader", version="test"),
    )


def test_presentable_fact_is_verified_with_both_keys_and_its_span() -> None:
    result, pdf = _facts(FakeJudge(), [("Specialist visit", NET, "$45 copay/visit")])
    fact = next(f for f in result.facts if f.fact.label == "Specialist visit")
    assert fact.presentable_as_verified, (fact.open_conditions, fact.semantic_reasons)
    (c,) = _contract(fact, pdf, result.document_sha256)
    assert c.state is FactState.VERIFIED
    assert c.value.number == 45 and c.value.basis is Basis.PER_VISIT
    assert c.qualifiers.network_tier is NetworkTier.IN_NETWORK
    assert c.provenance.structural_check.passed and c.provenance.judge_check.passed
    span = c.evidence[0].value_span
    text = page_text(read_layouts(pdf)[0])
    assert text[span.start : span.end] == "$45 copay/visit"


def test_printed_not_covered_is_not_covered_with_both_keys() -> None:
    result, pdf = _facts(FakeJudge(), [("Urgent care", "Out-of-Network Provider", "Not covered")])
    fact = next(f for f in result.facts if f.fact.value == "Not covered")
    (c,) = _contract(fact, pdf, result.document_sha256)
    assert c.state is FactState.NOT_COVERED and c.value is None and c.semantics.negated


def test_anything_unconfirmed_is_couldnt_confirm_with_its_page() -> None:
    result, pdf = _facts(None, [("Specialist visit", NET, "$45 copay/visit")])
    fact = next(f for f in result.facts if f.fact.label == "Specialist visit")
    (c,) = _contract(fact, pdf, result.document_sha256)
    assert c.state is FactState.COULDNT_CONFIRM and c.check_page == 1 and c.value is None
