"""Grid -> table structure: headers, row labels and wrapped lines (shared by all readers).

Rules learned from the V2 validation set (2026-11-26):
1. Leading banner rows (one long text spanning the table, or the same text in every
   cell) are captions, not column headers.
2. Header rows are the rows before the first row carrying a money or percent value
   (at most three), so "What You Will Pay" / "In-Network" / "(You pay the least)"
   becomes one header path.
3. Label columns are the leading columns that rarely carry values. With two of them
   (SBC "Common Medical Event" + "Services You May Need"), the first is a group label
   filled down over the rows it spans, the last is the row's own label.
4. A row whose own label is empty or starts in lower case, and which carries no value,
   continues the row above (a wrapped line), so it is merged rather than becoming a
   fake row. The same holds when the value sits on the wrapped line and the row above
   carries none ("What is the out-of-" / "pocket limit for this plan?  $1,800").
5. A table that opens a page with a value row (no header of its own) and has the same
   width as the last table of the previous page continues that table: it takes the
   previous header text. The header is not printed on this page, so the carried columns
   have no header spans here (a page's spans never point at another page); each
   value's own cell span is still on its own page.
Values are never guessed: a cell keeps the text the reader found, and its span is
recorded only when that exact text is found on the page.
"""

import re
from collections.abc import Sequence

from app.schemas.document import Table, TableCell, TableColumn, TableRow, TextSpan

Grid = Sequence[Sequence[str | None]]

_VALUE = re.compile(
    r"\$\s?\d|\d\s?%|\bno charge\b|\bnot covered\b|\bcovered in full\b|\bcopay(?:ment)?\b",
    re.IGNORECASE,
)
MAX_HEADER_ROWS = 3
LABEL_COLUMN_MAX_VALUE_SHARE = 0.2
VALUES_RIGHT_MIN_SHARE = 0.5
BANNER_MIN_CHARS = 60


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def has_value(text: str) -> bool:
    return bool(_VALUE.search(text))


def _is_banner(row: list[str | None], width: int) -> bool:
    texts = [clean(c) for c in row if clean(c)]
    if not texts:
        return False
    if len(set(texts)) == 1 and (len(texts) > 1 or width == 1):
        return True
    return len(texts) == 1 and width >= 3 and len(texts[0]) >= BANNER_MIN_CHARS


def _complementary(a: list[str | None], b: list[str | None]) -> bool:
    """Two neighbouring physical columns are one logical column when no row has
    different text in both (readers often split a column when cell text shifts)."""
    return all(
        not clean(x) or not clean(y) or clean(x) == clean(y) for x, y in zip(a, b, strict=True)
    )


def _merge_split_columns(raw: list[list[str | None]]) -> list[list[str | None]]:
    cols = [list(col) for col in zip(*raw, strict=True)]
    merged: list[list[str | None]] = [cols[0]]
    for col in cols[1:]:
        if _complementary(merged[-1], col):
            merged[-1] = [x if clean(x) else y for x, y in zip(merged[-1], col, strict=True)]
        else:
            merged.append(col)
    return [list(row) for row in zip(*merged, strict=True)]


def _header_paths(rows: list[list[str | None]]) -> list[list[str]]:
    """Header rows with merged cells resolved. A None cell is covered by a merged cell:
    from above when the cell above starts there (a tall header like "Limitations, ..."),
    otherwise from the left (a wide header like "What You Will Pay")."""
    out: list[list[str]] = []
    for i, row in enumerate(rows):
        filled: list[str] = []
        for c, cell in enumerate(row):
            if cell is not None:
                filled.append(clean(cell))
            elif i > 0 and rows[i - 1][c] is not None:
                filled.append(out[i - 1][c])
            else:
                filled.append(filled[-1] if filled else "")
        out.append(filled)
    return out


def _header_count(rows: list[list[str | None]]) -> int:
    for i, row in enumerate(rows[: MAX_HEADER_ROWS + 1]):
        if any(has_value(clean(c)) for c in row):
            return max(1, min(i, MAX_HEADER_ROWS))
    return 1


def _label_columns(data: list[list[str]], width: int) -> int:
    """1 label column, or 2 when the second column is value-free text whose rows carry
    their values further right (SBC "Common Medical Event" + "Services You May Need").
    In a question/answer table the values sit in the second column itself, so it stays 1."""
    if width < 3 or not data:
        return 1
    second = [r for r in data if r[1]]
    if not second:
        return 1
    value_share = sum(has_value(r[1]) for r in second) / len(second)
    values_right = sum(any(has_value(v) for v in r[2:]) for r in second) / len(second)
    if value_share <= LABEL_COLUMN_MAX_VALUE_SHARE and values_right >= VALUES_RIGHT_MIN_SHARE:
        return 2
    return 1


def _is_continuation(row: list[str], k: int, above: list[str]) -> bool:
    if any(row[c] for c in range(k - 1)):  # a new group starts here
        return False
    own = row[k - 1]
    if any(has_value(v) for v in row[k:]):
        # rule 4b: the value is printed on the wrapped line, the label line holds none
        return bool(own) and own[0].islower() and not any(has_value(v) for v in above[k:])
    return not own or own[0].islower()


