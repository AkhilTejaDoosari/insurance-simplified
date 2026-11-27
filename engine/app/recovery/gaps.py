"""Where the verified result is still incomplete: the routing signal for later stages.

Gaps are measured against what the readers and the page itself show, never against what
a model believes is missing:

* ``unsettled_row`` - a row label a reader found whose value cells are not all verified
  (unresolved, rejected, or never proposed in some column);
* ``conflict`` - two grounded readings of one cell or one label/header pair;
* ``table_not_found`` - the page has a ruled grid but no reader returned a table there;
* ``no_text_layer`` - the page is an image: nothing on it can be verified against a text
  layer, so it stays unresolved however confident any OCR or model is;
* ``continues_on_next_page`` - a cell runs onto the next page (the next page is context).
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum

from app.reconcile.engine import Reconciled
from app.reconcile.layout import PageLayout, norm
from app.reconcile.verify import Status
from app.schemas.document import Document

MIN_WORDS = 10  # fewer words than this on a page means it has no usable text layer


class GapKind(StrEnum):
    UNSETTLED_ROW = "unsettled_row"
    CONFLICT = "conflict"
    TABLE_NOT_FOUND = "table_not_found"
    NO_TEXT_LAYER = "no_text_layer"
    CONTINUES_ON_NEXT_PAGE = "continues_on_next_page"


@dataclass
class PageGaps:
    page: int
    kinds: set[GapKind] = field(default_factory=set)
    rows: list[str] = field(default_factory=list)  # printed labels still missing values

    @property
    def verifiable(self) -> bool:
        return GapKind.NO_TEXT_LAYER not in self.kinds


def find_gaps(
    result: Reconciled, layouts: Sequence[PageLayout], documents: Mapping[str, Document]
) -> dict[int, PageGaps]:
    gaps: dict[int, PageGaps] = {}

    def at(page: int) -> PageGaps:
        return gaps.setdefault(page, PageGaps(page))

    for layout in layouts:
        if len(layout.words) < MIN_WORDS:
            at(layout.number).kinds.add(GapKind.NO_TEXT_LAYER)
    tabled = {p.number for d in documents.values() for p in d.pages if p.tables}
    for layout in layouts:
        if layout.ruled and layout.number not in tabled and len(layout.words) >= MIN_WORDS:
            at(layout.number).kinds.add(GapKind.TABLE_NOT_FOUND)

    # expected value cells per printed row = the most any single proposer saw in that row
    seen: dict[tuple[int, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    label_text: dict[tuple[int, str], str] = {}
    for v in result.verdicts:
        c = v.candidate
        key = (c.page, norm(c.label))
        if not key[1] or not norm(c.value):
            continue
        seen[key][c.reader] += 1
        label_text.setdefault(key, c.label)
        if "cell_continues_on_next_page" in v.reasons:
            at(c.page).kinds.add(GapKind.CONTINUES_ON_NEXT_PAGE)
    verified: dict[tuple[int, str], int] = defaultdict(int)
    for f in result.facts:
        verified[(f.page, norm(f.label))] += 1
    for key, per_reader in seen.items():
        expected = max(per_reader.values())
        if verified[key] < expected:
            g = at(key[0])
            g.kinds.add(GapKind.UNSETTLED_ROW)
            g.rows.append(label_text[key])
    for a, b in result.conflicts:
        for f in (a, b):
            at(f.page).kinds.add(GapKind.CONFLICT)
    unsettled = {v.candidate.page for v in result.verdicts if v.status is not Status.VERIFIED}
    return {
        p: g
        for p, g in sorted(gaps.items())
        if g.kinds and (g.kinds - {GapKind.UNSETTLED_ROW} or p in unsettled)
    }
