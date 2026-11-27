"""Readers run isolated: crashes, hangs and oversize files become typed failures."""

from app.parsing.sandbox import Limits, ParseFailure, parse_isolated
from evaluation.synthetic import levels_ruled


def test_good_pdf_parses_in_a_separate_process() -> None:
    result = parse_isolated(levels_ruled().pdf)
    assert result.failure is None and result.document is not None
    assert result.document.pages[0].tables


def test_reader_error_is_typed_not_raised() -> None:
    result = parse_isolated(b"%PDF-1.7 this is not really a pdf")
    assert result.document is None and result.failure is ParseFailure.READER_ERROR


def test_page_limit() -> None:
    result = parse_isolated(levels_ruled().pdf, limits=Limits(max_pages=0))
    assert result.failure is ParseFailure.TOO_MANY_PAGES


def test_native_crash_is_contained() -> None:
    result = parse_isolated(b"%PDF-", reader_name="tests.sandbox_readers:Crash")
    assert result.document is None and result.failure is ParseFailure.CRASHED


def test_hang_is_killed_at_the_time_limit() -> None:
    result = parse_isolated(
        b"%PDF-", reader_name="tests.sandbox_readers:Hang", limits=Limits(seconds=1)
    )
    assert result.document is None and result.failure is ParseFailure.TIMED_OUT


def test_early_death_is_noticed_without_waiting_for_the_time_limit() -> None:
    import time  # noqa: PLC0415

    started = time.monotonic()
    result = parse_isolated(
        b"%PDF-", reader_name="tests.sandbox_readers:DieAtImport", limits=Limits(seconds=60)
    )
    assert result.failure is ParseFailure.CRASHED
    assert time.monotonic() - started < 20
