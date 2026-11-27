"""Valid contract objects for tests. Synthetic only: no real document text."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from app.schemas.document import ParserInfo, TextSpan
from app.schemas.facts import (
    Basis,
    CheckResult,
    Evidence,
    Fact,
    FactState,
    FactValue,
    Provenance,
    ValueKind,
    YearKind,
)

SHA = "a" * 64
PARSER = ParserInfo(name="synthetic", version="0")


def span(start: int = 0, end: int = 4, page: int = 1) -> TextSpan:
    return TextSpan(page=page, start=start, end=end)


def evidence(page: int = 1, header: bool = False) -> Evidence:
    return Evidence(
        document_sha256=SHA,
        page=page,
        value_span=span(10, 14, page),
        row_label_span=span(0, 9, page),
        column_header_spans=[span(20, 24, page)] if header else [],
    )


def check(passed: bool = True, family: str | None = None) -> CheckResult:
    return CheckResult(passed=passed, checker="c", checker_version="1", model_family=family)


def provenance(
    structural: bool = True,
    judge: bool = True,
    judge_family: str | None = "family-b",
    extractor_family: str | None = "family-a",
) -> Provenance:
    return Provenance(
        parser=PARSER,
        extractor_model="extractor",
        extractor_model_family=extractor_family,
        prompt_version="p1",
        structural_check=check(structural),
        judge_check=check(judge, judge_family),
        created_at=datetime(2026, 11, 26, tzinfo=UTC),
    )


def amount(n: str = "250", basis: Basis = Basis.PER_YEAR) -> FactValue:
    return FactValue(
        kind=ValueKind.AMOUNT,
        number=Decimal(n),
        currency="USD",
        basis=basis,
        year_kind=YearKind.POLICY if basis is Basis.PER_YEAR else None,
    )


def fact(**overrides: Any) -> Fact:
    base: dict[str, Any] = {
        "id": "f1",
        "plan_id": "plan-a",
        "benefit_label": "Deductible",
        "category_key": "deductible",
        "state": FactState.VERIFIED,
        "value": amount(),
        "evidence": [evidence()],
        "provenance": provenance(),
    }
    base.update(overrides)
    return Fact(**base)


def not_mentioned(plan_id: str, by: list[str]) -> Fact:
    return Fact(
        id=f"nm-{plan_id}",
        plan_id=plan_id,
        benefit_label="Deductible",
        state=FactState.NOT_MENTIONED,
        provenance=provenance(),
        searched_document=True,
        mentioned_by_plan_ids=by,
    )
