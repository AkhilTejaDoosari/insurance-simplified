"""Match score: from verified facts only, arithmetic checked by the model itself."""

from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import ContractModel, Identifier
from app.schemas.facts import Basis


class NeedImportance(StrEnum):
    MUST_HAVE = "must_have"
    NICE_TO_HAVE = "nice_to_have"


class Comparator(StrEnum):
    AT_MOST = "at_most"
    AT_LEAST = "at_least"
    COVERED = "covered"


class Need(ContractModel):
    key: Identifier
    label: str = Field(min_length=1)
    category_key: str
    importance: NeedImportance
    comparator: Comparator
    threshold: Decimal | None = None
    basis: Basis | None = Field(default=None, description="Compared like basis with like basis.")

    @model_validator(mode="after")
    def _threshold_matches_comparator(self) -> Self:
        if (self.comparator is Comparator.COVERED) != (self.threshold is None):
            raise ValueError("'covered' needs no threshold; the other comparators need one")
        return self


class NeedOutcome(StrEnum):
    MET = "met"
    NOT_MET = "not_met"
    UNCONFIRMED = "unconfirmed"
    NOT_SCORED_NOT_MENTIONED = "not_scored_not_mentioned"
    NOT_SCORED_DIFFERENT_BASIS = "not_scored_different_basis"


SCORED = frozenset({NeedOutcome.MET, NeedOutcome.NOT_MET})


class NeedResult(ContractModel):
    need_key: Identifier
    importance: NeedImportance
    outcome: NeedOutcome
    fact_id: Identifier | None = None

    @model_validator(mode="after")
    def _scored_outcomes_cite_a_fact(self) -> Self:
        if self.outcome in SCORED and self.fact_id is None:
            raise ValueError("met / not met must cite the verified fact it was decided on")
        return self


class MatchScore(ContractModel):
    plan_id: Identifier
    percent: int = Field(ge=0, le=100)
    results: list[NeedResult]
    missed_must_haves: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def _arithmetic(self) -> Self:
        scored = [r for r in self.results if r.outcome in SCORED]
        met = sum(r.outcome is NeedOutcome.MET for r in scored)
        expected = (
            int((Decimal(100 * met) / len(scored)).quantize(Decimal(1), ROUND_HALF_UP))
            if scored
            else 0
        )
        if self.percent != expected:
            raise ValueError(f"percent must be {expected} ({met} met of {len(scored)} scored)")
        missed = [
            r.need_key
            for r in self.results
            if r.importance is NeedImportance.MUST_HAVE and r.outcome is NeedOutcome.NOT_MET
        ]
        if self.missed_must_haves != missed:
            raise ValueError("missed_must_haves must list every must-have that is not met")
        return self
