"""Labelled printed values: brochure lines such as "Deductible  $250 per Policy Year".

Travel and student brochures print their benefits as label/value lines, often in two
columns without drawn rules, so the table verifier (which needs ruling lines) and the
prose rules (a heading line, or "Label:" followed by its text) settle none of them.

A model proposes (page, label, value, quote). It is VERIFIED (key 1) only when the PDF's
own text layer shows all of this, on that page:

1. the label is printed at the start of a text segment (a line, or the part of a line
   after a column gap);
2. the quote is printed verbatim right after the label on the same line - only
   separators (":", leader dots, dashes) may stand between them - or it is the clause
   printed directly under the label (the existing prose rule, ``verify_clause``);
3. the quote is the whole printed text: it ends where its segment ends, and no aligned
   line continues it below (a quote that stops mid-text is refused, never shortened);
   lines it wraps onto must be aligned under its first word with nothing in the label
   column (a new label below starts a new item, never a continuation);
4. the value is a whole-word part of the quote;
5. on a ruled page, a label and quote in different cells are a table row: that is the
   table verifier's job, so this path refuses it (never a way around the table rules).

The result is a ClauseFact (anchor = label, text = quote). It carries ``column_unproven``
(never presentable as verified) unless the line is provably single-column
(``single_column``): the page is unruled, the label starts the printed line, nothing but
the quote follows it on that line, and no network-tier wording (in-network, out-of-network,
participating, preferred provider ...) is printed anywhere else on the page - so there is
no column the value could belong to. Agreement and model confidence are never evidence.
"""

import re
from collections.abc import Sequence

from app.reconcile.layout import PageLayout, Word, norm
from app.reconcile.verify import Status

SEPARATOR = ""  # norm() of ":", "....", dashes and the like
TIER_WORDS = re.compile(
    r"\b(?:in|out)[\s-]*of[\s-]*network\b|\bin[\s-]*network\b|\bnon[\s-]*network\b"
    r"|\b(?:non[\s-]*)?participating\b|\bpreferred\s+provider|\bPPO\b|\bnetwork\s+provider",
    re.IGNORECASE,
)


def single_column(
    layout: PageLayout, label_words: Sequence[Word], quote_words: Sequence[Word]
) -> bool:
    """The verified line cannot belong to one of several columns (see module docstring)."""
    if layout.ruled or not label_words or not quote_words:
        return False
    rows = _rows(layout)
    first = label_words[0]
    row = next((r for r in rows if first in r), None)
    if row is None or row[0] is not first:
        return False  # something printed before the label on its line
    last_on_line = [w for w in quote_words if w in row]
    if not last_on_line:
        return False
    tail = row[row.index(last_on_line[-1]) + 1 :]
    if any(norm(w.text) != SEPARATOR for w in tail):
        return False  # another value follows on the same line: a second column
    used = {id(w) for w in (*label_words, *quote_words)}
    rest = " ".join(w.text for w in layout.words if id(w) not in used)
    return TIER_WORDS.search(rest) is None


def _rows(layout: PageLayout) -> list[list[Word]]:
    rows: list[list[Word]] = []
    for w in sorted(layout.words, key=lambda w: (w.box.top, w.box.x0)):
        if rows and abs(rows[-1][0].box.top - w.box.top) <= 2.5:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w.box.x0) for r in rows]


def _height(row: Sequence[Word]) -> float:
    return max(6.0, *(w.box.bottom - w.box.top for w in row))


def _gap(row: Sequence[Word]) -> float:
    """A horizontal gap wider than this separates two segments (columns) of a line.
    Wide enough that a glyph the text layer dropped ("&") does not split a phrase."""
    return max(15.0, 1.5 * _height(row))


def _segment_starts(row: Sequence[Word]) -> set[int]:
    g = _gap(row)
    return {0} | {i for i in range(1, len(row)) if row[i].box.x0 - row[i - 1].box.x1 > g}


def _segment_end(row: Sequence[Word], i: int) -> int:
    """Index of the last word of the segment holding row[i]."""
    starts = _segment_starts(row)
    j = i
    while j + 1 < len(row) and j + 1 not in starts:
        j += 1
    return j


def _value_in_quote(value: str, quote_words: Sequence[Word]) -> bool:
    target = norm(value)
    keys = [norm(w.text) for w in quote_words]
    for i in range(len(keys)):
        acc = ""
        for k in keys[i:]:
            acc += k
            if acc == target:
                return True
            if not target.startswith(acc):
                break
    return False


