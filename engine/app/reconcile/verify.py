"""Source-grounded verification of table-cell candidates.

A candidate is what a reader *claims*: on page p, the cell in the row labelled L under
the column headed H says V. It is VERIFIED only when the PDF itself shows all of it:

1. V is printed on page p (located in the text layer, inside one cell region);
2. L is printed on the same row band as V (no ruling line separates them; on unruled
   pages, no other row label starts between them);
3. a header element of the candidate is printed above V in the same column strip and
   identifies a single column (a header that a vertical rule runs through is a spanning
   header such as "What You Will Pay" and is not enough on its own).

The reconciled value is the text of the cell as printed (when ruling lines bound the
cell), not whichever reader's string was longest. How many readers proposed a value is
recorded but never counts as evidence.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.parsing.grid import has_value
from app.reconcile.layout import Box, PageLayout, Word, norm
from app.schemas.document import Table

LINE_GAP = 1.7  # unruled cells end at a vertical gap of this many line heights


class Status(StrEnum):
    VERIFIED = "verified"
    REJECTED = "rejected"
    UNRESOLVED = "unresolved"


@dataclass(frozen=True)
class Candidate:
    reader: str
    page: int
    group_labels: tuple[str, ...]
    label: str
    header_path: tuple[str, ...]
    value: str


@dataclass(frozen=True)
class Occurrence:
    box: Box
    cell_text: str  # the whole cell as printed
    cell_box: Box
    exact: bool  # the located words spell the candidate exactly (no trailing partial word)
    bounded: bool  # cell bounds come from ruling lines, not from spacing
    cell: tuple[Word, ...] = ()


@dataclass(frozen=True)
class Verdict:
    candidate: Candidate
    status: Status
    reasons: tuple[str, ...]
    value: Occurrence | None = None
    label: Occurrence | None = None
    header: Occurrence | None = None
    header_page: int | None = None
    header_text: str = ""


def _lines(words: Iterable[Word]) -> list[Word]:
    """Reading order inside a region: by line (tops within 2.5pt), then left to right."""
    out = sorted(words, key=lambda w: (w.box.top, w.box.x0))
    lines: list[list[Word]] = []
    for w in out:
        if lines and abs(lines[-1][0].box.top - w.box.top) <= 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [w for line in lines for w in sorted(line, key=lambda w: w.box.x0)]


def _cell_words(layout: PageLayout, start: Word) -> tuple[list[Word], bool]:
    """Words of the cell that contains ``start`` (bounded by ruling lines when present)."""
    strip = layout.v_strip(start.box.cx, start.box.top + 1) if layout.ruled else None
    if strip is not None:
        lo, hi = strip
        same = [
            w
            for w in layout.words
            if lo - 0.5 <= w.box.cx <= hi + 0.5
            and not layout.h_rule_between(start.box.cx, start.box.top + 1, w.box.top + 1)
            and not layout.h_rule_between(w.box.cx, start.box.top + 1, w.box.top + 1)
        ]
        return _lines(same), True
    # unruled: a left-aligned block below/right of the start word, until a vertical gap
    height = max(start.box.bottom - start.box.top, 6.0)
    block = [start]
    bottom = start.box.bottom
    for w in _lines(layout.words):
        if w is start or w.box.top < start.box.top - 2.5:
            continue
        same_line = abs(w.box.top - start.box.top) <= 2.5
        if same_line and w.box.x0 >= start.box.x0 and w.box.x0 - block[-1].box.x1 < 2 * height:
            block.append(w)
            continue
        left = min(b.box.x0 for b in block)
        right = max(b.box.x1 for b in block)
        if (
            not same_line
            and w.box.top - bottom <= LINE_GAP * height
            and w.box.x0 < right
            and w.box.x1 > left
        ):
            block.append(w)
            bottom = max(bottom, w.box.bottom)
    return _lines(block), False


def locate(layout: PageLayout, text: str) -> list[Occurrence]:
    """Every place on the page where ``text`` is printed as one cell's run of words."""
    target = norm(text)
    if not target:
        return []
    found: list[Occurrence] = []
    for start in layout.words:
        if not (target.startswith(start.key) or start.key.startswith(target)):
            continue
        cell, bounded = _cell_words(layout, start)
        if start not in cell:
            continue
        run = cell[cell.index(start) :]
        acc, used = "", []
        for w in run:
            acc += w.key
            used.append(w)
            if len(acc) >= len(target):
                break
        if not acc.startswith(target):
            continue
        box = used[0].box
        for w in used[1:]:
            box = box.union(w.box)
        cell_box = cell[0].box
        for w in cell[1:]:
            cell_box = cell_box.union(w.box)
        found.append(
            Occurrence(
                box=box,
                cell_text=" ".join(w.text for w in cell),
                cell_box=cell_box,
                exact=acc == target,
                bounded=bounded,
                cell=tuple(cell),
            )
        )
    return found


