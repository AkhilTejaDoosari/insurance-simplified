"""Scanned pages (P0-03): visual proposals are review-required, never verified."""

import hashlib
import io

import pypdfium2 as pdfium
import pytest
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.recovery.coverage import ItemState
from app.recovery.pipeline import Engines, RecoveryPipeline
from app.recovery.policy import DocumentClass
from app.recovery.visual import ReviewState
from app.schemas.facts import FactState
from tests.test_reconcile import _doc, _pdf
from tests.test_recovery import GOOD_SPECIALIST, NET, OPEN, FakeReader, FakeVisual, _auth


@pytest.fixture(autouse=True)
def _prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for provider in ("NVIDIA", "ANTHROPIC"):
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_IN", "0")
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_OUT", "0")


def _with_scanned_page() -> bytes:
    """Page 1: the ruled table with a text layer. Page 2: drawing only (a scan)."""
    scan = io.BytesIO()
    c = canvas.Canvas(scan, pagesize=letter)
    c.rect(60, 500, 300, 120, stroke=1, fill=0)
    c.showPage()
    c.save()
    out = pdfium.PdfDocument(_pdf())
    out.import_pages(pdfium.PdfDocument(scan.getvalue()))
    buf = io.BytesIO()
    out.save(buf)
    return buf.getvalue()


def _visual(page: int = 2) -> FakeVisual:
    return FakeVisual(
        {
            "facts": [
                {
                    "page": page,
                    "group_label": "",
                    "row_label": "Hospital stay",
                    "column_header": NET,
                    "value": "$250 copay/day",
                }
            ]
        }
    )


def _run(visual: FakeVisual | None, cls: DocumentClass = DocumentClass.PUBLIC_CORPUS) -> object:
    pdf = _with_scanned_page()
    reader = FakeReader(_doc("opendataloader", [GOOD_SPECIALIST]))
    return RecoveryPipeline(Engines(reader, visual_model=visual), policy=OPEN).run(
        pdf, _auth(pdf, cls)
    )


def test_scanned_page_proposal_is_review_required_with_visual_provenance() -> None:
    visual = _visual()
    result = _run(visual)
    (item,) = result.review  # type: ignore[attr-defined]
    assert item.state is ReviewState.REVIEW_REQUIRED
    assert item.reasons == ("no_text_layer", "model_proposal_only")
    assert item.contract_state is FactState.COULDNT_CONFIRM and item.page == 2
    assert not item.presentable_as_verified
    assert item.provenance.image_sha256 == hashlib.sha256(visual.pdfs[0]).hexdigest()
    assert 2 in item.provenance.context_pages
    # never a verified fact, and the page stays unresolved
    assert all(f.fact.page != 2 for f in result.facts)  # type: ignore[attr-defined]
    states = {(i.page, i.state) for i in result.coverage.items}  # type: ignore[attr-defined]
    assert (2, ItemState.UNRESOLVED) in states


def test_proposals_for_pages_not_shown_are_dropped() -> None:
    result = _run(_visual(page=5))
    assert result.review == []  # type: ignore[attr-defined]


def test_scanned_pages_need_the_cloud_authorization() -> None:
    visual = _visual()
    result = _run(visual, DocumentClass.CUSTOMER)
    assert visual.pdfs == [] and result.review == []  # type: ignore[attr-defined]


def test_no_visual_model_no_review_items() -> None:
    assert _run(None).review == []  # type: ignore[attr-defined]
