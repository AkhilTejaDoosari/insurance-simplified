"""Normalized, versioned document model (one-way door #2).

Every parser candidate emits this model. Text is never the only output:
reading order, tables with row and column headers, footnotes, coordinates,
and PDF page plus printed page are all first-class.

Coordinates are PDF points with the origin at the top-left of the page.
Spans are [start, end) character offsets into ``Page.text``; evidence is
verified against exactly that text.
"""

from enum import StrEnum
from typing import Literal, Self

from pydantic import Field, model_validator

from app.schemas.common import (
    ContractModel,
    CurrencyCode,
    Identifier,
    LanguageTag,
    Market,
    PageNumber,
    Sha256,
)

DOCUMENT_MODEL_VERSION: Literal["1.0"] = "1.0"


class BBox(ContractModel):
    x0: float = Field(ge=0)
    y0: float = Field(ge=0)
    x1: float = Field(ge=0)
    y1: float = Field(ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.x1 < self.x0 or self.y1 < self.y0:
            raise ValueError("bbox corners must be ordered (x0<=x1, y0<=y1)")
        return self


class TextSpan(ContractModel):
    page: PageNumber
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def _non_empty(self) -> Self:
        if self.end <= self.start:
            raise ValueError("span must be non-empty (end > start)")
        return self


class ParserInfo(ContractModel):
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)


class BlockKind(StrEnum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    PAGE_HEADER = "page_header"
    PAGE_FOOTER = "page_footer"
    CAPTION = "caption"
    OTHER = "other"


class Block(ContractModel):
    id: Identifier
    kind: BlockKind
    span: TextSpan
    bbox: BBox | None = None
    reading_order: int = Field(ge=0)


class TableColumn(ContractModel):
    id: Identifier
    header_path: list[str] = Field(
        description="Header text from outermost to innermost row (multi-row headers)."
    )
    header_spans: list[TextSpan] = Field(default_factory=list)


class TableRow(ContractModel):
    id: Identifier
    label: str
    label_span: TextSpan | None = None
    group_labels: list[str] = Field(
        default_factory=list,
        description="Labels of the row groups this row sits under (outermost first).",
    )


class TableCell(ContractModel):
    row_id: Identifier
    column_id: Identifier
    text: str
    span: TextSpan | None = None
    bbox: BBox | None = None
    row_span: int = Field(default=1, ge=1)
    col_span: int = Field(default=1, ge=1)


class Table(ContractModel):
    id: Identifier
    page: PageNumber
    bbox: BBox | None = None
    columns: list[TableColumn]
    rows: list[TableRow]
    cells: list[TableCell]

    @model_validator(mode="after")
    def _cells_reference_known_rows_and_columns(self) -> Self:
        rows = {r.id for r in self.rows}
        cols = {c.id for c in self.columns}
        for cell in self.cells:
            if cell.row_id not in rows or cell.column_id not in cols:
                raise ValueError(f"cell ({cell.row_id}, {cell.column_id}) references unknown ids")
        return self


class Footnote(ContractModel):
    marker: str = Field(min_length=1)
    span: TextSpan


class Page(ContractModel):
    number: PageNumber
    printed_label: str | None = Field(
        default=None, description="Page number printed on the page, if any."
    )
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    readable: bool = Field(description="False for image-only pages (no text layer).")
    text: str
    blocks: list[Block] = Field(default_factory=list)
    tables: list[Table] = Field(default_factory=list)
    footnotes: list[Footnote] = Field(default_factory=list)

    @model_validator(mode="after")
    def _spans_inside_this_page(self) -> Self:
        spans: list[TextSpan] = [b.span for b in self.blocks] + [f.span for f in self.footnotes]
        for table in self.tables:
            if table.page != self.number:
                raise ValueError("table.page must equal the page number")
            spans += [s for c in table.columns for s in c.header_spans]
            spans += [r.label_span for r in table.rows if r.label_span]
            spans += [c.span for c in table.cells if c.span]
        for span in spans:
            if span.page != self.number or span.end > len(self.text):
                raise ValueError("span lies outside this page's text")
        return self


class Document(ContractModel):
    model_version: Literal["1.0"] = DOCUMENT_MODEL_VERSION
    sha256: Sha256
    market: Market
    currency: CurrencyCode
    language: LanguageTag
    parser: ParserInfo
    pages: list[Page] = Field(min_length=1)

    @model_validator(mode="after")
    def _pages_numbered_in_order(self) -> Self:
        if [p.number for p in self.pages] != list(range(1, len(self.pages) + 1)):
            raise ValueError("pages must be numbered 1..n in order")
        return self