def _match_label(rows: list[list[Word]], r: int, label: str) -> list[int]:
    """End indexes (in rows[r]) of the label's first line when the label is printed from
    a segment start of rows[r] - on that line alone, or wrapping onto aligned segments of
    the lines directly below with nothing between (a two-line label cell)."""
    row = rows[r]
    target = norm(label)
    out = []
    for s in sorted(_segment_starts(row)):
        end = _segment_end(row, s)
        acc = ""
        for j in range(s, end + 1):
            acc += norm(row[j].text)
            if acc == target:
                out.append(j)
                break
            if not target.startswith(acc):
                break
        else:  # the first line's segment is a prefix of the label: follow its wrap
            line, x = r, row[s].box.x0
            while target.startswith(acc) and acc != target:
                below = _aligned_below(rows, line, x)
                if below is None:
                    break
                for w in below:
                    acc += norm(w.text)
                line += 1
            if acc == target:
                out.append(end)
    return out


def _aligned_below(rows: list[list[Word]], r: int, x: float) -> list[Word] | None:
    """The segment starting at x (±4) on the row directly below row r."""
    if r + 1 >= len(rows):
        return None
    cur, nxt = rows[r], rows[r + 1]
    if nxt[0].box.top - max(w.box.bottom for w in cur) > 1.7 * _height(cur):
        return None
    for i in sorted(_segment_starts(nxt)):
        if abs(nxt[i].box.x0 - x) <= 4:
            return nxt[i : _segment_end(nxt, i) + 1]
    return None


def _continuation(rows: list[list[Word]], r: int, x: float, label_x: float) -> list[Word] | None:
    """The aligned segment on the row directly below row r that continues text starting
    at x: it starts at x (±4), the label column (label_x..x) is empty on that row, and the
    vertical gap is under 1.7 line heights."""
    if r + 1 >= len(rows):
        return None
    cur, nxt = rows[r], rows[r + 1]
    if nxt[0].box.top - max(w.box.bottom for w in cur) > 1.7 * _height(cur):
        return None
    if any(label_x - 4 <= w.box.x0 and w.box.x1 <= x - 4 for w in nxt):
        return None  # something printed in the label column: a new item, not a wrap
    starts = _segment_starts(nxt)
    for i in sorted(starts):
        if abs(nxt[i].box.x0 - x) <= 4:
            return nxt[i : _segment_end(nxt, i) + 1]
    return None


def _quote_from(
    rows: list[list[Word]], r: int, start: int, quote: str, label_x: float
) -> tuple[list[Word], str] | str:
    """The quote's words when it is printed starting at rows[r][start] and is the whole
    text there (segment end, no aligned continuation left over); else a refusal."""
    target = norm(quote)
    row = rows[r]
    x = row[start].box.x0
    seg = row[start : _segment_end(row, start) + 1]
    words: list[Word] = []
    acc = ""
    line = r
    while True:
        for n, w in enumerate(seg):
            acc += norm(w.text)
            words.append(w)
            if acc == target:
                if any(norm(v.text) != SEPARATOR for v in seg[n + 1 :]):
                    return "quote_is_part_of_a_longer_text"
                if _continuation(rows, line, x, label_x) is not None:
                    return "quote_continues_below"
                return words, " ".join(v.text for v in words)
            if not target.startswith(acc):
                return "quote_not_printed_next_to_label"
        nxt = _continuation(rows, line, x, label_x)
        if nxt is None:
            return "quote_not_printed_next_to_label"
        seg, line = nxt, line + 1


def verify_same_line(
    layout: PageLayout, label: str, value: str, quote: str
) -> tuple[Status, tuple[str, ...], tuple[list[Word], list[Word], str] | None]:
    """(status, reasons, (label words, quote words, printed quote)) for rule 2's
    same-line form."""
    rows = _rows(layout)
    reasons: list[str] = []
    for r, row in enumerate(rows):
        for end in _match_label(rows, r, label):
            begin = end
            while begin > 0 and begin not in _segment_starts(row):
                begin -= 1
            label_words = row[begin : end + 1]
            k = end + 1
            while k < len(row) and norm(row[k].text) == SEPARATOR:
                k += 1
            if k >= len(row):
                reasons.append("nothing_after_label_on_its_line")
                continue
            if layout.ruled:
                a = layout.v_strip(label_words[0].box.cx, label_words[0].box.top + 1)
                b = layout.v_strip(row[k].box.cx, row[k].box.top + 1)
                if a is not None and b is not None and a != b:
                    reasons.append("ruled_table_row_use_table_verifier")
                    continue
            got = _quote_from(rows, r, k, quote, label_words[0].box.x0)
            if isinstance(got, str):
                reasons.append(got)
                continue
            words, printed = got
            if not _value_in_quote(value, words):
                reasons.append("value_not_in_quote")
                continue
            return Status.VERIFIED, (), (label_words, words, printed)
    return Status.UNRESOLVED, tuple(dict.fromkeys(reasons)) or ("label_not_printed",), None


