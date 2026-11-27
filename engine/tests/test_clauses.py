"""Prose-clause verification (P0-01) on synthetic pages (no real documents)."""

import io

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.reconcile.layout import read_layouts
from app.reconcile.verify import Status
from app.recovery.clauses import (
    ClauseCandidate,
    ClauseKind,
    candidates_from_layout,
    clause_facts,
    clause_kind,
    verify_clause,
)

H = 792.0
XS = [40.0, 200.0, 360.0, 560.0]  # question | answer | why this matters
Q1 = "What is the overall deductible?"
A1 = "$500 individual $1,000 family"
Q2 = "Do you need a referral to see a specialist?"
A2 = "No. You can see the specialist you choose."
W2 = "You can see the specialist you choose without a referral."


def _qa_pdf(*, third: str = "Why This Matters:", second_page: bool = False) -> bytes:
    """An SBC-style Q&A table: a dark header band WITHOUT a rule under it (the header row
    and the first answer share one ruled cell), then a ruled second row."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ys = [100.0, 170.0, 230.0]
    c.setFillColorRGB(0.15, 0.4, 0.58)
    c.rect(XS[0], H - 122, XS[-1] - XS[0], 22, stroke=0, fill=1)  # header band 100-122
    c.setFillColorRGB(0, 0, 0)
    for y in ys:
        c.line(XS[0], H - y, XS[-1], H - y)
    for x in XS:
        c.line(x, H - ys[0], x, H - ys[-1])
    for x, y, s in [
        (XS[0] + 4, 114, "Important Questions"),
        (XS[1] + 4, 114, "Answers"),
        (XS[2] + 4, 114, third),
        (XS[0] + 4, 140, Q1),
        (XS[1] + 4, 140, A1),
        (XS[2] + 4, 140, "You pay costs up to this amount."),
        (XS[0] + 4, 190, Q2),
        (XS[1] + 4, 190, A2),
        (XS[2] + 4, 190, W2),
    ]:
        c.setFont("Helvetica", 7)
        c.drawString(x, H - y, s)
    c.showPage()
    if second_page:
        c.drawString(40, H - 100, "Page two")
        c.showPage()
    c.save()
    return buf.getvalue()


def _prose_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    lines = [
        (60, 100, "Waiting Period"),
        (60, 114, "Benefits for pre-existing conditions begin after a waiting"),
        (60, 126, "period of 12 months from the effective date."),
        (60, 170, "Eligibility: Full-time students enrolled for 9 or more credits."),
    ]
    for x, y, s in lines:
        c.drawString(x, H - y, s)
    c.showPage()
    c.save()
    return buf.getvalue()


def _v(anchor: str, text: str, pdf: bytes | None = None, structure: str = "any") -> object:
    layout = read_layouts(pdf or _qa_pdf())[0]
    return verify_clause(ClauseCandidate("test", 1, anchor, text, structure), layout)


def test_answer_in_a_merged_header_cell_verifies_with_its_printed_column() -> None:
    v = _v(Q1, A1)
    assert v.status is Status.VERIFIED, v.reasons  # type: ignore[attr-defined]
    e = v.evidence  # type: ignore[attr-defined]
    assert e.column == "Answers" and e.text == A1
    assert e.governing == ("You pay costs up to this amount.",)


def test_second_row_answer_verifies_and_carries_its_governing_text() -> None:
    v = _v(Q2, A2)
    assert v.status is Status.VERIFIED, v.reasons  # type: ignore[attr-defined]
    assert v.evidence.governing == (W2,)  # type: ignore[attr-defined]


def test_part_of_an_answer_is_not_the_clause() -> None:
    v = _v(Q2, "No.")
    assert v.status is not Status.VERIFIED  # type: ignore[attr-defined]
    assert "clause_is_not_the_whole_cell" in v.reasons  # type: ignore[attr-defined]


def test_answer_of_another_question_is_refused() -> None:
    v = _v(Q1, A2)
    assert v.status is not Status.VERIFIED  # type: ignore[attr-defined]


def test_governing_text_is_never_the_answer() -> None:
    # the "Why This Matters" cell is right of the answer cell, not of the question
    v = _v(A2, W2)
    assert v.status is not Status.VERIFIED  # type: ignore[attr-defined]
    assert "anchor_is_not_the_row_label" in v.reasons  # type: ignore[attr-defined]


def test_a_row_with_two_value_cells_is_a_table_fact_not_a_clause() -> None:
    v = _v(Q2, A2, _qa_pdf(third="Out-of-Network Provider"))
    assert v.status is not Status.VERIFIED  # type: ignore[attr-defined]
    assert "row_has_several_value_cells" in v.reasons  # type: ignore[attr-defined]


def test_layout_proposes_question_rows_and_facts_carry_open_conditions() -> None:
    pdf = _qa_pdf()
    layouts = read_layouts(pdf)
    cands = candidates_from_layout(layouts[0])
    assert {(c.anchor, c.text) for c in cands} == {(Q1, A1), (Q2, A2)}
    facts, _ = clause_facts(cands, layouts)
    assert {f.evidence.text for f in facts} == {A1, A2}
    assert all(not f.presentable_as_verified for f in facts)  # key 2 not confirmed


def test_unruled_heading_and_its_paragraph() -> None:
    pdf = _prose_pdf()
    text = (
        "Benefits for pre-existing conditions begin after a waiting "
        "period of 12 months from the effective date."
    )
    v = _v("Waiting Period", text, pdf)
    assert v.status is Status.VERIFIED, v.reasons  # type: ignore[attr-defined]
    partial = _v("Waiting Period", "Benefits for pre-existing conditions begin", pdf)
    assert partial.status is not Status.VERIFIED  # type: ignore[attr-defined]


def test_unruled_label_colon_value_on_one_line() -> None:
    v = _v("Eligibility:", "Full-time students enrolled for 9 or more credits.", _prose_pdf())
    assert v.status is Status.VERIFIED, v.reasons  # type: ignore[attr-defined]


def test_reader_table_cells_never_verify_as_prose_on_unruled_pages() -> None:
    v = _v(
        "Eligibility:", "Full-time students enrolled for 9 or more credits.", _prose_pdf(), "table"
    )
    assert v.status is not Status.VERIFIED  # type: ignore[attr-defined]
    assert v.reasons == ("table_cell_on_unruled_page",)  # type: ignore[attr-defined]


def test_clause_kind_comes_from_the_printed_anchor() -> None:
    assert clause_kind("Waiting Period") is ClauseKind.WAITING_PERIOD
    assert clause_kind("Services Your Plan Generally Does NOT Cover") is ClauseKind.EXCLUSION
    assert clause_kind("Who is eligible?") is ClauseKind.ELIGIBILITY
    assert clause_kind(Q2) is ClauseKind.ANSWER
