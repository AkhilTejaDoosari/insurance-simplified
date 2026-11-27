"""Prose-clause evidence and verification (P0-01).

Table facts are (row, column, value) cells; many insurance facts are not. An SBC's
"Important Questions" table answers questions in sentences; a student or travel policy
states eligibility, exclusions, waiting periods and definitions in paragraphs under a
heading. Forcing those into table cells either loses them (the header search fails) or
weakens the table rules. This path keeps its own representation and its own checks.

A **clause** is printed text governed by an **anchor**: the question it answers, or the
heading it sits under. A model or reader only proposes (anchor, text). The clause is
VERIFIED only when the PDF's own text layer shows all of this:

Ruled pages (question/answer tables)
1. the anchor is printed as the whole body of one cell (header-band lines excluded);
2. the clause is the whole body of the cell directly right of the anchor's cell, in the
   same row band (no rule between them);
3. that row holds no other value cell except governing columns ("Why This Matters",
   "Limitations…"): a row with several value cells is a benefit table, and its cells
   are table facts that must pass the table verifier - this path is never a way around
   the table rules;
4. a clause cell that continues onto the next page verifies only when the candidate
   carries the continuation too, and the continuation is the first row of the same
   column strip there with an empty anchor cell.

Unruled pages (contract prose)
1. the anchor is printed as a whole line;
2. the clause is a whole text block (until a vertical gap) that starts on the anchor's
   line right after it, or on the line directly below it, not left of it.

The column a clause sits in is recorded when it is printed (a header band line in the
clause's cell, or an amount-free topmost cell of its strip); otherwise it is "" and the
clause carries the open condition ``column_unproven``. Agreement between proposers and
model confidence are never evidence.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum

from app.parsing.grid import has_value
from app.reconcile.layout import Box, PageLayout, Word, norm
from app.reconcile.verify import (
    Status,
    _cell_words,
    _continues_from,
    _lines,
    _rules_across,
    _same_strip,
    candidates_from,
)
from app.recovery.restrictions import (
    _EMPTY,
    CROSS_REFERENCE,
    GOVERNING_COLUMN,
    _footnote,
    _markers,
)
from app.schemas.document import Table


class ClauseKind(StrEnum):
    ANSWER = "answer"
    EXCLUSION = "exclusion"
    ELIGIBILITY = "eligibility"
    WAITING_PERIOD = "waiting_period"
    DEFINITION = "definition"
    LIMITATION = "limitation"
    OTHER = "other"


_KIND_RULES: tuple[tuple[ClauseKind, re.Pattern[str]], ...] = (
    (ClauseKind.WAITING_PERIOD, re.compile(r"waiting period|pre-?existing", re.I)),
    (ClauseKind.EXCLUSION, re.compile(r"exclu|not covered|does not cover|doesn.t cover", re.I)),
    (ClauseKind.ELIGIBILITY, re.compile(r"eligib|who (?:is|can) (?:covered|enrol)", re.I)),
    (ClauseKind.DEFINITION, re.compile(r"\bdefinition|\bmeans\b|\bdefined\b", re.I)),
    (ClauseKind.LIMITATION, re.compile(r"limitation|limit\b|maximum|prior auth", re.I)),
)


def clause_kind(anchor: str) -> ClauseKind:
    """From the anchor only (the printed question or heading), deterministic."""
    for kind, pattern in _KIND_RULES:
        if pattern.search(anchor):
            return kind
    return ClauseKind.ANSWER if anchor.rstrip().endswith("?") else ClauseKind.OTHER


@dataclass(frozen=True)
class ClauseCandidate:
    source: str  # reader or "text:<model>" / "layout"
    page: int
    anchor: str
    text: str
    structure: str = "any"  # "table": a reader's table cell (ruled pages only)


@dataclass(frozen=True)
class ClauseEvidence:
    pages: tuple[int, ...]  # the clause's pages (two when it continues)
    anchor: str  # as printed
    anchor_box: tuple[float, float, float, float]
    text: str  # the whole clause as printed (continuation included)
    text_boxes: tuple[tuple[float, float, float, float], ...]  # one per page
    column: str  # printed column header, "" when unproven
    ruled: bool
    governing: tuple[str, ...] = ()  # whole governing cells of the same row, as printed


@dataclass(frozen=True)
class ClauseVerdict:
    candidate: ClauseCandidate
    status: Status
    reasons: tuple[str, ...]
    evidence: ClauseEvidence | None = None


@dataclass
class ClauseFact:
    """A verified clause (key 1) and what is still open about it (P0-04 conditions)."""

    evidence: ClauseEvidence
    kind: ClauseKind
    proposed_by: set[str] = field(default_factory=set)
    restrictions: list[str] = field(default_factory=list)  # governing cells, same row
    footnotes: list[str] = field(default_factory=list)
    open_conditions: list[str] = field(default_factory=list)
    semantic_confirmed: bool = False  # key 2; see app.recovery.semantic
    semantic_reasons: list[str] = field(default_factory=list)
    context: list[str] = field(default_factory=list)  # P1-01 governing text elsewhere
    definitions: list[str] = field(default_factory=list)
    possible_exclusions: list[str] = field(default_factory=list)

    @property
    def page(self) -> int:
        return self.evidence.pages[0]

    @property
    def proposed_by_all(self) -> set[str]:
        return set(self.proposed_by)

    @property
    def presentable_as_verified(self) -> bool:
        return self.semantic_confirmed and not self.open_conditions

    def _open(self, condition: str) -> None:
        if condition not in self.open_conditions:
            self.open_conditions.append(condition)


# ----------------------------------------------------------------- page geometry


def _box(words: Sequence[Word]) -> Box:
    box = words[0].box
    for w in words[1:]:
        box = box.union(w.box)
    return box


def _t(b: Box) -> tuple[float, float, float, float]:
    return (b.x0, b.top, b.x1, b.bottom)


def _in_band(layout: PageLayout, w: Word) -> bool:
    cy = (w.box.top + w.box.bottom) / 2
    return any(x0 <= w.box.cx <= x1 and top <= cy <= bottom for x0, top, x1, bottom in layout.bands)


def _split(layout: PageLayout, cell: Sequence[Word]) -> tuple[list[Word], list[Word]]:
    """(header-band lines, body lines) of one ruled cell."""
    head = [w for w in cell if _in_band(layout, w)]
    body = [w for w in cell if not _in_band(layout, w)]
    return head, body


def _text(words: Iterable[Word]) -> str:
    return " ".join(w.text for w in words)


def _cells_in_band(
    layout: PageLayout, top: float, bottom: float
) -> list[tuple[tuple[float, float], list[Word]]]:
    """Ruled cells (strip, body words) whose body starts inside the row band."""
    out: dict[tuple[float, float], list[Word]] = {}
    for w in layout.words:
        if _in_band(layout, w) or not (top - 0.5 <= w.box.top <= bottom):
            continue
        strip = layout.v_strip(w.box.cx, w.box.top + 1)
        if strip is None:
            continue
        key = (round(strip[0], 1), round(strip[1], 1))
        out.setdefault(key, []).append(w)
    return sorted(out.items())


def _row_band(layout: PageLayout, anchor_body: Sequence[Word]) -> tuple[float, float]:
    x = anchor_body[0].box.cx
    top = anchor_body[0].box.top
    rules = _rules_across(layout, x)
    above = [r for r in rules if r <= top + 1]
    below = [r for r in rules if r > top + 1]
    lo = max(above) if above else top - 1
    hi = min(below) if below else layout.height
    return lo, hi


def _band_of(layout: PageLayout, w: Word) -> tuple[float, float, float, float] | None:
    cy = (w.box.top + w.box.bottom) / 2
    hits = [b for b in layout.bands if b[0] <= w.box.cx <= b[2] and b[1] <= cy <= b[3]]
    return max(hits, key=lambda b: b[3]) if hits else None


def _nearest_header(layout: PageLayout, words: Sequence[Word], below: float) -> list[Word]:
    """Band words of the band row closest above ``below`` (a title bar higher up in the
    same unruled-off region is a different band row and is ignored)."""
    banded = [(b, w) for w in words if (b := _band_of(layout, w)) is not None and b[3] <= below + 1]
    if not banded:
        return []
    lowest = max(b[3] for b, _ in banded)
    return [w for b, w in banded if abs(b[3] - lowest) < 3]


def _column_header(
    layout: PageLayout,
    strip: tuple[float, float],
    anchor_strip: tuple[float, float],
    cell: Sequence[Word],
    body_top: float,
) -> str:
    """The printed header of a clause's column, or "" when it cannot be proven.

    Candidates: the nearest header-band line above the clause in its own cell, else the
    topmost cell of the strip (its band lines when it is a merged header+data cell).
    Accepted only when the text holds no amount, lies inside the strip, and sits on the
    table's header row: a header line of the anchor's column is printed at the same height."""
    head = _nearest_header(layout, cell, body_top)
    if not head:
        above = [
            w
            for w in layout.words
            if strip[0] <= w.box.cx <= strip[1]
            and w.box.bottom <= body_top
            and _same_strip(layout.v_strip(w.box.cx, w.box.top + 1), strip)
        ]
        if not above:
            return ""
        top = min(above, key=lambda w: (w.box.top, w.box.x0))
        top_cell, _ = _cell_words(layout, top)
        head = _nearest_header(layout, top_cell, body_top) or [
            w for w in top_cell if not _in_band(layout, w)
        ]
    if not head:
        return ""
    head = _lines(head)
    text = _text(head)
    if has_value(text) or any(w.box.x0 < strip[0] - 1 or w.box.x1 > strip[1] + 1 for w in head):
        return ""
    first = head[0].box.top
    band = _band_of(layout, head[0])

    def on_header_row(w: Word) -> bool:
        if band is not None:  # same header band row: lines may sit a few points apart
            cy = (w.box.top + w.box.bottom) / 2
            return band[1] <= cy <= band[3] and _band_of(layout, w) is not None
        return abs(w.box.top - first) <= 2.5

    aligned = [
        w
        for w in layout.words
        if anchor_strip[0] <= w.box.cx <= anchor_strip[1]
        and w.box.bottom <= body_top + 1
        and on_header_row(w)
    ]
    return text if aligned else ""


def _header_of(
    layout: PageLayout,
    previous: PageLayout | None,
    *,
    strip: tuple[float, float],
    anchor_strip: tuple[float, float],
    cell: Sequence[Word],
    body_top: float,
) -> str:
    """The strip's header on this page, else - for a table continued from the previous
    page (same column strips under its last rule) - that page's header for the strip."""
    text = _column_header(layout, strip, anchor_strip, cell, body_top)
    x = (strip[0] + strip[1]) / 2
    if text or previous is None or not _continues_from(previous, layout, x, body_top):
        return text
    if not _continues_from(previous, layout, (anchor_strip[0] + anchor_strip[1]) / 2, body_top):
        return ""
    last = _rules_across(previous, x)[-1]
    return _column_header(previous, strip, anchor_strip, [], last)