# A row label that does not name a benefit on its own (owner 2026-11-28): age bands, a
# person level, "Each", a network or drug tier, a limb, "Death", a bare "Maximum". Such a
# fact needs the printed section heading it sits under, proven from the layout.
_GENERIC_WHOLE = re.compile(
    r"^(?:each|per\s+(?:person|family|member|individual|day|visit|trip)|individual|family|"
    r"employee|spouse|child(?:ren)?|dependents?|single|members?|students?|"
    r"(?:lifetime\s+|overall\s+|annual\s+)?maximum|death|"
    r"in[\s-]*network|out[\s-]*of[\s-]*network|non[\s-]*network|"
    r"(?:non[\s-]*)?preferred(?:\s+brand)?|generic|brand(?:\s+name)?|specialty|"
    r"tier\s*\d+|level\s*\d+|option\s*\w)$",
    re.IGNORECASE,
)
_GENERIC_START = re.compile(
    r"^(?:ages?\s+\d|age\s+(?:under|over|\d)|under\s+(?:age\s+)?\d|over\s+(?:age\s+)?\d|"
    r"\d+\s*(?:and|or)\s+(?:older|over|under|younger)|\d+\s*(?:through|to|-|\u2013)\s*\d+|"
    r"loss\s+of\s+(?:\d|one|two|both|an?\b))",
    re.IGNORECASE,
)


def generic_label(label: str) -> bool:
    """True when the printed label alone doesn't name the benefit."""
    text = " ".join(label.replace("…", " ").split()).strip(" .:;,-\u2013\u2014*")
    return bool(text) and bool(_GENERIC_WHOLE.match(text) or _GENERIC_START.match(text))


def section_heading(layout: PageLayout, label_words: Sequence[Word]) -> str:
    """The printed heading a generic row label sits under, or "" when it can't be proven.

    Proven like a column header, from geometry only: walking up from the label's line
    through sibling rows (their first segment starts at the label's x, ±2 pt) with no
    larger vertical gap than 1.7 line heights, the next line up starts at least 3 pt to
    the left (less indented), lies wholly in the label column (left of the value column)
    and carries no value of its own. A heading wrapped over several lines at the same x
    is joined. Anything else - no such line, a gap, a line with a value - is unproven."""
    if not label_words:
        return ""
    rows = _rows(layout)
    first = label_words[0]
    r = next((i for i, row in enumerate(rows) if first in row), None)
    if r is None:
        return ""
    x = first.box.x0
    row = rows[r]
    value_x = next(
        (row[s].box.x0 for s in sorted(_segment_starts(row)) if row[s].box.x0 > first.box.x1),
        None,
    )

    def contiguous(upper: list[Word], lower: list[Word]) -> bool:
        return lower[0].box.top - max(w.box.bottom for w in upper) <= 1.7 * _height(upper)

    i = r
    while i > 0 and contiguous(rows[i - 1], rows[i]) and abs(rows[i - 1][0].box.x0 - x) <= 2:
        i -= 1  # a sibling sub-row (same indentation)
    if i == 0 or not contiguous(rows[i - 1], rows[i]):
        return ""
    h = i - 1
    head = rows[h]
    hx = head[0].box.x0
    if hx > x - 3 or len(_segment_starts(head)) != 1:
        return ""  # not less indented, or the line carries a value of its own
    if value_x is not None and max(w.box.x1 for w in head) >= value_x:
        return ""  # reaches into the value column: not a heading of the label column
    lines = [head]
    while (
        h > 0
        and contiguous(rows[h - 1], rows[h])
        and abs(rows[h - 1][0].box.x0 - hx) <= 2
        and len(_segment_starts(rows[h - 1])) == 1
        and (value_x is None or max(w.box.x1 for w in rows[h - 1]) < value_x)
        and not rows[h - 1][-1].text.rstrip().endswith((".", ":"))
    ):
        h -= 1
        lines.insert(0, rows[h])
    return " ".join(w.text for line in lines for w in line).strip()


__all__ = ["generic_label", "section_heading", "single_column", "verify_same_line"]
