"""Reader adapters: every PDF reader emits the same document model (one-way door #2).

A reader is a two-way door: swapping it is configuration + re-run. Shared
helpers here turn a reader's raw table grid into the model's rows, columns and
header paths, and find printed page labels, so the readers are compared on
what they actually read rather than on post-processing differences.
"""

import hashlib
import re
from collections.abc import Sequence
from typing import Protocol

from app.schemas.document import (
    Block,
    BlockKind,
    Document,
    ParserInfo,
    Table,
    TableCell,
    TableColumn,
    TableRow,
    TextSpan,
)

Grid = Sequence[Sequence[str | None]]


class PdfReader(Protocol):
    info: ParserInfo

    def read(self, pdf: bytes) -> Document: ...


def sha256(pdf: bytes) -> str:
    return hashlib.sha256(pdf).hexdigest()


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def find_span(page_text: str, needle: str, page: int, start: int = 0) -> TextSpan | None:
    """Exact span of ``needle`` in page text, tolerant of line breaks inside it; None if absent."""
    words = [re.escape(w) for w in needle.split()]
    if not words:
        return None
    match = re.compile(r"\s+".join(words)).search(page_text, start)
    return TextSpan(page=page, start=match.start(), end=match.end()) if match else None


def _fill_merged(row: Sequence[str | None]) -> list[str]:
    """A None cell in a header row is covered by the cell to its left (column span)."""
    out: list[str] = []
    for cell in row:
        out.append(clean(cell) if cell is not None else (out[-1] if out else ""))
    return out


def _header_rows(grid: Grid) -> int:
    """Two header rows when the second row has an empty first cell and is not all numbers."""
    if len(grid) < 3:
        return 1
    second = [clean(c) for c in grid[1]]
    if second and second[0] == "" and any(second[1:]):
        has_money = any(re.search(r"[$%]|\d", c) for c in second[1:])
        return 1 if has_money else 2
    return 1


def table_from_grid(grid: Grid, page: int, table_id: str, page_text: str) -> Table | None:
    """Rows of cell text (first row(s) = headers, first column = row labels) -> Table."""
    rows_in: list[list[str | None]] = [list(r) for r in grid if any(clean(c) for c in r)]
    if len(rows_in) < 2 or max(len(r) for r in rows_in) < 2:
        return None
    width = max(len(r) for r in rows_in)
    grid = [r + [None] * (width - len(r)) for r in rows_in]
    n_head = _header_rows(grid)
    heads = [_fill_merged(grid[i]) for i in range(n_head)]
    columns = []
    for c in range(1, width):
        path = [h[c] for h in heads if h[c]]
        spans = [s for s in (find_span(page_text, p, page) for p in dict.fromkeys(path)) if s]
        columns.append(TableColumn(id=f"{table_id}-c{c}", header_path=path, header_spans=spans))
    rows, cells = [], []
    cursor = 0
    for r, raw in enumerate(grid[n_head:]):
        label = clean(raw[0])
        row_id = f"{table_id}-r{r}"
        label_span = find_span(page_text, label, page, cursor) if label else None
        if label_span:
            cursor = label_span.start
        rows.append(TableRow(id=row_id, label=label, label_span=label_span))
        for c in range(1, width):
            text = clean(raw[c])
            if text:
                span = find_span(page_text, text, page, cursor)
                cells.append(
                    TableCell(row_id=row_id, column_id=f"{table_id}-c{c}", text=text, span=span)
                )
    return Table(id=table_id, page=page, columns=columns, rows=rows, cells=cells)


_PRINTED = (
    re.compile(r"^\s*page\s+(\d+|[ivxlc]+)(?:\s+of\s+\d+)?\s*$", re.I),
    re.compile(r"^\s*(\d{1,3})\s*$"),
    re.compile(r"^.*\|\s*page\s+(\d+)\s*$", re.I),
)


def printed_label(page_text: str) -> str | None:
    """Printed page number from the first or last lines of the page, if any."""
    lines = [ln for ln in page_text.splitlines() if ln.strip()]
    for line in lines[-3:][::-1] + lines[:2]:
        for pattern in _PRINTED:
            m = pattern.match(line)
            if m:
                return m.group(1)
    return None


def line_blocks(text: str, number: int) -> list[Block]:
    """One block per non-empty line, in the reader's order (layout blocks come later)."""
    blocks, offset = [], 0
    for i, line in enumerate(text.split("\n")):
        if line.strip():
            span = TextSpan(page=number, start=offset, end=offset + len(line))
            blocks.append(
                Block(id=f"p{number}b{i}", kind=BlockKind.PARAGRAPH, span=span, reading_order=i)
            )
        offset += len(line) + 1
    return blocks
