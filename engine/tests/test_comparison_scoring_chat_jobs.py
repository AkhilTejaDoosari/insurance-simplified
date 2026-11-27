from collections.abc import Mapping

import pytest
from pydantic import ValidationError

from app.schemas.chat import ChatAnswer, ChatRoute, Citation
from app.schemas.comparison import Comparison, ComparisonRow, ImportanceGroup, Section
from app.schemas.facts import Fact
from app.schemas.jobs import JobState, can_transition
from app.schemas.plans import PlanFamily, PlanLevel
from app.schemas.scoring import MatchScore, NeedImportance, NeedOutcome, NeedResult
from tests.factories import SHA, evidence, fact, not_mentioned, span


def row(section: Section, cells: Mapping[str, Fact]) -> ComparisonRow:
    return ComparisonRow.model_validate(
        {
            "key": "deductible",
            "label": "Deductible",
            "group": ImportanceGroup.MUST_KNOW,
            "weight": 1.0,
            "section": section,
            "cells": cells,
        }
    )


def test_sections_follow_which_documents_state_the_benefit() -> None:
    a, b, c = fact(plan_id="a"), fact(plan_id="b"), fact(plan_id="c")
    nm_c = not_mentioned("c", ["a", "b"])
    Comparison(plan_ids=["a", "b", "c"], rows=[row(Section.IN_ALL, {"a": a, "b": b, "c": c})])
    Comparison(plan_ids=["a", "b", "c"], rows=[row(Section.IN_SOME, {"a": a, "b": b, "c": nm_c})])
    with pytest.raises(ValidationError, match="in_some"):
        Comparison(
            plan_ids=["a", "b", "c"], rows=[row(Section.IN_ALL, {"a": a, "b": b, "c": nm_c})]
        )
    only = {"a": a, "b": not_mentioned("b", ["a"]), "c": not_mentioned("c", ["a"])}
    Comparison(plan_ids=["a", "b", "c"], rows=[row(Section.ONLY_ONE, only)])


def test_every_selected_plan_has_exactly_one_cell() -> None:
    with pytest.raises(ValidationError, match="one cell"):
        Comparison(plan_ids=["a", "b"], rows=[row(Section.ONLY_ONE, {"a": fact(plan_id="a")})])
    with pytest.raises(ValidationError, match="another plan"):
        Comparison(
            plan_ids=["a", "b"],
            rows=[row(Section.IN_ALL, {"a": fact(plan_id="a"), "b": fact(plan_id="a")})],
        )


def result(key: str, outcome: NeedOutcome, must: bool = False) -> NeedResult:
    importance = NeedImportance.MUST_HAVE if must else NeedImportance.NICE_TO_HAVE
    fact_id = "f" if outcome in {NeedOutcome.MET, NeedOutcome.NOT_MET} else None
    return NeedResult(need_key=key, importance=importance, outcome=outcome, fact_id=fact_id)


def test_score_arithmetic_excludes_unconfirmed_and_not_mentioned() -> None:
    results = [
        result("max", NeedOutcome.MET, must=True),
        result("er", NeedOutcome.NOT_MET, must=True),
        result("pre", NeedOutcome.UNCONFIRMED),
        result("dental", NeedOutcome.NOT_SCORED_NOT_MENTIONED),
    ]
    assert MatchScore(plan_id="a", percent=50, results=results, missed_must_haves=["er"])
    with pytest.raises(ValidationError, match="percent must be 50"):
        MatchScore(plan_id="a", percent=75, results=results, missed_must_haves=["er"])
    with pytest.raises(ValidationError, match="must-have"):
        MatchScore(plan_id="a", percent=50, results=results, missed_must_haves=[])


def test_score_rounds_half_up() -> None:
    results = [result("a", NeedOutcome.MET)] + [
        result(f"n{i}", NeedOutcome.NOT_MET) for i in range(7)
    ]  # 1 of 8 = 12.5 -> 13
    assert MatchScore(plan_id="a", percent=13, results=results).percent == 13


def test_met_must_cite_a_fact() -> None:
    with pytest.raises(ValidationError):
        NeedResult(need_key="x", importance=NeedImportance.MUST_HAVE, outcome=NeedOutcome.MET)


def test_chat_routes_keep_document_answers_and_general_info_apart() -> None:
    cite = Citation(document_sha256=SHA, page=1, span=span())
    assert ChatAnswer(route=ChatRoute.DOCUMENT_FACT, text="t", citations=[cite])
    assert ChatAnswer(route=ChatRoute.GENERAL_TERM, text="Coinsurance means ...")
    with pytest.raises(ValidationError):
        ChatAnswer(route=ChatRoute.DOCUMENT_FACT, text="t")
    with pytest.raises(ValidationError):
        ChatAnswer(route=ChatRoute.GENERAL_TERM, text="t", citations=[cite])
    with pytest.raises(ValidationError):
        ChatAnswer(route=ChatRoute.COMPARISON, text="t")
    with pytest.raises(ValidationError):
        ChatAnswer(route=ChatRoute.CALCULATION, text="t", fact_ids=["f"])
    with pytest.raises(ValidationError):
        ChatAnswer(route=ChatRoute.REFUSE, text="t", fact_ids=["f"])


def test_job_transitions() -> None:
    assert can_transition(JobState.UPLOADED, JobState.PARSING)
    assert can_transition(JobState.PARSING, JobState.PARSING)  # idempotent retry
    assert can_transition(JobState.EXTRACTING, JobState.CANCELLED)
    assert not can_transition(JobState.UPLOADED, JobState.VERIFYING)
    assert not can_transition(JobState.COMPLETED, JobState.FAILED)
    assert not can_transition(JobState.CANCELLED, JobState.PARSING)


def test_levels_stay_in_document_order_and_are_named() -> None:
    lvl = [
        PlanLevel(id=f"l{i}", name=n, order=i, evidence=[evidence()])
        for i, n in enumerate(["Basic", "Gold", "Platinum"])
    ]
    assert PlanFamily(id="globe", name="Globe", document_sha256=SHA, levels=lvl)
    with pytest.raises(ValidationError, match="order"):
        PlanFamily(id="g", name="G", document_sha256=SHA, levels=list(reversed(lvl)))
    unnamed = [
        PlanLevel(id="x", order=0, evidence=[evidence()]),
        PlanLevel(id="y", name="Gold", order=1, evidence=[evidence()]),
    ]
    with pytest.raises(ValidationError, match="name"):
        PlanFamily(id="g", name="G", document_sha256=SHA, levels=unnamed)
