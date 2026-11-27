"""Document-relative comparison: in all / in some / only one plan.

No checklist defines what a document should contain. A benefit's section is
decided only by which selected plans state it.
"""

from enum import StrEnum
from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import ContractModel, Identifier
from app.schemas.facts import Fact, FactState


class ImportanceGroup(StrEnum):
    MUST_KNOW = "must_know"
    IMPORTANT = "important"
    GOOD_TO_KNOW = "good_to_know"
    ADMIN = "admin"


class Section(StrEnum):
    IN_ALL = "in_all"
    IN_SOME = "in_some"
    ONLY_ONE = "only_one"


class RowMarker(StrEnum):
    DIFFERS = "differs"
    DIFFERENT_BASIS = "different_basis"
    SAME_FOR_ALL_LEVELS = "same_for_all_levels"


class ComparisonRow(ContractModel):
    key: Identifier
    label: str = Field(min_length=1)
    category_key: str | None = None
    group: ImportanceGroup
    weight: float = Field(ge=0)
    section: Section
    cells: dict[Identifier, Fact]
    markers: list[RowMarker] = Field(default_factory=list)

    def stating_plans(self) -> list[str]:
        return [pid for pid, f in self.cells.items() if f.state is not FactState.NOT_MENTIONED]


class Comparison(ContractModel):
    plan_ids: list[Identifier] = Field(min_length=1, max_length=25)
    rows: list[ComparisonRow]

    @model_validator(mode="after")
    def _sections_follow_the_documents(self) -> Self:
        plans = set(self.plan_ids)
        for row in self.rows:
            if set(row.cells) != plans:
                raise ValueError(f"row {row.key} needs exactly one cell per selected plan")
            if any(f.plan_id != pid for pid, f in row.cells.items()):
                raise ValueError(f"row {row.key} has a cell filed under another plan")
            stating = len(row.stating_plans())
            expected = (
                Section.IN_ALL
                if stating == len(plans)
                else Section.ONLY_ONE
                if stating == 1
                else Section.IN_SOME
            )
            if stating == 0:
                raise ValueError(f"row {row.key} is stated by no plan")
            if len(plans) > 1 and row.section is not expected:
                raise ValueError(f"row {row.key} belongs in {expected}, not {row.section}")
        return self
