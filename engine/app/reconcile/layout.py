"""The PDF's own geometry for one page: words with boxes and the ruling lines drawn on it.

This is the source the reconciler checks candidates against. It is read straight from
the PDF's text layer and vector graphics (pdfplumber is used only as a PDF object
reader here, not as a table parser), so it is independent of every candidate reader's
table reconstruction.
"""

import io
import re
from dataclasses import dataclass, field
from typing import Any

import pdfplumber

MIN_RULE = 20.0  # shorter strokes are decoration, not cell borders
UNDERLINE_GAP = 3.5  # a stroke this close under a word and no wider than it is an underline


def norm(text: str) -> str:
    """Comparison form: lower case, letters, digits, $ and % only. Robust to the
    whitespace, hyphenation and line-break differences between readers."""
    return re.sub(r"[^0-9a-z$%]", "", text.lower())


@dataclass(frozen=True)
class Box:
    x0: float
    top: float
    x1: float
    bottom: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    def union(self, other: "Box") -> "Box":
        return Box(
            min(self.x0, other.x0),
            min(self.top, other.top),
            max(self.x1, other.x1),
            max(self.bottom, other.bottom),
        )


@dataclass(frozen=True)
class Word:
    text: str
    key: str
    box: Box


@dataclass(frozen=True)
class Rule:
    """A horizontal (y, a..b along x) or vertical (x, a..b along y) line."""

    at: float
    a: float
    b: float


@dataclass
class PageLayout:
    number: int
    width: float
    height: float
    words: list[Word]
    h_rules: list[Rule] = field(default_factory=list)
    v_rules: list[Rule] = field(default_factory=list)

    @property
    def ruled(self) -> bool:
        return len(self.h_rules) >= 3 and len(self.v_rules) >= 2

    def h_rule_between(self, x: float, y_a: float, y_b: float, tol: float = 1.5) -> bool:
        lo, hi = sorted((y_a, y_b))
        return any(r.a - 1 <= x <= r.b + 1 and lo + tol < r.at < hi - tol for r in self.h_rules)

    def v_strip(self, x: float, y: float) -> tuple[float, float] | None:
        """The column strip around x at height y, bounded by vertical rules."""
        left = [r.at for r in self.v_rules if r.at <= x + 0.5 and r.a - 1 <= y <= r.b + 1]
        right = [r.at for r in self.v_rules if r.at >= x - 0.5 and r.a - 1 <= y <= r.b + 1]
        if not left or not right:
            return None
        return max(left), min(right)

    def v_rule_through(self, box: Box, below: float, tol: float = 2.0, pad: float = 10.0) -> bool:
        """A vertical rule starts within ``pad`` below ``box`` (cell padding) inside its
        x-range and continues downwards: the box is a spanning header over several columns."""
        return any(
            box.x0 + tol < r.at < box.x1 - tol and r.a <= below + pad and r.b >= below + pad
            for r in self.v_rules
        )


THIN = 2.5  # a filled rectangle this thin is a drawn border, not a background


def _is_underline(y: float, a: float, b: float, words: list[Word]) -> bool:
    above = [
        w
        for w in words
        if -2.5 <= y - w.box.bottom <= UNDERLINE_GAP and w.box.x1 > a - 1 and w.box.x0 < b + 1
    ]
    return bool(above) and (
        min(w.box.x0 for w in above) - 3 <= a and b <= max(w.box.x1 for w in above) + 3
    )


def _rules(page: Any, words: list[Word]) -> tuple[list[Rule], list[Rule]]:
    """Visible borders only: stroked lines, stroked rectangle sides and thin filled bars.
    The edges of large filled rectangles are backgrounds (many PDFs paint one behind
    every line of text) and underlines are decoration; neither is a cell border."""
    h: list[Rule] = []
    v: list[Rule] = []

    def add_h(y: float, a: float, b: float) -> None:
        if b - a >= MIN_RULE and not _is_underline(y, a, b, words):
            h.append(Rule(y, a, b))

    def add_v(x: float, a: float, b: float) -> None:
        if b - a >= MIN_RULE / 2:
            v.append(Rule(x, a, b))

    for ln in page.lines:
        x0, x1, top, bottom = (float(ln[k]) for k in ("x0", "x1", "top", "bottom"))
        if abs(bottom - top) < 1:
            add_h(top, x0, x1)
        elif abs(x1 - x0) < 1:
            add_v(x0, top, bottom)
    for r in page.rects:
        x0, x1, top, bottom = (float(r[k]) for k in ("x0", "x1", "top", "bottom"))
        w, ht = x1 - x0, bottom - top
        if ht <= THIN and w > ht:
            add_h((top + bottom) / 2, x0, x1)
        elif w <= THIN and ht > w:
            add_v((x0 + x1) / 2, top, bottom)
        elif r.get("stroke") and float(r.get("linewidth") or 0) > 0:
            add_h(top, x0, x1)
            add_h(bottom, x0, x1)
            add_v(x0, top, bottom)
            add_v(x1, top, bottom)
    return _dedupe(h), _dedupe(v)


def _dedupe(rules: list[Rule]) -> list[Rule]:
    out: list[Rule] = []
    for r in sorted(rules, key=lambda r: (round(r.at), r.a)):
        if out and abs(out[-1].at - r.at) < 0.8 and r.a <= out[-1].b + 1:
            last = out[-1]
            out[-1] = Rule(last.at, min(last.a, r.a), max(last.b, r.b))
        else:
            out.append(r)
    return out


def read_layouts(pdf: bytes) -> list[PageLayout]:
    layouts = []
    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        for number, page in enumerate(doc.pages, start=1):
            words = [
                Word(
                    w["text"],
                    norm(w["text"]),
                    Box(float(w["x0"]), float(w["top"]), float(w["x1"]), float(w["bottom"])),
                )
                for w in page.extract_words(use_text_flow=False)
            ]
            words = [w for w in words if w.key]
            h, v = _rules(page, words)
            layouts.append(PageLayout(number, float(page.width), float(page.height), words, h, v))
    return layouts
