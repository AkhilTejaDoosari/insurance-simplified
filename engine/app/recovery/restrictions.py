"""Attach governing text to verified values, using only text printed in the PDF.

A cost is only half the answer when the same printed row says "Prior authorization
required" or a dagger points to a footnote. Two links are made, both deterministic:

1. **Same-row governing column.** On benefit tables the conditions sit in a column of
   their own ("Limitations, Exceptions & Other Important Information"). When BOTH the
   value and that column's cell are verified facts of the same printed row (same page,
   row label and group), the limitation is attached. Cells that only say "none" attach
   nothing; two governing cells in one row are ambiguous and attach nothing.
2. **Footnote markers.** When the verified value or its printed row label carries a
   marker (†, ‡, §, *), the footnote is the line in the PDF's text layer that starts
   with that marker, outside the table row, on the same page or - for tables whose
   notes are printed later - the first following page that has one. If that page has
   more than one line starting with the marker the link is ambiguous and nothing is
   attached.

Unverified text is never attached; a limitation cell that continues onto the next page
is unresolved in the verifier and therefore attaches nothing.
"""

import re
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.reconcile.engine import Fact
from app.reconcile.layout import PageLayout, Word, norm

GOVERNING_COLUMN = re.compile(
    r"limitation|exception|important information|restriction|prior auth|notes?\b", re.I
)
MARKERS = ("†", "‡", "§", "*")
_EMPTY = {"", "none", "na", "notapplicable", "nolimitations"}


@dataclass
class VerifiedFact:
    fact: Fact
    restrictions: list[str] = field(default_factory=list)
    footnotes: list[str] = field(default_factory=list)

    @property
    def is_governing_text(self) -> bool:
        return bool(GOVERNING_COLUMN.search(self.fact.header))


def _lines(words: Sequence[Word]) -> list[list[Word]]:
    lines: list[list[Word]] = []
    for w in sorted(words, key=lambda w: (w.box.top, w.box.x0)):
        if lines and abs(lines[-1][0].box.top - w.box.top) <= 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w.box.x0) for line in lines]


def _footnote(layout: PageLayout, marker: str, below: float) -> list[str] | None:
    """Lines that start with ``marker`` below y=``below``; continuation lines (no new
    marker, small vertical gap) are joined."""
    lines = _lines(layout.words)
    found: list[str] = []
    for i, line in enumerate(lines):
        if line[0].box.top <= below or not line[0].text.startswith(marker):
            continue
        if line[0].text == marker and len(line) == 1:
            continue
        text = [" ".join(w.text for w in line)]
        bottom = max(w.box.bottom for w in line)
        height = max(w.box.bottom - w.box.top for w in line)
        for nxt in lines[i + 1 :]:
            if nxt[0].box.top - bottom > 0.8 * height or nxt[0].text[:1] in MARKERS:
                break
            text.append(" ".join(w.text for w in nxt))
            bottom = max(w.box.bottom for w in nxt)
        found.append(" ".join(text))
    return found


def _markers(*texts: str) -> list[str]:
    return [m for m in MARKERS if any(t.rstrip().endswith(m) or f"{m} " in t for t in texts)]


def link(facts: list[Fact], layouts: Sequence[PageLayout] = ()) -> list[VerifiedFact]:
    out = [VerifiedFact(f) for f in facts]
    rows: dict[tuple[int, str, str], list[VerifiedFact]] = defaultdict(list)
    for vf in out:
        f = vf.fact
        rows[(f.page, norm(" ".join(f.group_labels)), norm(f.label))].append(vf)
    for members in rows.values():
        governing = [m for m in members if m.is_governing_text]
        if len(governing) != 1 or norm(governing[0].fact.value) in _EMPTY:
            continue
        text = governing[0].fact.value
        for m in members:
            if m is not governing[0]:
                m.restrictions.append(text)

    by_page = {lay.number: lay for lay in layouts}
    for vf in out:
        f = vf.fact
        for marker in _markers(f.value, f.label):
            for page in range(f.page, max(by_page, default=0) + 1):
                layout = by_page.get(page)
                if layout is None:
                    continue
                below = f.value_box[3] if page == f.page else -1.0
                notes = _footnote(layout, marker, below)
                if notes is None or not notes:
                    continue
                if len(notes) == 1:
                    vf.footnotes.append(notes[0])
                break  # the first page that defines the marker decides (or is ambiguous)
    return out