# ------------------------------------------------------------------ verification


def _anchor_cells(layout: PageLayout, anchor: str) -> list[list[Word]]:
    """Body words of every ruled cell whose body is exactly ``anchor``."""
    target = norm(anchor)
    seen: set[int] = set()
    found = []
    for w in layout.words:
        if not target.startswith(w.key) or id(w) in seen:
            continue
        cell, bounded = _cell_words(layout, w)
        if not bounded:
            continue
        seen.update(id(x) for x in cell)
        _, body = _split(layout, cell)
        if body and norm(_text(body)) == target:
            found.append(_lines(body))
    return found


def _continuation(
    layout: PageLayout,
    following: PageLayout | None,
    anchor_x: float,
    strip: tuple[float, float],
    body_bottom: float,
) -> tuple[list[Word] | None, bool]:
    """(continuation words, continues?) for a clause cell in the table's last row."""
    if following is None or not (layout.ruled and following.ruled):
        return None, False
    x = (strip[0] + strip[1]) / 2
    if len([at for at in _rules_across(layout, x) if at > body_bottom]) > 1:
        return None, False
    nxt = _rules_across(following, x)
    if len(nxt) < 2 or not _same_strip(strip, following.v_strip(x, nxt[0] + 3)):
        return None, False
    top, bottom = nxt[0], nxt[1]

    def band_words(cx: float) -> list[Word]:
        s = following.v_strip(cx, top + 3)
        if s is None:
            return []
        return [w for w in following.words if s[0] <= w.box.cx <= s[1] and top < w.box.top < bottom]

    cont = band_words(x)
    if cont and not band_words(anchor_x):
        return _lines(cont), True
    return None, False