def _same_row(layout: PageLayout, label: Occurrence, value: Occurrence) -> bool:
    if label.box.x0 >= value.box.x0 - 3:  # labels sit left of their values
        return False
    a, b = label.cell_box.top + 1, value.box.top + 1
    if layout.ruled:
        return not (
            layout.h_rule_between(value.box.cx, a, b) or layout.h_rule_between(label.box.cx, a, b)
        )
    height = max(value.box.bottom - value.box.top, 6.0)
    if abs(b - a) > 2.5 * height:
        return False
    lo, hi = sorted((a, b))
    starters = [
        w
        for w in layout.words
        if abs(w.box.x0 - label.box.x0) < 4 and lo + 2 < w.box.top < hi - 2 and w.text[:1].isupper()
    ]
    return not starters


def _same_column(
    header_layout: PageLayout, header: Occurrence, layout: PageLayout, value: Occurrence
) -> bool:
    if header_layout is layout and header.box.bottom > value.box.top + 1:
        return False
    if header_layout.ruled and layout.ruled:
        hs = header_layout.v_strip(header.box.cx, header.box.bottom - 1)
        vs = layout.v_strip(value.box.cx, value.box.top + 1)
        if hs is None or vs is None:
            return False
        return abs(hs[0] - vs[0]) < 1.5 and abs(hs[1] - vs[1]) < 1.5
    return header.box.x0 - 10 <= value.box.cx <= header.box.x1 + 10


def _identifies_column(layout: PageLayout, header: Occurrence) -> bool:
    """False for a spanning header: on ruled pages a column rule starts under it; on
    unruled pages the header text directly below it falls into separate x-clusters."""
    box = header.cell_box
    if layout.ruled:
        strip = layout.v_strip(box.cx, box.top + 1)
        if strip is not None:  # test the whole ruled cell: centred text sits inside it
            box = Box(strip[0], box.top, strip[1], box.bottom)
        return not layout.v_rule_through(box, box.bottom)
    height = max(header.box.bottom - header.box.top, 6.0)
    below = sorted(
        (w.box.x0, w.box.x1)
        for w in layout.words
        if box.bottom < w.box.top <= box.bottom + 3 * height
        and box.x0 - 2 <= w.box.cx <= box.x1 + 2
    )
    clusters = 0
    right = -1e9
    for x0, x1 in below:
        if x0 - right > 12:
            clusters += 1
        right = max(right, x1)
    return clusters < 2


def _same_strip(a: tuple[float, float] | None, b: tuple[float, float] | None) -> bool:
    return a is not None and b is not None and abs(a[0] - b[0]) < 1.5 and abs(a[1] - b[1]) < 1.5


def _rules_across(layout: PageLayout, x: float) -> list[float]:
    return sorted(r.at for r in layout.h_rules if r.a - 1 <= x <= r.b + 1)


