"""Shared building blocks for the contract."""

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    """Base for every contract model: unknown fields are rejected, instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$", description="Lowercase hex SHA-256.")]
CurrencyCode = Annotated[str, Field(pattern=r"^[A-Z]{3}$", description="ISO 4217 code.")]
LanguageTag = Annotated[str, Field(pattern=r"^[a-z]{2,3}(-[A-Z]{2})?$", description="BCP 47.")]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
PageNumber = Annotated[int, Field(ge=1, description="1-based PDF page number.")]


class Market(StrEnum):
    """Market packs. Design is market-neutral; US is the first pack."""

    US = "US"