@dataclass
class _Row:
    strip: tuple[float, float]
    words: list[Word]
    governing: list[str]


def _answer_cell(
    layout: PageLayout,
    body: Sequence[Word],
    a_strip: tuple[float, float],
    previous: PageLayout | None = None,
) -> _Row | str:
    """The single value cell right of the anchor in its row band, or a refusal reason."""
    top, bottom = _row_band(layout, body)
    cells = _cells_in_band(layout, top, bottom)
    if any(st[1] <= a_strip[0] + 1.5 for st, _ws in cells):
        return "anchor_is_not_the_row_label"  # a cell sits left of it
    right = [(st, ws) for st, ws in cells if st[0] >= a_strip[1] - 1.5]
    if not right:
        return "no_cell_right_of_anchor"
    (strip, words), rest = right[0], right[1:]
    if abs(strip[0] - a_strip[1]) > 1.5:
        return "clause_cell_not_adjacent_to_anchor"
    governing: list[str] = []
    for st, ws in rest:
        g_cell = _cell_words(layout, _lines(ws)[0])[0]
        g_body = _split(layout, g_cell)[1] or list(g_cell)
        g_top = min(w.box.top for w in g_body)
        if not GOVERNING_COLUMN.search(
            _header_of(
                layout, previous, strip=st, anchor_strip=a_strip, cell=g_cell, body_top=g_top
            )
        ):
            return "row_has_several_value_cells"  # a benefit table: table facts
        governing.append(_text(_lines(_split(layout, g_cell)[1])))
    return _Row(strip, words, governing)