def _continues_from(previous: PageLayout, layout: PageLayout, x: float, y: float) -> bool:
    """The table at (x, y) continues a table that ends at the bottom of ``previous``."""
    prev_rules = _rules_across(previous, x)
    if not (previous.ruled and layout.ruled and prev_rules):
        return False
    return _same_strip(previous.v_strip(x, prev_rules[-1] - 3), layout.v_strip(x, y))


def _strip_header(page: PageLayout, x: float, y: float) -> str:
    """Text of the topmost cell of the table column that contains (x, y)."""
    strip = page.v_strip(x, y)
    if strip is None:
        return ""
    same = [
        w
        for w in page.words
        if strip[0] <= w.box.cx <= strip[1]
        and w.box.top <= y
        and _same_strip(page.v_strip(w.box.cx, w.box.top + 1), strip)
    ]
    if not same:
        return ""
    top = min(same, key=lambda w: (w.box.top, w.box.x0))
    cell, _ = _cell_words(page, top)
    return " ".join(w.text for w in cell)


def _header_is_continued_data(
    layout: PageLayout, previous: PageLayout | None, head: Occurrence
) -> bool:
    """On a table continued from the previous page, a claimed header is data unless it
    repeats that column's header on the previous page (the strip's topmost cell there)."""
    if previous is None or not _continues_from(previous, layout, head.box.cx, head.box.top + 1):
        return False
    prev_rules = _rules_across(previous, head.box.cx)
    original = _strip_header(previous, head.box.cx, prev_rules[-1] - 3)
    return bool(norm(original)) and norm(original) != norm(column_header(head))


def _continues_onto(
    layout: PageLayout, following: PageLayout | None, lab: Occurrence, val: Occurrence
) -> bool:
    """The value's cell is in the table's last row and carries on into a first row of the
    next page whose label cell is empty: the text on this page alone is incomplete."""
    if following is None or not (layout.ruled and following.ruled):
        return False
    below = [at for at in _rules_across(layout, val.box.cx) if at > val.box.bottom]
    if len(below) > 1:
        return False
    nxt = _rules_across(following, val.box.cx)
    if len(nxt) < 2 or not _same_strip(
        layout.v_strip(val.box.cx, val.box.top + 1), following.v_strip(val.box.cx, nxt[0] + 3)
    ):
        return False
    top, bottom = nxt[0], nxt[1]

    def band_has_words(x: float) -> bool:
        strip = following.v_strip(x, top + 3)
        if strip is None:
            return False
        return any(
            strip[0] <= w.box.cx <= strip[1] and top < w.box.top < bottom for w in following.words
        )

    return band_has_words(val.box.cx) and not band_has_words(lab.box.cx)


def column_header(header: Occurrence) -> str:
    """The column's full printed header: the whole header cell that holds the element."""
    return " ".join(w.text for w in header.cell) or header.cell_text


def _labels(candidate: Candidate, layout: PageLayout) -> list[Occurrence]:
    texts = [t for t in (candidate.label, *reversed(candidate.group_labels)) if t.strip()]
    for text in texts[:2]:  # the row's own label; when blank, its group label
        found = locate(layout, text)
        if found:
            return found
    return []


def _rest_of_cell(val: Occurrence, lab: Occurrence, head: Occurrence, same_page: bool) -> str:
    """The cell's words below its header and outside its label (ruled cells only)."""
    words = [
        w
        for w in val.cell
        if not (same_page and w.box.bottom <= head.box.bottom + 1)
        and not (
            lab.box.x0 - 1 <= w.box.x0
            and w.box.x1 <= lab.box.x1 + 1
            and lab.box.top - 1 <= w.box.top
            and w.box.bottom <= lab.box.bottom + 1
        )
    ]
    return norm(" ".join(w.text for w in words))


def _leads_header_cell(layout: PageLayout, head: Occurrence, element: str) -> bool:
    """R7: a short header element still names the column when it is the opening text of
    a ruled header cell - a reader that keeps only the first line of "Network Provider
    (You will pay the least)". The cell must hold no amount and be the topmost cell of
    its column strip, so a word inside a data cell (what R6 guards against) never
    qualifies."""
    if not (layout.ruled and head.bounded):
        return False
    cell = column_header(head)
    if has_value(cell) or not norm(cell).startswith(norm(element)):
        return False
    return norm(_strip_header(layout, head.box.cx, head.box.top + 1)) == norm(cell)


