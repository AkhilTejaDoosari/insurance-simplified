"""Labelled brochure lines (model proposes label, value, quote; code verifies) on
synthetic pages - no real documents."""

import io

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.reconcile.layout import read_layouts
from app.reconcile.verify import Status
from app.recovery.clauses import ClauseCandidate, clause_facts, verify_clause
from app.recovery.labelled import verify_same_line

H = 792.0
LABEL_X, VALUE_X = 40.0, 250.0
LINES = [  # (y, label, value) - an unruled two-column benefit list
    (100, "Deductible", "$250 per Policy Year"),
    (120, "Coinsurance", "80% after Deductible"),
    (140, "Emergency Room", "$250 copay per visit, then"),
    (152, "", "100% of Usual & Customary"),  # wraps: nothing in the label column
    (172, "Prescription Drugs", "$15 generic"),
    (192, "Pre-existing Conditions: Excluded for 12 months", ""),
    (212, "Find an in-network", "Options PPO"),
    (224, "provider", ""),  # the label wraps; the value sits beside its first line
]


def _brochure() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.setFont("Helvetica", 9)
    for y, label, value in LINES:
        if label:
            c.drawString(LABEL_X, H - y, label)
        if value:
            c.drawString(VALUE_X, H - y, value)
    c.showPage()
    # page 2: a ruled two-cell row (a table row, not a brochure line)
    for y in (100, 130, 160):
        c.line(40, H - y, 500, H - y)
    for x in (40, 240, 500):
        c.line(x, H - 100, x, H - 160)
    c.drawString(44, H - 115, "Deductible")
    c.drawString(244, H - 115, "$500 per year")
    c.drawString(44, H - 145, "Coinsurance")
    c.drawString(244, H - 145, "20%")
    c.showPage()
    c.save()
    return buf.getvalue()


LAYOUTS = read_layouts(_brochure())


def check(label: str, value: str, quote: str, page: int = 1) -> tuple[Status, tuple[str, ...]]:
    c = ClauseCandidate("text:test", page, label, quote, "labelled", value)
    lay = LAYOUTS[page - 1]
    nxt = LAYOUTS[page] if page < len(LAYOUTS) else None
    v = verify_clause(c, lay, nxt)
    return v.status, v.reasons


def test_value_printed_next_to_its_label_is_verified_with_the_exact_quote() -> None:
    c = ClauseCandidate("text:test", 1, "Deductible", "$250 per Policy Year", "labelled", "$250")
    facts, verdicts = clause_facts([c], LAYOUTS)
    assert verdicts[0].status is Status.VERIFIED
    (f,) = facts
    assert (f.page, f.evidence.anchor, f.evidence.text) == (1, "Deductible", "$250 per Policy Year")
    assert "column_unproven" in f.open_conditions  # never presentable without key 2
    assert not f.presentable_as_verified


def test_wrapped_quote_is_verified_only_whole() -> None:
    full = "$250 copay per visit, then 100% of Usual & Customary"
    assert check("Emergency Room", "$250 copay per visit", full)[0] is Status.VERIFIED
    status, reasons = check("Emergency Room", "$250", "$250 copay per visit, then")
    assert status is Status.UNRESOLVED and "quote_continues_below" in reasons


def test_same_segment_label_and_quote() -> None:
    status, _ = check("Pre-existing Conditions", "Excluded for 12 months", "Excluded for 12 months")
    assert status is Status.VERIFIED


def test_truncated_quote_is_refused() -> None:
    status, reasons = check("Deductible", "$250", "$250")
    assert status is Status.UNRESOLVED and "quote_is_part_of_a_longer_text" in reasons


def test_value_from_another_line_is_refused() -> None:
    assert check("Deductible", "80%", "80% after Deductible")[0] is Status.UNRESOLVED
    # running on into the next item's value is not a wrap: its label column is printed
    status, _ = check("Prescription Drugs", "$15", "$15 generic Excluded for 12 months")
    assert status is Status.UNRESOLVED


def test_value_must_be_whole_words_of_the_quote() -> None:
    status, reasons = check("Deductible", "$25", "$250 per Policy Year")
    assert status is Status.UNRESOLVED and "value_not_in_quote" in reasons
    status, _ = check("Deductible", "$300", "$250 per Policy Year")
    assert status is Status.UNRESOLVED


def test_quote_not_on_that_page_is_refused() -> None:
    assert check("Deductible", "$250", "$250 per Policy Year", page=2)[0] is Status.UNRESOLVED
    assert check("Deductible", "$999", "$999 per Policy Year")[0] is Status.UNRESOLVED


def test_ruled_table_row_is_left_to_the_existing_rules() -> None:
    """On a ruled page the same-line path refuses a two-cell row; the outcome is exactly
    the pre-existing prose rule's (a question/answer cell pair), never a new acceptance."""
    lay = LAYOUTS[1]
    status, reasons, _ = verify_same_line(lay, "Deductible", "$500", "$500 per year")
    assert status is Status.UNRESOLVED and "ruled_table_row_use_table_verifier" in reasons
    labelled = ClauseCandidate("t", 2, "Deductible", "$500 per year", "labelled", "$500")
    plain = ClauseCandidate("t", 2, "Deductible", "$500 per year")
    assert verify_clause(labelled, lay).evidence == verify_clause(plain, lay).evidence


def test_label_wrapping_onto_the_next_line() -> None:
    assert check("Find an in-network provider", "Options PPO", "Options PPO")[0] is Status.VERIFIED
    # only part of the label is not the label
    status, _ = check("Find an in-network provider today", "Options PPO", "Options PPO")
    assert status is Status.UNRESOLVED