def _whole_clause(
    layout: PageLayout,
    following: PageLayout | None,
    anchor_x: float,
    row: _Row,
    target: str,
) -> tuple[str, tuple[int, ...], list[tuple[float, float, float, float]], list[Word]] | str:
    """(printed text, pages, boxes, cell words) when the candidate is the whole cell -
    with its continuation on the next page when it has one - else a refusal reason."""
    cell, _ = _cell_words(layout, _lines(row.words)[0])
    body_words = _lines(_split(layout, cell)[1])
    printed = _text(body_words)
    cont, continues = _continuation(layout, following, anchor_x, row.strip, _box(body_words).bottom)
    if continues and cont is not None and following is not None:
        if norm(f"{printed} {_text(cont)}") != target:
            return "clause_continues_on_next_page"
        return (
            f"{printed} {_text(cont)}",
            (layout.number, following.number),
            [_t(_box(body_words)), _t(_box(cont))],
            cell,
        )
    if norm(printed) != target:
        return (
            "clause_is_not_the_whole_cell"
            if target in norm(printed)
            else "clause_not_in_answer_cell"
        )
    return printed, (layout.number,), [_t(_box(body_words))], cell


def _verify_ruled(
    c: ClauseCandidate,
    layout: PageLayout,
    following: PageLayout | None,
    previous: PageLayout | None = None,
) -> ClauseVerdict:
    anchors = _anchor_cells(layout, c.anchor)
    if not anchors:
        return ClauseVerdict(c, Status.UNRESOLVED, ("anchor_not_a_printed_cell",))
    target = norm(c.text)
    reasons: list[str] = []
    for body in anchors:
        a_strip = layout.v_strip(body[0].box.cx, body[0].box.top + 1)
        if a_strip is None:
            reasons.append("anchor_not_in_a_column")
            continue
        row = _answer_cell(layout, body, a_strip, previous)
        if isinstance(row, str):
            reasons.append(row)
            continue
        whole = _whole_clause(layout, following, body[0].box.cx, row, target)
        if isinstance(whole, str):
            reasons.append(whole)
            continue
        printed, pages, boxes, cell = whole
        body_top = boxes[0][1]
        column = _header_of(
            layout, previous, strip=row.strip, anchor_strip=a_strip, cell=cell, body_top=body_top
        )
        if GOVERNING_COLUMN.search(column):
            reasons.append("clause_cell_is_governing_text")  # it governs the answer
            continue
        governing = tuple(g for g in row.governing if norm(g) not in _EMPTY)
        evidence = ClauseEvidence(
            pages, _text(body), _t(_box(body)), printed, tuple(boxes), column, True, governing
        )
        return ClauseVerdict(c, Status.VERIFIED, (), evidence)
    return ClauseVerdict(c, Status.UNRESOLVED, tuple(dict.fromkeys(reasons)))


