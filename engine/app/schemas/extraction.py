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


class CategoryInfo(ContractModel):
    """A dictionary category (US pack). Used only to match wording and order rows."""

    key: str = Field(min_length=1)
    name: str = Field(min_length=1)
    tier: int = Field(ge=1, le=3, description="1 must know, 2 important, 3 good to know")
    order: int = Field(ge=0, description="Display order inside the tier.")
    explain: str = Field(description="One-line general explanation ('general info').")


class Printed(ContractModel):
    """The exact printed words a fact's evidence span covers, and its printed column."""

    text: str = Field(min_length=1)
    column_header: str = ""


class ModelUsage(ContractModel):
    provider: str
    model: str
    stage: str = Field(description="text | judge | plain (recovery stage).")
    calls: int = Field(ge=0, description="Calls sent (cached replies are not counted).")
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cost_usd: float | None = Field(default=None, ge=0)


class TokenAllowance(ContractModel):
    cap: int = Field(ge=1, description="ENGINE_CLAUDE_TOKEN_CAP: cumulative Claude tokens.")
    committed: int = Field(ge=0, description="Claude tokens used so far, all documents.")
    remaining: int = Field(ge=0)


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
    model_calls: int = Field(default=0, description="Cloud model calls made for this document.")
    dictionary_version: str = Field(default="", description="Category dictionary version.")
    categories: list[CategoryInfo] = Field(
        default_factory=list, description="The category dictionary the facts were mapped with."
    )
    category_search: dict[str, PageNumber | None] = Field(
        default_factory=dict,
        description="For each dictionary category no fact of this document maps to: the first "
        "page where one of its dictionary wordings is printed (couldn't confirm - check that "
        "page), or null when none is printed anywhere. Searched by the dictionary's wording "
        "only, not by meaning.",
    )
    plain: dict[str, str] = Field(
        default_factory=dict,
        description="Fact id -> one plain-words line, only for VERIFIED facts, written only "
        "from the fact's printed label and quote and checked against them (explanation, "
        "never evidence).",
    )
    checks_incomplete: bool = Field(
        default=False,
        description="True when model checks the user consented to could not all run (a "
        "provider refused - budget, rate limit, unprocessable - timed out, failed, or a "
        "cost or token cap was reached). What the local readers verified is still "
        "returned; everything else is couldn't confirm with its page.",
    )
    checks_incomplete_reasons: list[str] = Field(
        default_factory=list, description="Why, as short codes (never document content)."
    )
    model_usage: list[ModelUsage] = Field(
        default_factory=list, description="Tokens and cost per provider and stage."
    )
    claude_tokens: TokenAllowance | None = Field(
        default=None, description="The cumulative Claude token allowance, when one is set."
    )
    model_cost_usd: float | None = Field(
        default=0.0,
        ge=0,
        description="USD charged for this document's model calls at list price "
        "(capped per document); null when a call's cost could not be known.",
    )