def _match_header(
    candidate: Candidate,
    layout: PageLayout,
    previous: PageLayout | None,
    rowed: list[tuple[Occurrence, Occurrence]],
) -> tuple[Verdict | None, list[str]]:
    """Only the innermost header element can confirm the column: falling back to an
    outer element (e.g. "What You Will Pay") would accept a header that does not name
    one column."""
    elements = [e for e in candidate.header_path if e.strip()]
    if not elements:
        return None, ["no_header"]
    element = elements[-1]
    if has_value(element):  # an amount is a data row a reader took as a header
        return None, ["header_is_a_value"]
    reasons: list[str] = []
    for page_layout in (p for p in (layout, previous) if p is not None):
        for head in locate(page_layout, element):
            if len(norm(element)) < 0.6 * len(norm(head.cell_text)) and not _leads_header_cell(
                page_layout, head, element
            ):
                reasons.append("header_is_part_of_a_longer_cell")
                continue
            if not _identifies_column(page_layout, head):
                reasons.append("header_spans_several_columns")
                continue
            if page_layout is layout and _header_is_continued_data(layout, previous, head):
                reasons.append("header_is_first_row_of_continued_table")
                continue
            for lab, val in rowed:
                if not _same_column(page_layout, head, layout, val):
                    reasons.append("header_not_above_value_column")
                    continue
                if val.bounded and _rest_of_cell(val, lab, head, page_layout is layout) != norm(
                    candidate.value
                ):
                    reasons.append("candidate_is_not_the_whole_cell")
                    continue
                return Verdict(
                    candidate,
                    Status.VERIFIED,
                    (),
                    value=val,
                    label=lab,
                    header=head,
                    header_page=page_layout.number,
                    header_text=element,
                ), reasons
    return None, reasons or ["header_not_printed"]


def verify(
    candidate: Candidate,
    layout: PageLayout,
    previous: PageLayout | None = None,
    following: PageLayout | None = None,
) -> Verdict:
    values = locate(layout, candidate.value)
    if not values:
        return Verdict(candidate, Status.REJECTED, ("value_not_printed_on_page",))
    labels = _labels(candidate, layout)
    if not labels:
        return Verdict(candidate, Status.UNRESOLVED, ("label_not_printed_on_page",))
    rowed = [(lab, val) for val in values for lab in labels if _same_row(layout, lab, val)]
    if not rowed:
        return Verdict(candidate, Status.REJECTED, ("value_not_in_the_labelled_row",))
    verdict, reasons = _match_header(candidate, layout, previous, rowed)
    if verdict is not None:
        if (
            verdict.label
            and verdict.value
            and _continues_onto(layout, following, verdict.label, verdict.value)
        ):
            return Verdict(candidate, Status.UNRESOLVED, ("cell_continues_on_next_page",))
        return verdict
    hard = {"header_not_above_value_column"} >= set(reasons) and bool(reasons)
    status = Status.REJECTED if hard else Status.UNRESOLVED
    return Verdict(candidate, status, tuple(dict.fromkeys(reasons)) or ("header_not_printed",))


def candidates_from(reader: str, tables: Sequence[Table]) -> list[Candidate]:
    """Flatten a reader's tables into candidates."""
    out: list[Candidate] = []
    for table in tables:
        heads = {c.id: tuple(c.header_path) for c in table.columns}
        rows = {r.id: r for r in table.rows}
        for cell in table.cells:
            row = rows[cell.row_id]
            out.append(
                Candidate(
                    reader=reader,
                    page=table.page,
                    group_labels=tuple(row.group_labels),
                    label=row.label,
                    header_path=heads[cell.column_id],
                    value=cell.text,
                )
            )
    return out
