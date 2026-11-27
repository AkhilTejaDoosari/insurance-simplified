"""Readers emit a valid document model and read the synthetic fixtures (WP4)."""

import importlib.util

import pytest

from app.parsing.base import printed_label
from app.parsing.grid import find_span, table_from_grid
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


def test_tall_header_cell_does_not_bleed_sideways() -> None:
    grid: list[list[str | None]] = [
        ["Services", "What You Will Pay", None, "Limitations"],
        [None, "In-Network", "Out-of-Network", None],
        ["Specialist visit", "$40 copay", "40%", "Referral needed"],
    ]
    table = table_from_grid(grid, 1, "t", "")
    assert table is not None
    assert [c.header_path for c in table.columns] == [
        ["What You Will Pay", "In-Network"],
        ["What You Will Pay", "Out-of-Network"],
        ["Limitations"],
    ]


def test_header_ends_at_no_charge_rows_and_wrapped_lines_merge() -> None:
    grid: list[list[str | None]] = [
        ["Event", "Services", "Network Provider"],
        [None, None, "(You will pay the least)"],
        ["If you visit a doctor", "Primary care visit to treat", "No charge"],
        ["", "an injury or illness", ""],
        ["", "Specialist visit", "No charge"],
    ]
    table = table_from_grid(grid, 1, "t", "")
    assert table is not None
    assert table.columns[0].header_path == ["Network Provider", "(You will pay the least)"]
    assert [r.label for r in table.rows] == [
        "Primary care visit to treat an injury or illness",
        "Specialist visit",
    ]
    assert table.rows[1].group_labels == ["If you visit a doctor"]


def test_split_columns_are_merged_but_real_columns_never() -> None:
    grid: list[list[str | None]] = [
        ["Services", "In-Network", "", "Out-of-Network", ""],
        ["Primary care visit", "$15 copay", "", "40%", ""],
        ["Specialist visit", "", "$30 copay", "", "40%"],
    ]
    table = table_from_grid(grid, 1, "t", "")
    assert table is not None
    assert [c.header_path for c in table.columns] == [["In-Network"], ["Out-of-Network"]]
    specialist = table.rows[1]
    values = {c.column_id: c.text for c in table.cells if c.row_id == specialist.id}
    assert list(values.values()) == ["$30 copay", "40%"]
