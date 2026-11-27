"""Plan families and levels: plan identity = family + level + source document."""

from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import ContractModel, Identifier, Sha256
from app.schemas.facts import Evidence


class PlanLevel(ContractModel):
    id: Identifier = Field(description="Plan id used by facts, comparison, scoring and chat.")
    name: str | None = Field(default=None, description="None when the family has one level.")
    order: int = Field(ge=0, description="Document order. Levels are never ranked by name.")
    evidence: list[Evidence] = Field(min_length=1)


class PlanFamily(ContractModel):
    id: Identifier
    name: str = Field(min_length=1)
    document_sha256: Sha256
    levels: list[PlanLevel] = Field(min_length=1)

    @model_validator(mode="after")
    def _levels_in_document_order(self) -> Self:
        if [lvl.order for lvl in self.levels] != list(range(len(self.levels))):
            raise ValueError("levels are listed in document order 0..n-1")
        if len(self.levels) > 1 and any(lvl.name is None for lvl in self.levels):
            raise ValueError("every level of a multi-level family has a name")
        if len({lvl.id for lvl in self.levels}) != len(self.levels):
            raise ValueError("level ids are unique")
        return self
