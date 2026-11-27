"""Source-grounded reconciliation on synthetic ruled tables (no real documents)."""

import io

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.reconcile.engine import reconcile
from app.reconcile.layout import read_layouts
from app.reconcile.verify import Candidate, Status, verify
from app.schemas.common import Market
from app.schemas.document import Document, Page, ParserInfo, Table, TableCell, TableColumn, TableRow

H = 792.0
X = [40.0, 200.0, 330.0, 460.0]  # label | network | out-of-network
Y = [80.0, 100.0, 140.0, 170.0, 200.0]  # top-down: spanning header, column headers, 2 rows


def _pdf(underline: bool = True) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)

    def text(x: float, y: float, s: str) -> None:
        c.drawString(x, H - y, s)

    for y in Y:
        x_end = X[3]
        x_start = X[1] if y == Y[0] else X[0]
        c.line(x_start, H - y, x_end, H - y)
    for x in X:
        top = Y[0] if x in (X[1], X[3]) else Y[1]
        c.line(x, H - top, x, H - Y[-1])
    c.line(X[0], H - Y[1], X[0], H - Y[-1])
    text(X[1] + 40, Y[0] + 14, "What You Will Pay")
    text(X[1] + 5, Y[1] + 14, "Network Provider")
    if underline:  # a glossary underline under the header text is not a cell border
        c.rect(X[1] + 5, H - (Y[1] + 17), 88, 0.8, stroke=0, fill=1)
    text(X[1] + 5, Y[1] + 28, "(You will pay the least)")
    text(X[2] + 5, Y[1] + 14, "Out-of-Network Provider")
    text(X[0] + 5, Y[2] + 14, "Specialist visit")
    text(X[1] + 5, Y[2] + 14, "$45 copay/visit")
    text(X[2] + 5, Y[2] + 14, "50% coinsurance")
    text(X[0] + 5, Y[3] + 14, "Urgent care")
    text(X[1] + 5, Y[3] + 14, "$90 copay/visit")
    text(X[2] + 5, Y[3] + 14, "Not covered")
    c.showPage()
    c.save()
    return buf.getvalue()


def _cand(label: str, header: tuple[str, ...], value: str) -> Candidate:
    return Candidate("test", 1, (), label, header, value)


NETWORK = ("What You Will Pay", "Network Provider (You will pay the least)")


def test_correct_cell_is_verified_with_the_full_printed_header() -> None:
    layout = read_layouts(_pdf())[0]
    v = verify(_cand("Specialist visit", NETWORK, "$45 copay/visit"), layout)
    assert v.status is Status.VERIFIED, v.reasons


def test_underline_is_not_taken_for_a_cell_border() -> None:
    layout = read_layouts(_pdf(underline=True))[0]
    assert not any(abs(r.at - (Y[1] + 17)) < 2 for r in layout.h_rules)


def test_value_claimed_under_the_wrong_column_is_rejected() -> None:
    layout = read_layouts(_pdf())[0]
    v = verify(_cand("Specialist visit", NETWORK, "50% coinsurance"), layout)
    assert v.status is Status.REJECTED


def test_value_claimed_in_the_wrong_row_is_rejected() -> None:
    layout = read_layouts(_pdf())[0]
    v = verify(_cand("Urgent care", NETWORK, "$45 copay/visit"), layout)
    assert v.status is Status.REJECTED


def test_spanning_header_alone_does_not_verify_a_column() -> None:
    layout = read_layouts(_pdf())[0]
    v = verify(_cand("Specialist visit", ("What You Will Pay",), "$45 copay/visit"), layout)
    assert v.status is not Status.VERIFIED
    assert "header_spans_several_columns" in v.reasons


def test_value_not_printed_is_rejected_and_partial_cell_is_not_verified() -> None:
    layout = read_layouts(_pdf())[0]
    assert verify(_cand("Specialist visit", NETWORK, "$46 copay/visit"), layout).status is (
        Status.REJECTED
    )
    partial = verify(_cand("Specialist visit", NETWORK, "$45"), layout)
    assert partial.status is not Status.VERIFIED


def _doc(reader: str, cells: list[tuple[str, str, str]]) -> Document:
    columns = {
        h: TableColumn(id=f"t-c{i}", header_path=[NETWORK[0], h])
        for i, h in enumerate(sorted({c[1] for c in cells}), start=1)
    }
    rows = {
        lab: TableRow(id=f"t-r{i}", label=lab)
        for i, lab in enumerate(sorted({c[0] for c in cells}))
    }
    table = Table(
        id="t",
        page=1,
        columns=list(columns.values()),
        rows=list(rows.values()),
        cells=[
            TableCell(row_id=rows[lab].id, column_id=columns[h].id, text=v) for lab, h, v in cells
        ],
    )
    page = Page(number=1, width=612, height=792, readable=True, text="", tables=[table])
    return Document(
        sha256="0" * 64,
        market=Market.US,
        currency="USD",
        language="en",
        parser=ParserInfo(name=reader, version="test"),
        pages=[page],
    )


def test_agreement_is_not_evidence_and_disagreement_is_kept() -> None:
    pdf = _pdf()
    net = NETWORK[1]
    # both readers agree on a wrong cell; one reader alone has the right one
    wrong = ("Urgent care", net, "$45 copay/visit")
    right = ("Specialist visit", net, "$45 copay/visit")
    result = reconcile(pdf, {"a": _doc("a", [wrong]), "b": _doc("b", [wrong, right])})
    facts = {(f.label, f.value) for f in result.facts}
    assert ("Specialist visit", "$45 copay/visit") in facts
    assert ("Urgent care", "$45 copay/visit") not in facts
    assert result.count(Status.REJECTED) == 2
    fact = next(f for f in result.facts if f.label == "Specialist visit")
    assert fact.header.startswith("Network Provider")
    assert fact.proposed_by == {"b"}
