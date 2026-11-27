"""Result of reading one uploaded plan document (POST /v1/extract)."""

from pydantic import Field

from app.schemas.common import ContractModel, PageNumber
from app.schemas.document import ParserInfo
from app.schemas.facts import Fact


class OpenItem(ContractModel):
    """A printed line the engine could not settle: the user is sent to that page."""

    page: PageNumber
    state: str = Field(description="not_extracted | unresolved | conflicting | rejected")
    line: str = Field(default="", description="The printed line, as on the page.")


class Printed(ContractModel):
    """The exact printed words a fact's evidence span covers, and its printed column."""

    text: str = Field(min_length=1)
    column_header: str = ""


class Extraction(ContractModel):
    document_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    pages: int = Field(ge=1)
    parser: ParserInfo
    facts: list[Fact] = Field(
        description="Verified facts (both keys) and couldn't-confirm facts with their page."
    )
    printed: dict[str, Printed] = Field(
        default_factory=dict,
        description="Fact id -> the exact printed words (and column) of its evidence (quotes).",
    )
    open_items: list[OpenItem] = Field(default_factory=list)
    model_calls: int = Field(default=0, description="Cloud model calls made (none here).")