def _line_rows(layout: PageLayout) -> list[list[Word]]:
    rows: list[list[Word]] = []
    for w in sorted(layout.words, key=lambda w: (w.box.top, w.box.x0)):
        if rows and abs(rows[-1][0].box.top - w.box.top) <= 2.5:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w.box.x0) for r in rows]


_HEADING = re.compile(r"[A-Za-z]{3,}")


def _verify_unruled(c: ClauseCandidate, layout: PageLayout) -> ClauseVerdict:
    if c.structure == "table":
        return ClauseVerdict(c, Status.UNRESOLVED, ("table_cell_on_unruled_page",))
    anchor = norm(c.anchor)
    target = norm(c.text)
    raw = c.anchor.strip()
    if not _HEADING.search(raw) or raw.endswith(")") or anchor == target:
        return ClauseVerdict(c, Status.UNRESOLVED, ("anchor_is_not_a_heading",))
    rows = _line_rows(layout)
    reasons: list[str] = []
    for i, row in enumerate(rows):
        # the anchor is a whole line, or the opening of a line ("Waiting period: 30 days")
        for j in range(len(row)):
            if norm(_text(row[: j + 1])) != anchor:
                continue
            after = row[j + 1 :]
            if after and not raw.endswith(":"):
                reasons.append("anchor_is_not_a_whole_line")  # only "Label: text" shares a line
                continue
            if after:
                start = after[0]
            elif i + 1 < len(rows):
                nxt = rows[i + 1]
                height = max(row[0].box.bottom - row[0].box.top, 6.0)
                if (
                    nxt[0].box.top - row[0].box.bottom > 1.7 * height
                    or nxt[0].box.x0 < row[0].box.x0 - 3
                ):
                    reasons.append("nothing_directly_under_anchor")
                    continue
                start = nxt[0]
            else:
                reasons.append("nothing_after_anchor")
                continue
            block, _ = _cell_words(layout, start)
            block = [w for w in block if w.box.top >= start.box.top - 2.5]
            if after:  # same-line clause: the rest of the anchor's line plus its block
                block = [
                    w
                    for w in block
                    if not (abs(w.box.top - row[0].box.top) <= 2.5 and w.box.x0 < start.box.x0)
                ]
            block = _lines(block)
            printed = _text(block)
            if norm(printed) != target:
                reasons.append(
                    "clause_is_not_the_whole_block"
                    if target in norm(printed)
                    else "clause_not_under_anchor"
                )
                continue
            anchor_words = row[: j + 1]
            return ClauseVerdict(
                c,
                Status.VERIFIED,
                (),
                ClauseEvidence(
                    (layout.number,),
                    _text(anchor_words),
                    _t(_box(anchor_words)),
                    printed,
                    (_t(_box(block)),),
                    "",
                    False,
                ),
            )
    return ClauseVerdict(
        c, Status.UNRESOLVED, tuple(dict.fromkeys(reasons)) or ("anchor_not_printed",)
    )


def verify_clause(
    c: ClauseCandidate,
    layout: PageLayout,
    following: PageLayout | None = None,
    previous: PageLayout | None = None,
) -> ClauseVerdict:
    if not layout.words:
        return ClauseVerdict(c, Status.UNRESOLVED, ("no_text_layer",))
    if not norm(c.anchor) or not norm(c.text):
        return ClauseVerdict(c, Status.UNRESOLVED, ("empty_anchor_or_text",))
    if layout.ruled:
        v = _verify_ruled(c, layout, following, previous)
        if v.status is Status.VERIFIED or "anchor_not_a_printed_cell" not in v.reasons:
            return v
    return _verify_unruled(c, layout)


