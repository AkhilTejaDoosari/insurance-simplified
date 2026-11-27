"""One-way-door guardrails on facts: a fact that breaks a rule can't be built."""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.facts import (
    Basis,
    Evidence,
    FactScope,
    FactState,
    FactValue,
    Qualifiers,
    ValueKind,
)
from tests.factories import SHA, amount, evidence, fact, not_mentioned, provenance, span


def test_five_states_exactly() -> None:
    assert {s.value for s in FactState} == {
        "verified",
        "not_covered",
        "not_mentioned",
        "couldnt_confirm",
        "conflicting",
    }


def test_valid_verified_fact() -> None:
    assert fact().state is FactState.VERIFIED


@pytest.mark.parametrize(
    "overrides",
    [
        {"value": None},
        {"evidence": []},
        {"provenance": provenance(structural=False)},
        {"provenance": provenance(judge=False)},
        {"provenance": provenance(judge_family=None)},
        {"provenance": provenance(judge_family="family-a", extractor_family="family-a")},
        {"value": amount(basis=Basis.UNCLEAR)},
    ],
    ids=[
        "no-value",
        "no-evidence",
        "structural-key-failed",
        "judge-key-failed",
        "judge-family-unknown",
        "judge-same-family",
        "unclear-basis",
    ],
)
def test_verified_needs_both_keys_evidence_and_basis(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        fact(**overrides)


def test_not_covered_needs_exclusion_evidence_and_both_keys() -> None:
    assert fact(state=FactState.NOT_COVERED, value=None).state is FactState.NOT_COVERED
    with pytest.raises(ValidationError):
        fact(state=FactState.NOT_COVERED, value=None, evidence=[])
    with pytest.raises(ValidationError):
        fact(state=FactState.NOT_COVERED, value=None, provenance=provenance(judge=False))


def test_not_mentioned_is_relative_and_searched() -> None:
    assert not_mentioned("plan-b", ["plan-a"]).state is FactState.NOT_MENTIONED
    with pytest.raises(ValidationError, match="relative"):
        not_mentioned("plan-b", [])
    with pytest.raises(ValidationError, match="relative"):
        not_mentioned("plan-b", ["plan-b"])
    with pytest.raises(ValidationError, match="search"):
        fact(
            state=FactState.NOT_MENTIONED,
            value=None,
            evidence=[],
            mentioned_by_plan_ids=["plan-x"],
        )
    with pytest.raises(ValidationError):
        fact(
            state=FactState.NOT_MENTIONED,
            searched_document=True,
            mentioned_by_plan_ids=["plan-x"],
        )


def test_mentioned_by_only_for_not_mentioned() -> None:
    with pytest.raises(ValidationError):
        fact(mentioned_by_plan_ids=["plan-x"])


def test_couldnt_confirm_points_to_a_page() -> None:
    ok = fact(
        state=FactState.COULDNT_CONFIRM,
        value=amount(basis=Basis.UNCLEAR),
        provenance=provenance(judge=False),
        check_page=3,
    )
    assert ok.check_page == 3
    with pytest.raises(ValidationError, match="page"):
        fact(state=FactState.COULDNT_CONFIRM, provenance=provenance(judge=False))


def test_conflicting_needs_two_pieces_of_evidence() -> None:
    assert fact(state=FactState.CONFLICTING, evidence=[evidence(1), evidence(2)])
    with pytest.raises(ValidationError):
        fact(state=FactState.CONFLICTING)


def test_level_specific_needs_level_and_column_header() -> None:
    level = Qualifiers(plan_level_id="gold")
    ok = fact(scope=FactScope.LEVEL_SPECIFIC, qualifiers=level, evidence=[evidence(header=True)])
    assert ok.scope is FactScope.LEVEL_SPECIFIC
    with pytest.raises(ValidationError, match="level"):
        fact(scope=FactScope.LEVEL_SPECIFIC)
    with pytest.raises(ValidationError, match="column header"):
        fact(scope=FactScope.LEVEL_SPECIFIC, qualifiers=level)


def test_basis_rule_on_values() -> None:
    with pytest.raises(ValidationError, match="basis"):
        FactValue(
            kind=ValueKind.AMOUNT, number=Decimal(1), currency="USD", basis=Basis.NOT_APPLICABLE
        )
    with pytest.raises(ValidationError, match="currency"):
        FactValue(kind=ValueKind.AMOUNT, number=Decimal(1), basis=Basis.PER_VISIT)
    with pytest.raises(ValidationError, match="year_kind"):
        FactValue(kind=ValueKind.AMOUNT, number=Decimal(1), currency="USD", basis=Basis.PER_YEAR)
    with pytest.raises(ValidationError, match="number"):
        FactValue(kind=ValueKind.PERCENT, basis=Basis.PER_VISIT)
    covered = FactValue(kind=ValueKind.COVERED, basis=Basis.NOT_APPLICABLE, text="Covered")
    assert covered.number is None


def test_evidence_spans_stay_on_the_evidence_page() -> None:
    with pytest.raises(ValidationError):
        Evidence(document_sha256=SHA, page=1, value_span=span(page=2))


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        fact(confidence=0.99)
