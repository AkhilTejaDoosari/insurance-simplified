"""Coverage and completeness signals that do not depend on any parser (P0-02).

The gap detector routes recovery from rows a reader already found; a row that every
reader missed never appears there. This module looks at the PDF's own text layer
instead: every printed amount ("$45", "20%", "No charge", "Not covered", "copay") on a
page with a text layer must end up in exactly one state:

* ``verified``      - inside the cell of a verified fact;
* ``rejected``      - a reader or model proposed that cell, the verifier refused it;
* ``conflicting``   - inside a cell where two verified values disagree;
* ``not_extracted`` - nobody proposed it: information every engine missed;
* ``unresolved``    - the page cannot be checked (no text layer: scanned image).

``not_stated`` is a claim about absence. It is only made for an expected item (from a
category dictionary, never from benchmark answer keys) when the item's words are printed
nowhere in the document **and** the document has no not_extracted or unresolved region
that could be hiding it. Otherwise the item stays ``unresolved``.

Mapping onto the user contract (``app.schemas.facts.FactState``): verified -> verified;
conflicting -> conflicting; not_stated -> not_mentioned; not_extracted, rejected and
unresolved -> couldnt_confirm. Nothing here produces "not covered": that is a printed
statement and must be a verified fact.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.parsing.grid import has_value
from app.reconcile.engine import Fact
from app.reconcile.layout import Box, PageLayout, Word, norm
from app.reconcile.verify import Status, Verdict, locate
from app.schemas.facts import FactState


class ItemState(StrEnum):
    VERIFIED = "verified"
    NOT_EXTRACTED = "not_extracted"
    NOT_STATED = "not_stated"
    UNRESOLVED = "unresolved"
    CONFLICTING = "conflicting"
    REJECTED = "rejected"


TO_CONTRACT = {
    ItemState.VERIFIED: FactState.VERIFIED,
    ItemState.CONFLICTING: FactState.CONFLICTING,
    ItemState.NOT_STATED: FactState.NOT_MENTIONED,
    ItemState.NOT_EXTRACTED: FactState.COULDNT_CONFIRM,
    ItemState.REJECTED: FactState.COULDNT_CONFIRM,
    ItemState.UNRESOLVED: FactState.COULDNT_CONFIRM,
}


@dataclass(frozen=True)
class CoverageItem:
    page: int
    state: ItemState
    line: str  # the printed line holding the amount(s); "" for page-level items
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class CoverageReport:
    items: list[CoverageItem]

    def count(self, state: ItemState) -> int:
        return sum(i.state is state for i in self.items)

    @property
    def complete(self) -> bool:
        """Every printed amount is verified (or knowingly conflicting): nothing missed,
        nothing refused, nothing unreadable."""
        return all(i.state in (ItemState.VERIFIED, ItemState.CONFLICTING) for i in self.items)


def _inside(word: Word, box: Box | tuple[float, float, float, float], pad: float = 1.0) -> bool:
    x0, top, x1, bottom = (box.x0, box.top, box.x1, box.bottom) if isinstance(box, Box) else box
    return (
        x0 - pad <= word.box.cx <= x1 + pad
        and top - pad <= (word.box.top + word.box.bottom) / 2 <= bottom + pad
    )


def _line_of(layout: PageLayout, word: Word) -> str:
    same = [w for w in layout.words if abs(w.box.top - word.box.top) <= 2.5]
    return " ".join(w.text for w in sorted(same, key=lambda w: w.box.x0))


def _amount_words(layout: PageLayout) -> list[Word]:
    """Words that print an amount, alone ("$45", "20%") or as a two-word phrase with the
    next word on the same line ("Not covered", "No charge"; the first word stands for it)."""
    rows: list[list[Word]] = []
    for w in sorted(layout.words, key=lambda w: (w.box.top, w.box.x0)):
        if rows and abs(rows[-1][0].box.top - w.box.top) <= 2.5:
            rows[-1].append(w)
        else:
            rows.append([w])
    out: list[Word] = []
    for row in rows:
        row.sort(key=lambda w: w.box.x0)
        for i, w in enumerate(row):
            pair = f"{w.text} {row[i + 1].text}" if i + 1 < len(row) else ""
            if has_value(w.text) or (pair and has_value(pair) and not has_value(row[i + 1].text)):
                out.append(w)
    return out


def coverage(
    layouts: Sequence[PageLayout],
    facts: Iterable[Fact],
    verdicts: Iterable[Verdict] = (),
    conflicts: Iterable[tuple[Fact, Fact]] = (),
) -> CoverageReport:
    facts = list(facts)
    verdicts = list(verdicts)
    conflict_boxes = [(f.page, f.value_box) for pair in conflicts for f in pair]
    items: list[CoverageItem] = []
    for layout in layouts:
        if not layout.words:
            items.append(CoverageItem(layout.number, ItemState.UNRESOLVED, "", ("no_text_layer",)))
            continue
        page_facts = [f.value_box for f in facts if f.page == layout.number]
        refused: list[tuple[Box, tuple[str, ...]]] = []
        for v in verdicts:
            if v.candidate.page != layout.number or v.status is Status.VERIFIED:
                continue
            # a proposal refused before its value was located (e.g. a bad header) still
            # names a printed cell: find it, so the amount is "rejected", not "missed"
            spots = [v.value] if v.value is not None else locate(layout, v.candidate.value)
            refused += [(o.cell_box, v.reasons) for o in spots]
        seen_lines: dict[str, CoverageItem] = {}
        for word in _amount_words(layout):
            line = _line_of(layout, word)
            why: tuple[str, ...] = ()
            if any(p == layout.number and _inside(word, b) for p, b in conflict_boxes):
                state = ItemState.CONFLICTING
            elif any(_inside(word, b) for b in page_facts):
                state = ItemState.VERIFIED
            elif hits := [r for b, r in refused if _inside(word, b)]:
                state, why = ItemState.REJECTED, tuple(sorted({x for r in hits for x in r}))
            else:
                state = ItemState.NOT_EXTRACTED
            key = f"{state}|{line}"
            if key not in seen_lines:  # one item per printed line and state
                seen_lines[key] = CoverageItem(layout.number, state, line, why)
        items.extend(seen_lines.values())
    return CoverageReport(items)


def not_stated(
    item_terms: Sequence[str], layouts: Sequence[PageLayout], report: CoverageReport
) -> ItemState:
    """``not_stated`` only when the absence is proven; otherwise ``unresolved``.

    ``item_terms`` are the ways an expected item is printed (from a category dictionary,
    never from benchmark keys). Present anywhere -> unresolved (it is printed but not a
    verified fact). Absent, but a region could hide it -> unresolved."""
    text = norm(" ".join(w.text for lay in layouts for w in lay.words))
    if any(norm(t) and norm(t) in text for t in item_terms):
        return ItemState.UNRESOLVED
    hiding = report.count(ItemState.NOT_EXTRACTED) + report.count(ItemState.UNRESOLVED)
    return ItemState.UNRESOLVED if hiding else ItemState.NOT_STATED


__all__ = ["TO_CONTRACT", "CoverageItem", "CoverageReport", "ItemState", "coverage", "not_stated"]
