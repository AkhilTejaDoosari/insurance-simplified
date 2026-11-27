"""Synthetic dev fixtures for reader development (WP4). Invented plans only.

Each fixture is a PDF plus its truth: table values keyed by row label and
column header path, free-text passages, and printed page labels. These build
and debug the readers; the reader decision is made on the validation set.
"""

from dataclasses import dataclass, field
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


@dataclass(frozen=True)
class CellTruth:
    page: int
    row_label: str
    header: tuple[str, ...]
    value: str


@dataclass
class Fixture:
    name: str
    pdf: bytes
    cells: list[CellTruth] = field(default_factory=list)
    texts: list[tuple[int, str]] = field(default_factory=list)
    printed: dict[int, str] = field(default_factory=dict)


_STYLES = getSampleStyleSheet()
_GRID = TableStyle(
    [("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP")]
)


def _build(story: list[object], footer: str | None = None) -> bytes:
    buf = BytesIO()

    def on_page(canvas: Canvas, _doc: object) -> None:
        if footer:
            canvas.setFont("Helvetica", 9)
            canvas.drawCentredString(LETTER[0] / 2, 30, footer)

    SimpleDocTemplate(buf, pagesize=LETTER).build(story, onFirstPage=on_page)
    return buf.getvalue()


def _p(text: str) -> Paragraph:
    return Paragraph(text, _STYLES["BodyText"])


def levels_ruled() -> Fixture:
    rows = [
        ["Benefit", "Basic", "Gold", "Platinum"],
        ["Deductible", "$500 per policy year", "$250 per policy year", "$0"],
        ["Out-of-pocket maximum", "$7,500", "$5,000", "$2,500"],
        ["Emergency room", _p("$250 copay, then 30% coinsurance"), "$150 copay", "$100 copay"],
        ["Prescription drugs", "Not covered", "$20 generic", "$10 generic"],
    ]
    story: list[object] = [_p("Demo Student Plan: Schedule of Benefits"), Spacer(1, 12)]
    story.append(Table(rows, style=_GRID, colWidths=[130, 130, 130, 110]))
    cells = [
        CellTruth(1, "Deductible", ("Basic",), "$500 per policy year"),
        CellTruth(1, "Deductible", ("Gold",), "$250 per policy year"),
        CellTruth(1, "Deductible", ("Platinum",), "$0"),
        CellTruth(1, "Out-of-pocket maximum", ("Gold",), "$5,000"),
        CellTruth(1, "Emergency room", ("Basic",), "$250 copay, then 30% coinsurance"),
        CellTruth(1, "Emergency room", ("Platinum",), "$100 copay"),
        CellTruth(1, "Prescription drugs", ("Basic",), "Not covered"),
    ]
    return Fixture("levels_ruled", _build(story, "Page 2"), cells, printed={1: "2"})


def network_two_row_header() -> Fixture:
    rows = [
        ["Benefit", "Gold", "", "Platinum", ""],
        ["", "In-Network", "Out-of-Network", "In-Network", "Out-of-Network"],
        ["Specialist visit", "$40 copay", "40%", "$20 copay", "30%"],
        ["Hospital stay", "20%", "40%", "10%", "30%"],
    ]
    style = TableStyle([*_GRID.getCommands(), ("SPAN", (1, 0), (2, 0)), ("SPAN", (3, 0), (4, 0))])
    story: list[object] = [_p("Demo Network Plan"), Spacer(1, 12), Table(rows, style=style)]
    cells = [
        CellTruth(1, "Specialist visit", ("Gold", "In-Network"), "$40 copay"),
        CellTruth(1, "Specialist visit", ("Gold", "Out-of-Network"), "40%"),
        CellTruth(1, "Specialist visit", ("Platinum", "In-Network"), "$20 copay"),
        CellTruth(1, "Hospital stay", ("Platinum", "Out-of-Network"), "30%"),
    ]
    return Fixture("network_two_row_header", _build(story), cells)


def sbc_questions() -> Fixture:
    rows = [
        ["Important Questions", "Answers", "Why This Matters"],
        [
            _p("What is the overall deductible?"),
            _p("$1,500 individual / $3,000 family"),
            _p("Generally, you must pay all of the costs up to the deductible amount."),
        ],
        [
            _p("What is the out-of-pocket limit for this plan?"),
            _p("$6,000 individual / $12,000 family"),
            _p("The out-of-pocket limit is the most you could pay in a year."),
        ],
    ]
    story: list[object] = [_p("Summary of Benefits and Coverage: Demo Plan"), Spacer(1, 12)]
    story.append(Table(rows, style=_GRID, colWidths=[150, 150, 200]))
    cells = [
        CellTruth(
            1, "What is the overall deductible?", ("Answers",), "$1,500 individual / $3,000 family"
        ),
        CellTruth(
            1,
            "What is the out-of-pocket limit for this plan?",
            ("Answers",),
            "$6,000 individual / $12,000 family",
        ),
    ]
    return Fixture("sbc_questions", _build(story, "Page 1 of 6"), cells, printed={1: "1"})


def unruled_table() -> Fixture:
    """Whitespace-aligned table with no lines, like many brochures."""
    buf = BytesIO()
    c = Canvas(buf, pagesize=LETTER)
    c.setFont("Helvetica-Bold", 11)
    xs = [72, 260, 400]
    for x, h in zip(xs, ["Benefit", "Essential", "Premier"], strict=True):
        c.drawString(x, 700, h)
    c.setFont("Helvetica", 10)
    body = [
        ["Ambulance", "$500 per trip", "$1,000 per trip"],
        ["Physical therapy", "10 visits", "20 visits"],
        ["Dental, accident only", "$250", "$500"],
    ]
    for i, row in enumerate(body):
        for x, cell in zip(xs, row, strict=True):
            c.drawString(x, 680 - 18 * i, cell)
    c.showPage()
    c.save()
    cells = [
        CellTruth(1, "Ambulance", ("Essential",), "$500 per trip"),
        CellTruth(1, "Physical therapy", ("Premier",), "20 visits"),
        CellTruth(1, "Dental, accident only", ("Essential",), "$250"),
    ]
    return Fixture("unruled_table", buf.getvalue(), cells)


def paragraphs_and_footnote() -> Fixture:
    story: list[object] = [
        _p("Pre-existing conditions are excluded for the first 12 months of coverage.*"),
        Spacer(1, 8),
        _p("Maternity care is covered as any other sickness after a 10-month waiting period."),
        Spacer(1, 300),
        _p("* Except for a sudden and unexpected recurrence of a pre-existing condition."),
    ]
    texts = [
        (1, "Pre-existing conditions are excluded for the first 12 months of coverage."),
        (1, "covered as any other sickness after a 10-month waiting period"),
        (1, "Except for a sudden and unexpected recurrence of a pre-existing condition."),
    ]
    return Fixture("paragraphs_and_footnote", _build(story, "7"), texts=texts, printed={1: "7"})


def all_fixtures() -> list[Fixture]:
    return [
        levels_ruled(),
        network_two_row_header(),
        sbc_questions(),
        unruled_table(),
        paragraphs_and_footnote(),
    ]