# ------------------------------------------------------------------- proposers


def candidates_from_tables(reader: str, tables: Sequence[Table]) -> list[ClauseCandidate]:
    """Reader cells whose row label is a question or whose value is prose (no amount)."""
    return [
        ClauseCandidate(reader, c.page, c.label.strip(), c.value.strip(), "table")
        for c in candidates_from(reader, tables)
        if c.label.strip()
        and c.value.strip()
        and (c.label.rstrip().endswith("?") or not has_value(c.value))
    ]


def candidates_from_layout(layout: PageLayout) -> list[ClauseCandidate]:
    """Question cells of ruled Q&A tables, read from the text layer itself: the cell
    right of a printed question. A proposer like any other - the verifier decides."""
    if not layout.ruled:
        return []
    out = []
    seen: set[int] = set()
    for w in layout.words:
        if id(w) in seen:
            continue
        cell, bounded = _cell_words(layout, w)
        seen.update(id(x) for x in cell)
        if not bounded:
            continue
        _, body = _split(layout, cell)
        body = _lines(body)
        if not body or not _text(body).rstrip().endswith("?"):
            continue
        strip = layout.v_strip(body[0].box.cx, body[0].box.top + 1)
        if strip is None:
            continue
        top, bottom = _row_band(layout, body)
        right = [(s, ws) for s, ws in _cells_in_band(layout, top, bottom) if s[0] >= strip[1] - 1.5]
        if right:
            nxt, _ = _cell_words(layout, _lines(right[0][1])[0])
            _, ans = _split(layout, nxt)
            if ans:
                out.append(
                    ClauseCandidate("layout", layout.number, _text(body), _text(_lines(ans)))
                )
    return out


# ---------------------------------------------------------------------- facts


def clause_facts(
    candidates: Iterable[ClauseCandidate], layouts: Sequence[PageLayout]
) -> tuple[list[ClauseFact], list[ClauseVerdict]]:
    by_page = {lay.number: lay for lay in layouts}
    facts: dict[tuple[tuple[int, ...], str, str], ClauseFact] = {}
    verdicts: list[ClauseVerdict] = []
    for c in candidates:
        layout = by_page.get(c.page)
        if layout is None:
            verdicts.append(ClauseVerdict(c, Status.UNRESOLVED, ("page_out_of_range",)))
            continue
        v = verify_clause(c, layout, by_page.get(c.page + 1), by_page.get(c.page - 1))
        verdicts.append(v)
        if v.status is not Status.VERIFIED or v.evidence is None:
            continue
        e = v.evidence
        key = (e.pages, norm(e.anchor), norm(e.text))
        fact = facts.get(key)
        if fact is None:
            fact = facts[key] = ClauseFact(e, clause_kind(e.anchor))
        fact.proposed_by.add(c.source)
    out = list(facts.values())
    for f in out:
        _qualify(f, by_page)
    return out, verdicts


def _qualify(f: ClauseFact, by_page: dict[int, PageLayout]) -> None:
    e = f.evidence
    f.restrictions = list(e.governing)
    if not e.column:
        f._open("column_unproven")
    if any(CROSS_REFERENCE.search(t) for t in (e.text, *e.governing)):
        f._open("cross_reference_unresolved")
    for marker in _markers(e.text, e.anchor):
        linked = False
        for page in range(e.pages[-1], max(by_page, default=0) + 1):
            layout = by_page.get(page)
            if layout is None:
                continue
            below = e.text_boxes[-1][3] if page == e.pages[-1] else -1.0
            notes = _footnote(layout, marker, below)
            if not notes:
                continue
            if len(notes) == 1:
                f.footnotes.append(notes[0])
                linked = True
            break
        if not linked:
            f._open("footnote_unresolved")


__all__ = [
    "ClauseCandidate",
    "ClauseEvidence",
    "ClauseFact",
    "ClauseKind",
    "ClauseVerdict",
    "candidates_from_layout",
    "candidates_from_tables",
    "clause_facts",
    "clause_kind",
    "verify_clause",
]
