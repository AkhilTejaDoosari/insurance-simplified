"""Governing context beyond the fact's row (P1-01), on synthetic pages."""

import io

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.reconcile.layout import read_layouts
from app.recovery.governing import Unit, bm25, exclusion_items, resolve, rrf, units

H = 792.0


def _doc() -> bytes:
    """Page 1: two-column exclusion box (ruled). Page 2: a section and definitions."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    for y in (100, 260, 300):  # the box 100..260 as drawn rules, like SBC boxes
        c.line(40, H - y, 560, H - y)
    for x in (40, 560):
        c.line(x, H - 100, x, H - 260)
    for x, y, s in [
        (50, 115, "Services Your Plan Generally Does NOT Cover"),
        (380, 115, "Other Covered Services"),
        (50, 140, "Acupuncture"),
        (380, 140, "Chiropractic care"),
        (50, 155, "Cosmetic surgery"),
        (380, 155, "Hearing aids"),
        (50, 320, "Your Rights to Continue Coverage: agencies can help with specialist issues"),
    ]:
        c.drawString(x, H - y, s)
    c.showPage()
    for x, y, s in [
        (50, 100, "Durable Medical Equipment"),
        (50, 120, "Rental or purchase requires prior authorization."),
        (50, 200, "Definitions"),
        (50, 220, "Coinsurance: your share of the cost of a covered service."),
    ]:
        c.drawString(x, H - y, s)
    c.showPage()
    c.save()
    return buf.getvalue()


def test_columns_are_separate_blocks_and_headings_name_sections() -> None:
    us = units(read_layouts(_doc()))
    texts = [u.text for u in us]
    assert "Acupuncture Cosmetic surgery" in texts  # left column only
    assert "Chiropractic care Hearing aids" in texts  # right column only
    body = next(u for u in us if u.text.startswith("Rental"))
    assert body.section == "Durable Medical Equipment"


def test_bm25_and_rrf_rank_candidates_only() -> None:
    us = [Unit(1, t, (0, 0, 1, 1), "", False) for t in ("dental care", "eye exam", "dental x")]
    assert bm25("dental", us)[:2] == [0, 2] or bm25("dental", us)[:2] == [2, 0]
    assert rrf([0, 1], [1, 0])[0] in (0, 1) and set(rrf([0], [1])) == {0, 1}


def test_cross_reference_inside_the_document_is_located_with_its_text() -> None:
    layouts = read_layouts(_doc())
    g = resolve(
        texts=["20% coinsurance *See Durable Medical Equipment section."],
        label="Durable medical equipment",
        all_units=units(layouts),
        n_pages=len(layouts),
    )
    assert "cross_reference_unresolved" in g.conditions_remove
    assert [t for _p, t in g.context] == [
        "Durable Medical Equipment",
        "Rental or purchase requires prior authorization.",
    ]


def test_outside_material_stays_open_as_external_reference() -> None:
    layouts = read_layouts(_doc())
    g = resolve(
        texts=["Yes. See www.example.com or call 1-800-555-0100."],
        label="Will you pay less if you use a network provider?",
        all_units=units(layouts),
        n_pages=len(layouts),
    )
    assert g.conditions_add == ["external_reference"]


def test_an_unknown_section_stays_unresolved() -> None:
    layouts = read_layouts(_doc())
    g = resolve(
        texts=["See Hospice section."],
        label="Hospice",
        all_units=units(layouts),
        n_pages=len(layouts),
    )
    assert g.conditions_remove == [] and g.context == []


def test_exclusion_items_stay_inside_their_box_and_are_candidates_only() -> None:
    layouts = read_layouts(_doc())
    us = units(layouts)
    items = exclusion_items(us, layouts)
    texts = {u.text for u in items}
    assert "Acupuncture Cosmetic surgery" in texts
    assert not any("Rights to Continue" in t for t in texts)  # outside the ruled box
    g = resolve(
        texts=["$40 copay/visit"],
        label="Acupuncture",
        all_units=us,
        n_pages=len(layouts),
        exclusions=items,
    )
    assert g.exclusions and "possible_exclusion" not in g.conditions_add


def test_definitions_for_terms_the_fact_uses() -> None:
    layouts = read_layouts(_doc())
    g = resolve(
        texts=["20% coinsurance"],
        label="Specialist visit",
        all_units=units(layouts),
        n_pages=len(layouts),
    )
    assert [t for _p, t in g.definitions] == [
        "Coinsurance: your share of the cost of a covered service."
    ]
