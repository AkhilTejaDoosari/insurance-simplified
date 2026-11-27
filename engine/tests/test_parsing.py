"""Readers emit a valid document model and read the synthetic fixtures (WP4)."""

import importlib.util

import pytest

from app.parsing.base import find_span, printed_label, table_from_grid
from app.parsing.pdfplumber_reader import PdfplumberReader
from evaluation.parser_eval import score
from evaluation.synthetic import all_fixtures, levels_ruled, network_two_row_header


def test_pdfplumber_reads_every_synthetic_fixture() -> None:
    s = score("pdfplumber", PdfplumberReader().read, all_fixtures())
    assert (s.bound, s.texts_found, s.labels_right) == (s.keyed, s.texts, s.labels)


def test_level_columns_and_spans_point_into_page_text() -> None:
    doc = PdfplumberReader().read(levels_ruled().pdf)
    page = doc.pages[0]
    table = page.tables[0]
    assert [c.header_path for c in table.columns] == [["Basic"], ["Gold"], ["Platinum"]]
    gold = next(c for c in table.cells if c.text == "$250 per policy year")
    assert gold.span is not None
    assert page.text[gold.span.start : gold.span.end] == "$250 per policy year"
    assert page.printed_label == "2"


def test_two_row_header_gives_level_and_network_path() -> None:
    table = PdfplumberReader().read(network_two_row_header().pdf).pages[0].tables[0]
    assert ["Gold", "Out-of-Network"] in [c.header_path for c in table.columns]


def test_grid_helpers() -> None:
    grid: list[list[str | None]] = [
        ["Benefit", "Gold", None],
        ["", "In", "Out"],
        ["ER", "$1", "$2"],
    ]
    table = table_from_grid(grid, 1, "t", "Benefit Gold In Out ER $1 $2")
    assert table is not None
    assert [c.header_path for c in table.columns] == [["Gold", "In"], ["Gold", "Out"]]
    assert table_from_grid([["only one row"]], 1, "t", "") is None
    assert find_span("a\nb c", "a b", 1) is not None
    assert printed_label("text\nPage 3 of 9") == "3"
    assert printed_label("Body text only") is None


@pytest.mark.skipif(importlib.util.find_spec("pymupdf") is None, reason="parser-eval group")
def test_pymupdf_emits_valid_model() -> None:
    from app.parsing.pymupdf_reader import PymupdfReader  # noqa: PLC0415

    doc = PymupdfReader().read(levels_ruled().pdf)
    assert doc.parser.name == "pymupdf" and doc.pages[0].tables
