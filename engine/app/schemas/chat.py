"""Chat answers carry their route; document answers and general info never mix."""

from enum import StrEnum
from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import ContractModel, Identifier, PageNumber, Sha256
from app.schemas.document import TextSpan


class ChatRoute(StrEnum):
    COMPARISON = "comparison"
    DOCUMENT_FACT = "document_fact"
    CALCULATION = "calculation"
    GENERAL_TERM = "general_term"
    NOT_MENTIONED = "not_mentioned"
    REFUSE = "refuse"


class Citation(ContractModel):
    document_sha256: Sha256
    page: PageNumber
    span: TextSpan


class ChatAnswer(ContractModel):
    route: ChatRoute
    text: str = Field(min_length=1)
    plan_ids_named: list[Identifier] = Field(default_factory=list)
    fact_ids: list[Identifier] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _route_rules(self) -> Self:
        r = self.route
        if r is ChatRoute.DOCUMENT_FACT and not self.citations:
            raise ValueError("document answers cite the page they come from")
        if r in {ChatRoute.COMPARISON, ChatRoute.CALCULATION} and not self.fact_ids:
            raise ValueError("comparison and calculation answers come from verified facts")
        if r is ChatRoute.CALCULATION and not self.assumptions:
            raise ValueError("calculations state their assumptions")
        if r in {ChatRoute.GENERAL_TERM, ChatRoute.REFUSE} and (self.citations or self.fact_ids):
            raise ValueError("general info and refusals never carry document evidence")
        if r is not ChatRoute.CALCULATION and self.assumptions:
            raise ValueError("only calculations carry assumptions")
        return self