def find_span(page_text: str, needle: str, page: int, start: int = 0) -> TextSpan | None:
    """Exact span of ``needle`` in page text, tolerant of line breaks inside it; None if absent."""
    words = [re.escape(w) for w in needle.split()]
    if not words:
        return None
    match = re.compile(r"\s+".join(words)).search(page_text, start)
    return TextSpan(page=page, start=match.start(), end=match.end()) if match else None


def _merge_wrapped(data: list[list[str]], k: int) -> tuple[list[list[str]], list[list[str]]]:
    """Merge wrapped lines into the row above; fill group labels down."""
    merged: list[list[str]] = []
    groups: list[list[str]] = []
    current = [""] * (k - 1)
    for row in data:
        if merged and _is_continuation(row, k, merged[-1]):
            merged[-1] = [
                " ".join(filter(None, (a, b))) for a, b in zip(merged[-1], row, strict=True)
            ]
            continue
        current = [row[c] or current[c] for c in range(k - 1)]
        merged.append(row)
        groups.append(list(current))
    return merged, groups


def _label_count(table: Table) -> int:
    first = int(table.columns[0].id.rsplit("-c", 1)[1]) if table.columns else 1
    return max(1, first)


def _width(table: Table) -> int:
    return _label_count(table) + len(table.columns)


class TableAssembler:
    """Builds a document's tables in reading order, so rule 5 can see the previous page."""

    def __init__(self) -> None:
        self._last: Table | None = None
        self._page = 0

    def add(self, grid: Grid, page: int, table_id: str, page_text: str) -> Table | None:
        previous = self._last if page != self._page else None
        self._page = page
        table = table_from_grid(grid, page, table_id, page_text, previous)
        if table is not None:
            self._last = table
        return table


def _columns(
    heads: list[list[str]], k: int, width: int, *, table_id: str, page_text: str, page: int
) -> list[TableColumn]:
    columns = []
    for c in range(k, width):
        path: list[str] = []
        for h in heads:
            if h[c] and (not path or path[-1] != h[c]):
                path.append(h[c])
        spans = [s for s in (find_span(page_text, p, page) for p in dict.fromkeys(path)) if s]
        columns.append(TableColumn(id=f"{table_id}-c{c}", header_path=path, header_spans=spans))
    return columns


def _prepare(grid: Grid) -> list[list[str | None]] | None:
    raw = [list(r) for r in grid if any(clean(c) for c in r)]
    if not raw:
        return None
    width = max(len(r) for r in raw)
    raw = [r + [None] * (width - len(r)) for r in raw]
    keep = [c for c in range(width) if any(clean(r[c]) for r in raw)]  # drop empty columns
    raw = [[r[c] for c in keep] for r in raw]
    width = len(keep)
    while raw and _is_banner(raw[0], width):
        raw = raw[1:]
    if not raw or width < 2:
        return None
    raw = _merge_split_columns(raw)
    return raw if len(raw[0]) >= 2 else None


def table_from_grid(
    grid: Grid, page: int, table_id: str, page_text: str, previous: Table | None = None
) -> Table | None:
    """Build one table. ``previous`` is the last table of the previous page (rule 5)."""
    raw = _prepare(grid)
    if raw is None:
        return None
    width = len(raw[0])
    carried = (
        previous is not None
        and previous.page == page - 1
        and any(has_value(clean(c)) for c in raw[0])
        and _width(previous) == width
    )
    if not carried and len(raw) < 2:  # a header with no rows under it
        return None
    if carried and previous is not None:
        heads: list[list[str]] = []
        data = [[clean(c) for c in r] for r in raw]
        k = _label_count(previous)
    else:
        n_head = _header_count(raw)
        heads = _header_paths(raw[:n_head])
        data = [[clean(c) for c in r] for r in raw[n_head:]]
        k = _label_columns(data, width)
    merged, groups = _merge_wrapped(data, k)

    rows, cells = [], []
    cursor = 0
    for r, (row, group) in enumerate(zip(merged, groups, strict=True)):
        row_id = f"{table_id}-r{r}"
        label_span = find_span(page_text, row[k - 1], page, cursor) if row[k - 1] else None
        cursor = label_span.start if label_span else cursor
        rows.append(
            TableRow(
                id=row_id,
                label=row[k - 1],
                label_span=label_span,
                group_labels=[g for g in group if g],
            )
        )
        cells += [
            TableCell(
                row_id=row_id,
                column_id=f"{table_id}-c{c}",
                text=row[c],
                span=find_span(page_text, row[c], page, cursor),
            )
            for c in range(k, width)
            if row[c]
        ]
    if carried and previous is not None:
        columns = [
            TableColumn(id=f"{table_id}-c{k + i}", header_path=col.header_path)
            for i, col in enumerate(previous.columns)
        ]
    else:
        columns = _columns(heads, k, width, table_id=table_id, page_text=page_text, page=page)
    return Table(id=table_id, page=page, columns=columns, rows=rows, cells=cells)
