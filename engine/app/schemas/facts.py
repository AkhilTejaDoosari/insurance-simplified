"""Fact schema (one-way doors #3 and #4).

The five states are kept apart on purpose: "not mentioned" is never "not
covered", and a failed check is never "not mentioned". The validators below are
the guardrails: a fact that breaks one cannot be constructed, so it cannot
reach the web app.
"""

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import ContractModel, CurrencyCode, Identifier, PageNumber, Sha256
from app.schemas.document import BBox, ParserInfo, TextSpan


class FactState(StrEnum):
    VERIFIED = "verified"
    NOT_COVERED = "not_covered"
    NOT_MENTIONED = "not_mentioned"
    COULDNT_CONFIRM = "couldnt_confirm"
    CONFLICTING = "conflicting"


class Basis(StrEnum):
    """What an amount applies to. Amounts are never shown without one."""

    PER_YEAR = "per_year"
    PER_INCIDENT = "per_incident"
    PER_VISIT = "per_visit"
    PER_DAY = "per_day"
    PER_ADMISSION = "per_admission"
    PER_PERIOD_OF_COVERAGE = "per_period_of_coverage"
    LIFETIME = "lifetime"
    NOT_APPLICABLE = "not_applicable"
    UNCLEAR = "unclear"


class YearKind(StrEnum):
    CALENDAR = "calendar"
    POLICY = "policy"
    UNSPECIFIED = "unspecified"


class ValueKind(StrEnum):
    AMOUNT = "amount"
    PERCENT = "percent"
    COUNT = "count"
    DURATION_DAYS = "duration_days"
    COVERED = "covered"
    TEXT = "text"


NUMERIC_KINDS = frozenset({ValueKind.AMOUNT, ValueKind.PERCENT, ValueKind.COUNT})


class NetworkTier(StrEnum):
    IN_NETWORK = "in_network"
    OUT_OF_NETWORK = "out_of_network"
    ANY = "any"
    UNSPECIFIED = "unspecified"


class PersonLevel(StrEnum):
    INDIVIDUAL = "individual"
    FAMILY = "family"
    UNSPECIFIED = "unspecified"


class FactScope(StrEnum):
    SHARED = "shared"
    LEVEL_SPECIFIC = "level_specific"


class FactValue(ContractModel):
    kind: ValueKind
    number: Decimal | None = Field(default=None, description="Amount, percent, count or days.")
    currency: CurrencyCode | None = None
    text: str | None = Field(default=None, description="Short value in plain words.")
    basis: Basis
    year_kind: YearKind | None = None
    counts_toward_deductible: bool | None = Field(
        default=None, description="Only when the document states it."
    )

    @model_validator(mode="after")
    def _shape(self) -> Self:
        if self.kind in NUMERIC_KINDS | {ValueKind.DURATION_DAYS} and self.number is None:
            raise ValueError(f"{self.kind} values need a number")
        if self.kind is ValueKind.AMOUNT and self.currency is None:
            raise ValueError("amounts need a currency")
        if self.kind is not ValueKind.AMOUNT and self.currency is not None:
            raise ValueError("only amounts carry a currency")
        if self.kind in NUMERIC_KINDS and self.basis is Basis.NOT_APPLICABLE:
            raise ValueError("numeric values need a basis (basis rule)")
        if (self.year_kind is not None) != (self.basis is Basis.PER_YEAR):
            raise ValueError("year_kind is set exactly when basis is per_year")
        return self


class Qualifiers(ContractModel):
    network_tier: NetworkTier = NetworkTier.UNSPECIFIED
    person_level: PersonLevel = PersonLevel.UNSPECIFIED
    condition: str | None = None
    plan_level_id: Identifier | None = None


class Semantics(ContractModel):
    negated: bool = False
    exceptions: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    limits: list[str] = Field(default_factory=list)


