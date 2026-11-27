import pytest
from pydantic import ValidationError

from app.schemas.common import Market
from app.schemas.document import (
    BBox,
    Block,
    BlockKind,
    Document,
    Page,
    Table,
    TableCell,
    TableColumn,
    TableRow,
)
from tests.factories import PARSER, SHA, span

TEXT = "Deductible $250 per year | Gold Platinum"


def page(number: int = 1, **kw: object) -> Page:
    base: dict[str, object] = {
        "number": number,
        "width": 612,
        "height": 792,
        "readable": True,
        "text": TEXT,
    }
    base.update(kw)
    return Page.model_validate(base)


def table(**kw: object) -> Table:
    base: dict[str, object] = {
        "id": "t1",
        "page": 1,
        "columns": [TableColumn(id="gold", header_path=["Gold"], header_spans=[span(27, 31)])],
        "rows": [TableRow(id="ded", label="Deductible", label_span=span(0, 10))],
        "cells": [TableCell(row_id="ded", column_id="gold", text="$250", span=span(11, 15))],
    }
    base.update(kw)
    return Table.model_validate(base)


def test_valid_document_with_table_and_printed_page() -> None:
    doc = Document(
        sha256=SHA,
        market=Market.US,
        currency="USD",
        language="en",
        parser=PARSER,
        pages=[page(printed_label="2", tables=[table()])],
    )
    assert doc.model_version == "1.0"
    assert doc.pages[0].printed_label == "2"


def test_pages_must_be_numbered_in_order() -> None:
    with pytest.raises(ValidationError):
        Document(
            sha256=SHA,
            market=Market.US,
            currency="USD",
            language="en",
            parser=PARSER,
            pages=[page(2)],
        )


def test_spans_must_stay_inside_their_page() -> None:
    with pytest.raises(ValidationError):
        page(blocks=[Block(id="b", kind=BlockKind.PARAGRAPH, span=span(0, 999), reading_order=0)])
    with pytest.raises(ValidationError):
        page(blocks=[Block(id="b", kind=BlockKind.PARAGRAPH, span=span(page=2), reading_order=0)])


def test_cells_reference_known_rows_and_columns() -> None:
    with pytest.raises(ValidationError):
        table(cells=[TableCell(row_id="ded", column_id="platinum", text="$0")])


def test_bbox_and_span_shape() -> None:
    with pytest.raises(ValidationError):
        BBox(x0=10, y0=0, x1=5, y1=1)
    with pytest.raises(ValidationError):
        span(5, 5)


def test_sha_and_currency_formats() -> None:
    with pytest.raises(ValidationError):
        Document(
            sha256="XYZ",
            market=Market.US,
            currency="usd",
            language="en",
            parser=PARSER,
            pages=[page()],
        )
