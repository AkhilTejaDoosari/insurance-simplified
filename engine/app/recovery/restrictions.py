"""Attach governing text to verified values, using only text printed in the PDF.

A cost is only half the answer when the same printed row says "Prior authorization
required" or a dagger points to a footnote. Two links are made, both deterministic:

1. **Same-row governing column.** On benefit tables the conditions sit in a column of
   their own ("Limitations, Exceptions & Other Important Information"). When BOTH the
   value and that column's cell are verified facts of the same printed row (same page,
   row label and group), the limitation is attached. Cells that only say "none" attach
   nothing; two governing cells in one row are ambiguous and attach nothing.
2. **Footnote markers.** When the verified value, its row label or its group label has a
   marker (†, ‡, §, *), the footnote is the line in the PDF's text layer that starts
   with that marker, outside the table row, on the same page or - for tables whose
   notes are printed later - the first following page that has one. If that page has
   more than one line starting with the marker the link is ambiguous and nothing is
   attached.

Unverified text is never attached; a limitation cell that continues onto the next page
is unresolved in the verifier and therefore attaches nothing.

**Open conditions (P0-04).** Structural verification (D-034 key 1) proves the value is
printed in that row and column. It does not prove the fact is complete for the user.
Every verified fact therefore lists what is still open about the text that governs it:

* ``footnote_unresolved`` - the value or its row label carries a marker whose footnote
  could not be linked to exactly one printed line (missing or ambiguous);
* ``governing_text_unverified`` - the page has a governing column (some row's
  limitation cell was proposed or verified) but this row's cell is not verified;
* ``governing_text_ambiguous`` - two verified governing cells in the row;
* ``cross_reference_unresolved`` - the value, or text attached to it, sends the reader
  elsewhere ("see …", "refer to …", a page or section, the plan document).

A fact is presentable as fully verified only when key 1 holds, no condition is open and
the semantic check (key 2, WP8) has confirmed it. Until key 2 exists, nothing qualifies:
the UI must show verified facts with their open conditions, never as complete.
"""

import re
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.reconcile.engine import Fact
from app.reconcile.layout import PageLayout, Word, norm
from app.reconcile.verify import Status, Verdict

GOVERNING_COLUMN = re.compile(
    r"limitation|exception|important information|restriction|prior auth|notes?\b|why this matters",
    re.I,
)
MARKERS = ("†", "‡", "§", "*")
_EMPTY = {"", "none", "na", "notapplicable", "nolimitations"}
CROSS_REFERENCE = re.compile(
    # "see" only with a reference target - "you can see the specialist" is not one
    r"\bsee\s+(?:the\s+|your\s+|our\s+|a\s+|an\s+)?(?:[\w-]+\s+){0,3}?"
    r"(?:list|chart|page|section|below|above|plan document|policy|certificate|summary|"
    r"evidence of coverage|benefit booklet|booklet|document|glossary|appendix|schedule|"
    r"www\.|https?:|[\w.-]+\.(?:com|gov|org|net)\b)|"
    r"\brefer(?:s|red)? to\b|\bpage \d|\bsection\b|\bplan document|"
    r"\bpolicy (?:document|certificate)|\bcertificate of coverage|\bsummary plan description"
    r"|\bevidence of coverage|\bfor more information\b|\bdetails? (?:in|at)\b"
    r"|\bcall\s+(?:us\s+)?(?:at\s+)?(?:1[-\s.])?\(?\d{3}",
    re.I,
)


class OpenCondition:
    FOOTNOTE = "footnote_unresolved"
    GOVERNING_UNVERIFIED = "governing_text_unverified"
    GOVERNING_AMBIGUOUS = "governing_text_ambiguous"
    CROSS_REFERENCE = "cross_reference_unresolved"


@dataclass
class VerifiedFact:
    fact: Fact
    restrictions: list[str] = field(default_factory=list)
    footnotes: list[str] = field(default_factory=list)
    open_conditions: list[str] = field(default_factory=list)
    semantic_confirmed: bool = False  # D-034 key 2: code reading + judge (semantic.py)
    semantic_reasons: list[str] = field(default_factory=list)
    context: list[str] = field(default_factory=list)  # P1-01 governing text elsewhere
    definitions: list[str] = field(default_factory=list)
    possible_exclusions: list[str] = field(default_factory=list)

    @property
    def is_governing_text(self) -> bool:
        return bool(GOVERNING_COLUMN.search(self.fact.header))

    @property
    def proposed_by_all(self) -> set[str]:
        return set(self.fact.proposed_by)

    @property
    def structurally_verified(self) -> bool:
        return True  # only key-1 facts become VerifiedFacts

    @property
    def presentable_as_verified(self) -> bool:
        """The only state the UI may call fully verified (P0-04)."""
        return self.structurally_verified and self.semantic_confirmed and not self.open_conditions

    def _open(self, condition: str) -> None:
        if condition not in self.open_conditions:
            self.open_conditions.append(condition)


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


def link(
    facts: list[Fact],
    layouts: Sequence[PageLayout] = (),
    verdicts: Sequence[Verdict] = (),
) -> list[VerifiedFact]:
    out = [VerifiedFact(f) for f in facts]
    _link_rows(out, verdicts)
    _link_footnotes(out, layouts)
    for vf in out:
        if any(CROSS_REFERENCE.search(t) for t in (vf.fact.value, *vf.restrictions, *vf.footnotes)):
            vf._open(OpenCondition.CROSS_REFERENCE)
    return out


def _link_rows(out: list[VerifiedFact], verdicts: Sequence[Verdict]) -> None:
    rows: dict[tuple[int, str, str], list[VerifiedFact]] = defaultdict(list)
    for vf in out:
        f = vf.fact
        rows[(f.page, norm(" ".join(f.group_labels)), norm(f.label))].append(vf)

    # pages with a governing column: some row's limitation cell was proposed or verified
    governing_pages = {vf.fact.page for vf in out if vf.is_governing_text}
    proposed_governing: set[tuple[int, str]] = set()
    for v in verdicts:
        c = v.candidate
        if c.header_path and GOVERNING_COLUMN.search(c.header_path[-1]):
            governing_pages.add(c.page)
            if v.status is not Status.VERIFIED:
                proposed_governing.add((c.page, norm(c.label)))

    for (page, _group, label), members in rows.items():
        governing = [m for m in members if m.is_governing_text]
        values = [m for m in members if not m.is_governing_text]
        if len(governing) > 1:
            for m in values:
                m._open(OpenCondition.GOVERNING_AMBIGUOUS)
            continue
        if not governing:
            if page in governing_pages or (page, label) in proposed_governing:
                for m in values:
                    m._open(OpenCondition.GOVERNING_UNVERIFIED)
            continue
        if norm(governing[0].fact.value) in _EMPTY:
            continue  # verified "None": resolved, nothing to attach
        text = governing[0].fact.value
        for m in values:
            m.restrictions.append(text)


def _link_footnotes(out: list[VerifiedFact], layouts: Sequence[PageLayout]) -> None:
    by_page = {lay.number: lay for lay in layouts}
    for vf in out:
        f = vf.fact
        for marker in _markers(f.value, f.label, *f.group_labels):
            linked = False
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
                    linked = True
                break  # the first page that defines the marker decides (or is ambiguous)
            if not linked:
                vf._open(OpenCondition.FOOTNOTE)