class Evidence(ContractModel):
    document_sha256: Sha256
    page: PageNumber
    printed_page: str | None = None
    value_span: TextSpan
    row_label_span: TextSpan | None = None
    column_header_spans: list[TextSpan] = Field(default_factory=list)
    bbox: BBox | None = None

    @model_validator(mode="after")
    def _spans_on_this_page(self) -> Self:
        spans = [self.value_span, *self.column_header_spans]
        if self.row_label_span:
            spans.append(self.row_label_span)
        if any(s.page != self.page for s in spans):
            raise ValueError("every evidence span must be on the evidence page")
        return self


class CheckResult(ContractModel):
    passed: bool
    checker: str = Field(min_length=1, description="Code check name or model id.")
    checker_version: str = Field(min_length=1)
    model_family: str | None = Field(default=None, description="Set for model-based checks.")
    reasons: list[str] = Field(default_factory=list)


class Provenance(ContractModel):
    parser: ParserInfo
    extractor_model: str | None = None
    extractor_model_family: str | None = None
    prompt_version: str | None = None
    structural_check: CheckResult | None = None
    judge_check: CheckResult | None = None
    created_at: datetime


class Fact(ContractModel):
    id: Identifier
    plan_id: Identifier
    benefit_label: str = Field(min_length=1, description="The document's own wording.")
    category_key: str | None = Field(
        default=None, description="Dictionary category, used only to match and order rows."
    )
    state: FactState
    scope: FactScope = FactScope.SHARED
    value: FactValue | None = None
    qualifiers: Qualifiers = Field(default_factory=Qualifiers)
    semantics: Semantics = Field(default_factory=Semantics)
    evidence: list[Evidence] = Field(default_factory=list)
    provenance: Provenance
    check_page: PageNumber | None = Field(
        default=None, description="Where the user should look (couldn't confirm)."
    )
    searched_document: bool = Field(
        default=False, description="The whole document was searched before 'not mentioned'."
    )
    mentioned_by_plan_ids: list[Identifier] = Field(
        default_factory=list,
        description="Other selected plans that state this benefit (not mentioned only).",
    )

    @model_validator(mode="after")
    def _state_rules(self) -> Self:  # noqa: PLR0912 - one rule per state, kept together
        match self.state:
            case FactState.VERIFIED:
                if self.value is None or not self.evidence:
                    raise ValueError("verified needs a value and evidence")
                if self.value.basis is Basis.UNCLEAR:
                    raise ValueError("an unclear basis can't be verified (couldn't confirm)")
                self._require_both_keys()
            case FactState.NOT_COVERED:
                if not self.evidence:
                    raise ValueError("not covered needs the exclusion as evidence")
                self._require_both_keys()
            case FactState.NOT_MENTIONED:
                if self.value is not None or self.evidence:
                    raise ValueError("not mentioned has no value and no evidence")
                if not self.searched_document:
                    raise ValueError("search the document before saying not mentioned")
                if not self.mentioned_by_plan_ids or self.plan_id in self.mentioned_by_plan_ids:
                    raise ValueError("not mentioned is relative to another selected plan")
            case FactState.COULDNT_CONFIRM:
                if self.check_page is None:
                    raise ValueError("couldn't confirm needs a page for the user to check")
            case FactState.CONFLICTING:
                if len(self.evidence) < 2:
                    raise ValueError("conflicting needs at least two pieces of evidence")
        if self.state is not FactState.NOT_MENTIONED and self.mentioned_by_plan_ids:
            raise ValueError("mentioned_by_plan_ids is only for not mentioned")
        if self.scope is FactScope.LEVEL_SPECIFIC:
            if self.qualifiers.plan_level_id is None:
                raise ValueError("level-specific facts name their plan level")
            if self.state is FactState.VERIFIED and not all(
                e.column_header_spans for e in self.evidence
            ):
                raise ValueError("a level-specific value is verified only with its column header")
        return self

    def _require_both_keys(self) -> None:
        s, j, p = self.provenance.structural_check, self.provenance.judge_check, self.provenance
        if not (s and s.passed and j and j.passed):
            raise ValueError("verified and not covered need both checks to pass (two keys)")
        if j.model_family is None:
            raise ValueError("the judge check must name its model family")
        if p.extractor_model_family is not None and j.model_family == p.extractor_model_family:
            raise ValueError("the judge must come from a different model family than the extractor")
