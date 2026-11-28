"""A row label that doesn't name the benefit (age bands, person levels, tiers ...) carries
the printed section heading it sits under, proven from the layout; without a provable
heading the fact stays couldn't confirm. The page reproduces the geometry of a public
validation brochure (ada8c8, page 3: an unruled benefit list, heading at x=31 with no value,
age bands indented to x=38, values at x=205) with synthetic words only."""

import io
import json
from typing import Any

import pytest
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.api.extract import extract_pdf
from app.parsing.base import sha256
from app.providers.base import ModelReply, Usage
from app.reconcile.layout import read_layouts
from app.recovery.labelled import _rows, generic_label, section_heading
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from tests.test_key2_extract import FakeGPT

H = 792.0


@pytest.fixture(autouse=True)
def prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in {
        "ENGINE_PRICE_ANTHROPIC_IN": "4",
        "ENGINE_PRICE_ANTHROPIC_OUT": "20",
        "ENGINE_PRICE_OPENAI_IN": "5",
        "ENGINE_PRICE_OPENAI_OUT": "30",
    }.items():
        monkeypatch.setenv(k, v)


Line = tuple[float, float, str, str]  # (y, x of the label, label, value)
HEADED: list[Line] = [  # (y, x of the label, label, value) - as on the brochure page
    (180, 31, "Bedside Visit", "Up to $1,500 not subject to deductible"),
    (198, 31, "Common Carrier Accidental Death", ""),
    (206, 38.3, "Ages 18 through 69", "$50,000"),
    (214, 38.5, "Under age 18", "$10,000"),
    (222, 38.3, "Ages 70 through 74", "$25,000"),
    (230, 38.3, "Ages 75 and older", "$12,500"),
    (250, 31, "Trip Interruption", "Up to $10,000 not subject to deductible"),
]
NO_HEADING: list[Line] = [  # the same age bands right under a benefit that has its own value
    (180, 31, "Trip Interruption", "Up to $10,000 not subject to deductible"),
    (188, 31, "Ages 18 through 69", "$50,000"),
    (196, 31, "Under age 18", "$10,000"),
]


def page(lines: list[tuple[float, float, str, str]]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.setFont("Helvetica", 7)
    for y, x, label, value in lines:
        c.drawString(x, H - y, label)
        if value:
            c.drawString(204.9, H - y, value)
    c.showPage()
    c.save()
    return buf.getvalue()


class ProposingClaude:
    """Proposes every age band as a brochure line (label, value, exact quote)."""

    model = "claude-opus-5-5"

    def __init__(self, lines: list[tuple[float, float, str, str]]) -> None:
        self.values = [
            {"page": 1, "label": label, "value": value, "quote": value}
            for _, _, label, value in lines
            if value and value.startswith("$")
        ]

    def complete_json(self, system: str, user: str, name: str, *_: Any) -> ModelReply:
        if name == "plain_words":
            data: Any = {"lines": [{"id": i["id"], "text": ""} for i in json.loads(user)["items"]]}
        else:
            data = {"facts": [], "clauses": [], "values": self.values}
        return ModelReply("anthropic", self.model, data, Usage(100, 50), 0.01)


ALLOW = CloudPolicy(frozenset({"anthropic", "openai"}), frozenset({"anthropic", "openai"}), True)


def read(lines: list[tuple[float, float, str, str]]) -> dict[str, str]:
    pdf = page(lines)
    auth = CloudAuthorization(
        sha256(pdf), DocumentClass.CUSTOMER, frozenset({"anthropic", "openai"}), "c"
    )
    x = extract_pdf(
        pdf, "p", auth, text_model=ProposingClaude(lines), gpt_model=FakeGPT(), policy=ALLOW
    )
    return {f.benefit_label: str(f.state) for f in x.facts}


def test_generic_labels() -> None:
    for label in (
        "Ages 18 through 69",
        "Under age 18",
        "Ages 75 and older",
        "Per person",
        "Each",
        "Tier 2",
        "In-Network",
        "Student",
        "Death",
        "Loss of 1 Limb",
    ):
        assert generic_label(label), label
    for label in ("Deductible", "Bedside Visit", "Emergency Room", "Annual Deductible"):
        assert not generic_label(label), label


def test_age_bands_carry_their_printed_heading_and_are_verified() -> None:
    states = read(HEADED)
    for band in ("Ages 18 through 69", "Under age 18", "Ages 70 through 74"):
        label = f"Common Carrier Accidental Death — {band}"
        assert states.get(label) == "verified", (label, states)
        assert band not in states  # never shown without its heading


def test_without_a_provable_heading_the_value_is_not_verified() -> None:
    states = read(NO_HEADING)
    assert states["Ages 18 through 69"] == "couldnt_confirm"
    assert states["Under age 18"] == "couldnt_confirm"


def test_heading_proof_is_geometric() -> None:
    lay = read_layouts(page(HEADED))[0]
    rows = _rows(lay)
    band = next(r for r in rows if r[0].text == "Ages")
    assert section_heading(lay, band[:4]) == "Common Carrier Accidental Death"
    # a benefit row's own label is not a heading for the next benefit
    lay2 = read_layouts(page(NO_HEADING))[0]
    band2 = next(r for r in _rows(lay2) if r[0].text == "Ages")
    assert section_heading(lay2, band2[:4]) == ""
